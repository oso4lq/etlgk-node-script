// Сценарий запуска: связывает этапы и возвращает код выхода.

import path from 'node:path';
import { parseCliArgs, HELP_TEXT } from './cli.js';
import { DEFAULT_URL, normalizeUrl } from './url.js';
import { classifyFile } from './safety.js';
import { attemptFilename } from './filename.js';
import { createRunDir, removeRunDir, removeIfEmpty } from './rundir.js';
import { inspectUrl, downloadWithRetry, DownloadError, describeDiskError } from './download.js';
import { computeStats, createSpeedMeter } from './stats.js';
import { renderAttemptLine, renderSummary } from './ui.js';
import { formatBytes, formatDuration } from './format.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_INTERRUPTED = 130;
const STAGES = 4;

/**
 * @param {object} ctx
 * @param {string[]} ctx.argv аргументы командной строки
 * @param {string} ctx.cwd каталог, в котором создаётся downloads/
 * @param {ReturnType<import('./ui.js').createUi>} ctx.ui
 * @param {AbortSignal} ctx.signal срабатывает по Ctrl+C
 * @param {boolean} ctx.isTTY можно ли задавать вопросы
 * @returns {Promise<number>} код выхода
 */
export async function run({ argv, cwd, ui, signal, isTTY }) {
  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    ui.error(err.message);
    ui.info('Справка: node index.js --help');
    return EXIT_ERROR;
  }
  if (args.help) {
    ui.info(HELP_TEXT);
    return EXIT_OK;
  }

  try {
    return await execute({ args, cwd, ui, signal, isTTY });
  } catch (err) {
    if (signal.aborted) {
      ui.info('Прервано пользователем.');
      return EXIT_INTERRUPTED;
    }
    ui.error(err instanceof DownloadError ? err.message : `Непредвиденная ошибка: ${err?.message ?? err}`);
    return EXIT_ERROR;
  }
}

async function execute({ args, cwd, ui, signal, isTTY }) {
  // --- Ссылка -------------------------------------------------------------
  let rawUrl = args.url;
  if (!rawUrl) {
    if (isTTY) {
      ui.info(`Файл по умолчанию: ${DEFAULT_URL}`);
      rawUrl = await ui.askText('Ссылка на файл (Enter — файл по умолчанию): ');
      if (signal.aborted) return EXIT_INTERRUPTED;
    }
    if (!rawUrl) {
      rawUrl = DEFAULT_URL;
      ui.info('Ссылка не указана — используется файл по умолчанию.');
    }
  }

  // --- [1/4] Проверка ссылки ---------------------------------------------
  ui.stage(1, STAGES, 'Проверка ссылки');
  const link = normalizeUrl(rawUrl);
  if (!link.ok) {
    ui.error(`Ссылка невалидна: ${link.reason}`);
    return EXIT_ERROR;
  }
  if (link.driveId && link.url !== rawUrl.trim()) {
    ui.info(`      Ссылка Google Drive приведена к прямой: ${link.url}`);
  }

  let info;
  try {
    info = await inspectUrl(link.url, { driveId: link.driveId, signal });
  } catch (err) {
    if (signal.aborted) throw err;
    const linkProblem = err instanceof DownloadError
      && (err.code === 'NOT_A_FILE' || (err.code === 'HTTP' && !err.retryable));
    if (!linkProblem) throw err;
    ui.error(`Ссылка невалидна: ${err.message}`);
    return EXIT_ERROR;
  }

  const kind = classifyFile(info);
  const kindLabel = { safe: 'безопасный', executable: 'исполняемый', unknown: 'неизвестный' }[kind.verdict];
  ui.info(`      Файл:   ${info.filename}`);
  ui.info(`      Тип:    ${info.contentType ?? 'не указан'} (${kindLabel}: ${kind.reason})`);
  ui.info(`      Размер: ${info.size === null ? 'неизвестен' : formatBytes(info.size)}`);

  if (kind.verdict === 'executable') {
    ui.error(`Это исполняемый файл (${kind.reason}). Такие файлы скрипт не скачивает.`);
    return EXIT_ERROR;
  }
  if (kind.verdict === 'unknown') {
    ui.warn(`формат файла не входит в список безопасных (${kind.reason}).`);
    if (args.yes) {
      ui.info('      Указан флаг --yes — продолжаем.');
    } else if (isTTY) {
      const agreed = await ui.confirm('Всё равно скачать этот файл? (y/N) ');
      if (signal.aborted) return EXIT_INTERRUPTED;
      if (!agreed) {
        ui.info('Загрузка отменена.');
        return EXIT_OK;
      }
    } else {
      ui.error('Формат не подтверждён. Чтобы скачать такой файл без вопроса, запустите скрипт с флагом --yes.');
      return EXIT_ERROR;
    }
  }

  // --- [2/4] Папка запуска -----------------------------------------------
  let runDir;
  try {
    runDir = await createRunDir(cwd, new Date());
  } catch (err) {
    throw new DownloadError('DISK', `Не удалось создать папку загрузки в "${cwd}": ${describeDiskError(err)}`, { cause: err });
  }
  const runDirLabel = path.relative(cwd, runDir) || runDir;
  ui.stage(2, STAGES, `Папка запуска: ${runDirLabel}`);

  /** @type {import('./stats.js').AttemptResult[]} */
  const attempts = [];
  let failed = false;

  try {
    // --- [3/4] Загрузка ---------------------------------------------------
    ui.stage(3, STAGES, `Загрузка: запросов подряд — ${args.count}`);
    let expectedSize = info.size; // все копии должны быть одного размера

    for (let index = 1; index <= args.count && !signal.aborted; index += 1) {
      const dest = path.join(runDir, attemptFilename(index, args.count, info.filename));
      let meter = createSpeedMeter();
      let attempt;
      try {
        const result = await downloadWithRetry(info, dest, {
          signal,
          expectedSize,
          onProgress: (received, total) => {
            meter.push(received, performance.now());
            const speed = meter.speed();
            const size = total ?? expectedSize;
            const etaMs = size && speed > 0 ? ((size - received) / speed) * 1000 : null;
            ui.progress({ index, total: args.count, received, size, speed, etaMs });
          },
          onRetry: (retryNo, error, delayMs) => {
            meter = createSpeedMeter();
            ui.progressEnd();
            ui.warn(`запрос ${index}: ${error.message}. Повтор ${retryNo} через ${formatDuration(delayMs)}.`);
          },
        });
        expectedSize ??= result.bytes;
        attempt = { index, ok: true, ...result };
      } catch (err) {
        if (!(err instanceof DownloadError)) throw err;
        attempt = { index, ok: false, bytes: 0, durationMs: 0, retries: err.retries ?? 0, error: err.message };
      }

      attempts.push(attempt);
      ui.progressEnd();
      if (attempt.ok) {
        ui.info(renderAttemptLine(attempt, args.count));
      } else {
        failed = true;
        ui.error(renderAttemptLine(attempt, args.count).trim());
        break; // дальнейшие запросы не имеют смысла
      }
    }

    // --- [4/4] Итог -------------------------------------------------------
    ui.stage(4, STAGES, signal.aborted ? 'Итог (запуск прерван)' : 'Итог');
    if (attempts.length > 0) ui.info(renderSummary(attempts, computeStats(attempts)));
    else ui.info('  Ни один запрос не был выполнен.');
  } finally {
    await removeIfEmpty(runDir).catch(() => {});
  }

  // --- Удаление папки запуска ---------------------------------------------
  if (attempts.some((a) => a.ok)) {
    let removed = false;
    if (isTTY && !signal.aborted) {
      removed = await ui.confirm(`\nУдалить папку этого запуска (${runDirLabel})? (y/N) `);
      if (removed) {
        await removeRunDir(runDir);
        ui.info('Папка запуска удалена.');
      }
    }
    if (!removed) ui.info(`Файлы сохранены в папке: ${runDirLabel}`);
  }

  if (signal.aborted) return EXIT_INTERRUPTED;
  return failed ? EXIT_ERROR : EXIT_OK;
}

// Консольный вывод: этапы, прогресс-бар, итоговая таблица и вопросы.
// Функции render* чистые — они только строят строки.

import readline from 'node:readline';
import { formatBytes, formatSpeed, formatDuration } from './format.js';

const PROGRESS_INTERVAL_MS = 100;

/** Полоса прогресса: renderBar(0.5, 10) → "█████░░░░░". */
export function renderBar(fraction, width = 20) {
  const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const filled = Math.round(safe * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function attemptLabel(index, total) {
  return `${String(index).padStart(String(total).length + 2)}/${total}`;
}

/**
 * Строка прогресса текущей загрузки. Если размер файла неизвестен,
 * показываются только скачанный объём и скорость.
 * @param {{index: number, total: number, received: number, size: number|null, speed: number, etaMs: number|null}} data
 */
export function renderProgressLine({ index, total, received, size, speed, etaMs }) {
  const label = attemptLabel(index, total);
  if (!size) return `${label}  ${formatBytes(received)}  ${formatSpeed(speed)}`;

  const fraction = received / size;
  const percent = `${String(Math.floor(fraction * 100)).padStart(3)}%`;
  const eta = etaMs === null ? '' : `  осталось ${formatDuration(etaMs)}`;
  return `${label} [${renderBar(fraction)}] ${percent}  ${formatBytes(received)} / ${formatBytes(size)}  ${formatSpeed(speed)}${eta}`;
}

function retriesNote(attempt) {
  return attempt.retries > 0 ? ` (повторов: ${attempt.retries})` : '';
}

/**
 * Строка с результатом одной попытки.
 * @param {import('./stats.js').AttemptResult} attempt
 * @param {number} total
 */
export function renderAttemptLine(attempt, total) {
  const label = attemptLabel(attempt.index, total);
  if (!attempt.ok) return `${label}  ОШИБКА  ${attempt.error ?? ''}${retriesNote(attempt)}`;
  const speed = attempt.durationMs > 0 ? attempt.bytes / (attempt.durationMs / 1000) : 0;
  return `${label}  OK  ${formatDuration(attempt.durationMs)}  ${formatBytes(attempt.bytes)}  ${formatSpeed(speed)}${retriesNote(attempt)}`;
}

/**
 * Итоговая таблица по попыткам и сводные показатели.
 * @param {import('./stats.js').AttemptResult[]} attempts
 * @param {ReturnType<import('./stats.js').computeStats>} stats
 */
export function renderSummary(attempts, stats) {
  const rows = attempts.map((a) => {
    if (!a.ok) return [String(a.index), '—', '—', '—', `ошибка: ${a.error ?? 'неизвестная'}${retriesNote(a)}`];
    const speed = a.durationMs > 0 ? a.bytes / (a.durationMs / 1000) : 0;
    return [String(a.index), formatDuration(a.durationMs), formatBytes(a.bytes), formatSpeed(speed), `OK${retriesNote(a)}`];
  });
  const table = [['№', 'Время', 'Размер', 'Скорость', 'Статус'], ...rows];
  const widths = table[0].map((_, col) => Math.max(...table.map((row) => row[col].length)));
  const lines = table.map((row) => `  ${row.map((cell, col) => cell.padEnd(widths[col])).join('   ').trimEnd()}`);

  const total = attempts.length;
  const facts = [
    ['Успешных запросов:', `${stats.okCount} из ${total}`],
    ['Среднее время запроса:', stats.okCount
      ? `${formatDuration(stats.avgMs)} (мин ${formatDuration(stats.minMs)}, макс ${formatDuration(stats.maxMs)})`
      : '—'],
    ['Общее время:', stats.okCount ? formatDuration(stats.totalMs) : '—'],
    ['Общий объём:', formatBytes(stats.totalBytes)],
    ['Скорость скачивания:', stats.okCount ? formatSpeed(stats.avgSpeed) : '—'],
  ];
  const labelWidth = Math.max(...facts.map(([label]) => label.length));
  return [...lines, '', ...facts.map(([label, value]) => `  ${label.padEnd(labelWidth)} ${value}`)].join('\n');
}

/**
 * Вывод в консоль. В терминале — цвета, перерисовка строки прогресса и
 * вопросы; при перенаправлении в файл — только простой текст без вопросов.
 *
 * @param {{output: NodeJS.WritableStream, input: NodeJS.ReadableStream, isTTY: boolean, signal?: AbortSignal}} io
 *   signal — сигнал прерывания (Ctrl+C): незавершённый вопрос получает ответ по умолчанию
 */
export function createUi({ output, input, isTTY, signal }) {
  const useColor = isTTY && !process.env.NO_COLOR;
  const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  let lastProgressAt = 0;
  let progressShown = false;
  let activeReadline = null;

  const clearProgress = () => {
    if (!progressShown) return;
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
    progressShown = false;
  };
  const writeLine = (text) => {
    clearProgress();
    output.write(`${text}\n`);
  };

  /** Задаёт вопрос; при прерывании (Ctrl+C) или закрытии ввода возвращает пустую строку. */
  const ask = (question) => new Promise((resolve) => {
    clearProgress();
    if (signal?.aborted) {
      resolve('');
      return;
    }
    // terminal: false — readline не перехватывает Ctrl+C, SIGINT получает процесс
    const rl = readline.createInterface({ input, output, terminal: false });
    activeReadline = rl;
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      activeReadline = null;
      rl.close();
      resolve(answer.trim());
    };
    const onAbort = () => {
      output.write('\n');
      finish('');
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    rl.on('close', () => {
      signal?.removeEventListener('abort', onAbort);
      finish('');
    });
    rl.question(question, finish);
  });

  return {
    stage(n, total, text) {
      writeLine(`${paint('1;36', `[${n}/${total}]`)} ${text}`);
    },
    info(text) {
      writeLine(text);
    },
    success(text) {
      writeLine(paint('32', text));
    },
    warn(text) {
      writeLine(paint('33', `Внимание: ${text}`));
    },
    /** Строка об ошибке без приставки «Ошибка:» — для строк, где она уже есть. */
    failure(text) {
      writeLine(paint('31', text));
    },
    error(text) {
      writeLine(paint('31', `Ошибка: ${text}`));
    },
    /** Перерисовывает строку прогресса (только в терминале, не чаще 10 раз в секунду). */
    progress(data) {
      if (!isTTY) return;
      const now = Date.now();
      if (progressShown && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      const maxWidth = (output.columns || 100) - 1; // длиннее ширины окна строка не перерисуется
      readline.cursorTo(output, 0);
      output.write(renderProgressLine(data).slice(0, maxWidth));
      readline.clearLine(output, 1);
      progressShown = true;
    },
    progressEnd() {
      clearProgress();
    },
    async askText(question) {
      return isTTY ? ask(question) : '';
    },
    async confirm(question) {
      if (!isTTY) return false;
      return /^(y|yes|д|да)$/i.test(await ask(question));
    },
    close() {
      clearProgress();
      activeReadline?.close();
    },
  };
}

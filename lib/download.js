// Сетевой слой: проверка ссылки и загрузка файла с замером времени.

import { resolveFilename } from './filename.js';

const REQUEST_HEADERS = {
  // Просим не сжимать ответ, чтобы «скачанный объём» совпадал с размером файла.
  'Accept-Encoding': 'identity',
  'User-Agent': 'download-speed-cli/1.0 (Node.js)',
};
const HTML_READ_LIMIT = 1024 * 1024;

/**
 * Ошибка загрузки с машинным кодом и признаком «есть ли смысл повторять».
 * Сообщение — готовый текст для пользователя.
 */
export class DownloadError extends Error {
  /**
   * @param {'HTTP'|'NETWORK'|'STALL'|'SIZE_MISMATCH'|'NOT_A_FILE'|'EXECUTABLE'|'DISK'|'ABORTED'} code
   * @param {string} message
   * @param {{status?: number, cause?: unknown}} [details]
   */
  constructor(code, message, { status, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DownloadError';
    this.code = code;
    if (status !== undefined) this.status = status;
    this.retryable = code === 'NETWORK' || code === 'STALL' || code === 'SIZE_MISMATCH'
      || (code === 'HTTP' && (status >= 500 || status === 429));
  }
}

function describeNetworkError(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'не удалось найти сервер (проверьте адрес и подключение к интернету)';
  if (code === 'ECONNREFUSED') return 'сервер отклонил соединение';
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') return 'соединение разорвано';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'сервер не отвечает';
  if (/CERT|SSL|TLS/.test(code)) return `ошибка защищённого соединения (${code})`;
  return err?.cause?.message || err?.message || 'неизвестная ошибка';
}

/**
 * Открывает запрос с двумя способами прерывания: внешним сигналом (Ctrl+C)
 * и таймером простоя, который нужно сбрасывать вызовом touch() на каждой
 * порции данных. toError() превращает любую ошибку в DownloadError.
 */
async function openConnection(url, { signal, stallMs }) {
  const controller = new AbortController();
  let abortReason = null; // 'user' | 'stall'
  let timer = null;

  const onUserAbort = () => {
    abortReason = 'user';
    controller.abort();
  };
  if (signal?.aborted) onUserAbort();
  else signal?.addEventListener('abort', onUserAbort, { once: true });

  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      abortReason ??= 'stall';
      controller.abort();
    }, stallMs);
  };
  const dispose = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onUserAbort);
  };
  const toError = (err) => {
    if (err instanceof DownloadError) return err;
    if (abortReason === 'user') return new DownloadError('ABORTED', 'Загрузка прервана пользователем');
    if (abortReason === 'stall') {
      return new DownloadError('STALL', `Сервер не присылает данные дольше ${Math.round(stallMs / 100) / 10} с`);
    }
    return new DownloadError('NETWORK', `Сетевая ошибка: ${describeNetworkError(err)}`, { cause: err });
  };

  touch();
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, redirect: 'follow', signal: controller.signal });
    return { response, touch, dispose, toError, abort: () => controller.abort() };
  } catch (err) {
    dispose();
    throw toError(err);
  }
}

function assertOkStatus(response) {
  if (response.ok) return;
  const { status } = response;
  const hint = status === 404 ? ' (файл не найден)'
    : status === 401 || status === 403 ? ' (нет доступа)'
      : status === 429 ? ' (слишком много запросов)' : '';
  throw new DownloadError('HTTP', `Сервер ответил ошибкой HTTP ${status}${hint}`, { status });
}

/** "Video/MP4; charset=x" → "video/mp4" */
function mediaType(response) {
  const raw = response.headers.get('content-type');
  return raw ? raw.split(';')[0].trim().toLowerCase() || null : null;
}

/** Размер из Content-Length; null, если его нет или тело сжато. */
function declaredSize(response) {
  if (response.headers.get('content-encoding')) return null;
  const raw = response.headers.get('content-length');
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // соединение уже закрыто — нечего отменять
  }
}

async function readTextLimited(response, touch, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    touch();
    chunks.push(chunk);
    total += chunk.length;
    if (total >= limit) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Для больших файлов Google Drive вместо файла отдаёт страницу «не удалось
 * проверить на вирусы» с формой. Собираем из формы адрес настоящей загрузки.
 * @returns {string|null}
 */
function driveConfirmUrl(html, baseUrl) {
  const form = html.match(/<form\b[^>]*\bid=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!form) return null;
  const action = form[0].match(/\baction=["']([^"']+)["']/i);
  if (!action) return null;

  const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let target;
  try {
    target = new URL(unescape(action[1]), baseUrl);
  } catch {
    return null;
  }
  for (const [input] of form[1].matchAll(/<input\b[^>]*>/gi)) {
    if (!/\btype=["']hidden["']/i.test(input)) continue;
    const name = input.match(/\bname=["']([^"']*)["']/i);
    const value = input.match(/\bvalue=["']([^"']*)["']/i);
    if (name) target.searchParams.set(unescape(name[1]), unescape(value ? value[1] : ''));
  }
  return target.href;
}

/**
 * @typedef {{url: string, filename: string, contentType: string|null, size: number|null}} FileInfo
 */

/**
 * Проверяет, что по ссылке действительно отдаётся файл, и узнаёт его имя,
 * тип и размер. Читает только заголовки: само тело не скачивается.
 *
 * @param {string} url
 * @param {{driveId?: string|null, signal?: AbortSignal, timeoutMs?: number}} [opts]
 * @returns {Promise<FileInfo>}
 */
export async function inspectUrl(url, opts = {}) {
  return inspect(url, opts, false);
}

async function inspect(url, { driveId = null, signal, timeoutMs = 30000 }, confirmed) {
  const conn = await openConnection(url, { signal, stallMs: timeoutMs });
  const { response } = conn;
  try {
    assertOkStatus(response);
    const contentType = mediaType(response);

    // Google Drive отвечает HTML-страницей, когда файла нет, доступ закрыт,
    // превышена квота или требуется подтверждение загрузки.
    if (driveId && contentType === 'text/html') {
      const html = await readTextLimited(response, conn.touch, HTML_READ_LIMIT);
      const confirmUrl = confirmed ? null : driveConfirmUrl(html, response.url);
      if (!confirmUrl) {
        throw new DownloadError('NOT_A_FILE',
          'Google Drive вернул страницу вместо файла: файл не найден, доступ по ссылке закрыт или превышена квота скачиваний');
      }
      conn.dispose();
      return await inspect(confirmUrl, { driveId, signal, timeoutMs }, true);
    }

    const size = declaredSize(response);
    if (size === 0) throw new DownloadError('NOT_A_FILE', 'По ссылке нет файла: сервер вернул пустой ответ');

    return {
      url,
      filename: resolveFilename({
        contentDisposition: response.headers.get('content-disposition'),
        url: response.url || url,
      }),
      contentType,
      size,
    };
  } catch (err) {
    throw conn.toError(err);
  } finally {
    conn.dispose();
    await discardBody(response);
  }
}

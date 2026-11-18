// Имена файлов и папки запуска: откуда берём имя и как делаем его безопасным
// для любой ОС (в первую очередь Windows, где правила самые строгие).

const MAX_NAME_LENGTH = 120;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Разрешены: латиница, кириллица, цифры, пробел и . _ - ( )
const FORBIDDEN_CHARS = /[^A-Za-z0-9Ѐ-ӿ ._\-()]/gu;

/**
 * fetch отдаёт значения заголовков как latin1. Если сервер прислал имя в UTF-8
 * без filename*=, оно приходит «кракозябрами» — пробуем прочитать байты заново.
 */
function fixLatin1Mojibake(value) {
  let hasHighBytes = false;
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code > 0xff) return value; // это уже не latin1 — трогать нечего
    if (code > 0x7f) hasHighBytes = true;
  }
  if (!hasHighBytes) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('�') ? value : decoded;
}

/**
 * Имя файла из заголовка Content-Disposition.
 * Приоритет у filename*= (RFC 5987), затем обычный filename=.
 * @param {string|null} header
 * @returns {string|null}
 */
export function filenameFromContentDisposition(header) {
  if (!header) return null;

  const extended = header.match(/(?:^|;)\s*filename\*\s*=\s*[\w-]*'[^']*'([^;]+)/i);
  if (extended) {
    try {
      // по стандарту значение percent-кодировано, но часть серверов шлёт сырые байты UTF-8
      const decoded = fixLatin1Mojibake(decodeURIComponent(extended[1].trim()));
      if (decoded) return decoded;
    } catch {
      // битое percent-кодирование — пробуем обычный filename=
    }
  }

  const plain = header.match(/(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i);
  if (plain) {
    const raw = plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2].trim();
    if (raw) return fixLatin1Mojibake(raw);
  }
  return null;
}

/** Последний сегмент пути URL или null, если его нет. */
function filenameFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!segment) return null;
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  } catch {
    return null;
  }
}

/**
 * Делает имя безопасным: убирает путь, заменяет недопустимые символы на "_",
 * обходит зарезервированные имена Windows и ограничивает длину.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  let result = String(name ?? '').normalize('NFC');
  result = result.split(/[\\/]/).pop(); // защита от "../../etc/passwd"
  result = result.replace(FORBIDDEN_CHARS, '_');
  result = result.replace(/^ +/, '').replace(/[. ]+$/, ''); // Windows не допускает точку/пробел в конце
  if (!result) return 'file';

  const stem = result.split('.')[0];
  if (WINDOWS_RESERVED.test(stem)) result = `_${result}`;

  if (result.length > MAX_NAME_LENGTH) {
    const dot = result.lastIndexOf('.');
    const ext = dot > 0 && result.length - dot <= 16 ? result.slice(dot) : '';
    const base = result.slice(0, MAX_NAME_LENGTH - ext.length).replace(/[. ]+$/, '');
    result = base + ext;
  }
  return result;
}

/**
 * Итоговое имя файла: заголовок → URL → "file". Результат уже очищен.
 * @param {{contentDisposition: string|null, url: string}} source
 */
export function resolveFilename({ contentDisposition, url }) {
  const raw = filenameFromContentDisposition(contentDisposition) ?? filenameFromUrl(url) ?? 'file';
  return sanitizeFilename(raw);
}

/** Имя файла попытки: номер исключает перезапись. (1, 10, "a.mp4") → "01_a.mp4". */
export function attemptFilename(index, total, name) {
  const width = Math.max(2, String(total).length);
  return `${String(index).padStart(width, '0')}_${name}`;
}

/**
 * Имя папки запуска по местному времени: "2026-11-18 14-30-05".
 * В ТЗ формат "YYYY-MM-DD HH:mm:ss", но двоеточие запрещено в именах на Windows.
 * @param {Date} date
 */
export function runFolderName(date) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  const time = `${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
  return `${day} ${time}`;
}

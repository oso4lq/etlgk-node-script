// Классификация файла по расширению, MIME-типу и первым байтам.
// Это защита от очевидных случаев, а не антивирус.

const SAFE_EXTENSIONS = new Set([
  // видео и аудио
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
  // изображения
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  // документы и текст
  'pdf', 'txt', 'csv', 'json', 'xml', 'md',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
  // архивы
  'zip', 'rar', '7z', 'tar', 'gz',
]);

const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar',
  'sh', 'apk', 'dmg', 'pkg', 'deb', 'rpm', 'dll', 'lnk',
]);

const EXECUTABLE_MIME = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-dosexec',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/x-sh',
  'application/x-msi',
  'application/vnd.android.package-archive',
  'application/java-archive',
  'application/x-apple-diskimage',
]);

const WEB_PAGE_MIME = new Set(['text/html', 'application/xhtml+xml']);

const SAFE_MIME =new Set(['application/pdf', 'text/plain', 'application/zip']);

function extensionOf(filename) {
  // dot >= 0: имя ".bat" — это файл с расширением bat, Windows запустит его как скрипт
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function isSafeMime(type) {
  if (!type || type === 'image/svg+xml') return false; // SVG может содержать скрипты
  return /^(video|audio|image)\//.test(type) || SAFE_MIME.has(type);
}

/**
 * @param {{filename: string, contentType: string|null}} file
 * @returns {{verdict: 'safe'|'executable'|'unknown', reason: string}}
 */
export function classifyFile({ filename, contentType }) {
  const ext = extensionOf(filename);
  const type = contentType ? contentType.toLowerCase() : null;

  if (EXECUTABLE_EXTENSIONS.has(ext)) return { verdict: 'executable', reason: `расширение .${ext}` };
  if (type && EXECUTABLE_MIME.has(type)) return { verdict: 'executable', reason: `тип ${type}` };

  // Веб-страница по ссылке вида ".../video.mp4" — это страница ошибки или входа,
  // а не видео: расширению в адресе верить нельзя.
  if (type && WEB_PAGE_MIME.has(type)) {
    return { verdict: 'unknown', reason: `по ссылке отдаётся веб-страница (${type}), а не файл` };
  }

  if (SAFE_EXTENSIONS.has(ext)) return { verdict: 'safe', reason: `расширение .${ext}` };
  if (!ext && isSafeMime(type)) return { verdict: 'safe', reason: `тип ${type}` };

  if (ext) return { verdict: 'unknown', reason: `расширение .${ext} не входит в список безопасных` };
  return { verdict: 'unknown', reason: type ? `тип ${type} не входит в список безопасных` : 'тип файла не определён' };
}

const SIGNATURES = [
  { label: 'Windows PE', bytes: [0x4d, 0x5a] }, // "MZ"
  { label: 'ELF', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { label: 'Mach-O', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { label: 'Mach-O', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { label: 'Mach-O', bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { label: 'Mach-O', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { label: 'Mach-O', bytes: [0xca, 0xfe, 0xba, 0xbe] }, // universal binary (и Java .class)
  { label: 'скрипт', bytes: [0x23, 0x21] }, // "#!"
];

/**
 * Узнаёт исполняемый файл по первым байтам — на случай, когда расширение
 * и MIME-тип выдают его за безобидный.
 * @param {Uint8Array} bytes
 * @returns {string|null} название формата или null
 */
export function detectExecutableSignature(bytes) {
  for (const { label, bytes: sig } of SIGNATURES) {
    if (bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b)) return label;
  }
  return null;
}

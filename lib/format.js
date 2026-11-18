// Форматирование величин для вывода в консоль.
// Единицы объёма двоичные: 1 KB = 1024 B.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Объём с автоматически подобранной единицей: 29903185 → "28.52 MB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(2)} ${UNITS[unit]}`;
}

/** Скорость в тех же единицах в секунду: 5463000 → "5.21 MB/s". */
export function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Длительность: "850 мс", "5.48 с", "2 мин 05 с". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0 мс';
  if (ms < 1000) return `${Math.round(ms)} мс`;
  if (ms < 59995) return `${(ms / 1000).toFixed(2)} с`;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min} мин ${sec} с`;
}

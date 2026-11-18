// Разбор пользовательской ссылки и приведение ссылок Google Drive к прямым.

const DRIVE_FILE_ID = '1Pk2Gk1l2TODrjQO0xxaAAfvZCJ9khqVR';

/** Прямая ссылка на файл из ТЗ. */
export const DEFAULT_URL = driveDirectUrl(DRIVE_FILE_ID);

function driveDirectUrl(id) {
  return `https://drive.usercontent.google.com/download?id=${id}&export=download`;
}

const fail = (reason) => ({ ok: false, reason });

/**
 * Проверяет ссылку и возвращает адрес, по которому действительно лежит файл.
 * Ссылки «Поделиться» Google Drive ведут на страницу просмотра, а не на файл,
 * поэтому приводятся к прямому адресу скачивания.
 *
 * @param {string} input
 * @returns {{ok: true, url: string, driveId: string|null} | {ok: false, reason: string}}
 */
export function normalizeUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return fail('Ссылка не указана');

  let url;
  try {
    url = new URL(text);
  } catch {
    return fail('Некорректная ссылка');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('Поддерживаются только ссылки http и https');
  }

  const host = url.hostname.toLowerCase();

  if (host === 'docs.google.com') {
    return fail('Это ссылка на документ Google Docs, а не на файл. Экспортируйте документ и дайте ссылку на файл');
  }

  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') {
    if (/^\/drive\/(u\/\d+\/)?folders\//.test(url.pathname)) {
      return fail('Это ссылка на папку Google Drive, а не на файл');
    }
    const fromPath = url.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]+)/);
    const id = fromPath ? fromPath[1] : url.searchParams.get('id');
    if (!id || !/^[\w-]+$/.test(id)) {
      return fail('В ссылке Google Drive не найден идентификатор файла');
    }
    return { ok: true, url: driveDirectUrl(id), driveId: id };
  }

  return { ok: true, url: url.href, driveId: null };
}

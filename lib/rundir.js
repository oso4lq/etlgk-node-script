// Папка запуска: downloads/{timestamp} в каталоге, откуда запущен скрипт.

import fs from 'node:fs/promises';
import path from 'node:path';
import { runFolderName } from './filename.js';

/**
 * Создаёт downloads/{timestamp}. Если папка уже есть (два запуска в одну
 * секунду), добавляет суффикс " (2)", " (3)" и т. д.
 * @param {string} baseDir
 * @param {Date} date
 * @returns {Promise<string>} абсолютный путь созданной папки
 */
export async function createRunDir(baseDir, date) {
  const downloads = path.join(baseDir, 'downloads');
  await fs.mkdir(downloads, { recursive: true });

  const base = runFolderName(date);
  for (let n = 1; ; n += 1) {
    const dir = path.join(downloads, n === 1 ? base : `${base} (${n})`);
    try {
      await fs.mkdir(dir); // без recursive: существующая папка даёт EEXIST
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/** Удаляет папку запуска со всем содержимым. */
export async function removeRunDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Удаляет папку, только если в ней ничего нет. */
export async function removeIfEmpty(dir) {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) await fs.rmdir(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

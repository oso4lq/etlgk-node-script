// Интерактивные сценарии: run() с «терминалом», где ответы на вопросы
// подаются программно, и с сигналом прерывания вместо настоящего Ctrl+C.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { run } from '../lib/app.js';
import { createUi } from '../lib/ui.js';
import { startServer, sendFile } from './helpers/server.js';

const BODY = Buffer.alloc(1000, 7);
const exists = (p) => fs.access(p).then(() => true, () => false);

/**
 * @param {object} opts
 * @param {Function} opts.handler обработчик запросов сервера
 * @param {(url: string) => string[]} [opts.argv]
 * @param {(url: string) => [string, string][]} [opts.answers] пары «фрагмент вопроса → ответ», по порядку
 */
async function interactive({ handler, argv = () => [], answers = () => [] }, fn) {
  const controller = new AbortController();
  const server = await startServer((req, res, n) => handler(req, res, n, controller));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-app-'));
  const url = `${server.url}/f`;

  const output = new PassThrough();
  const input = new PassThrough();
  const queue = [...answers(url)];
  let text = '';
  let seen = 0;
  output.on('data', (chunk) => {
    text += chunk;
    // отвечаем, только когда вопрос действительно задан
    while (queue.length && text.indexOf(queue[0][0], seen) !== -1) {
      const [question, answer] = queue.shift();
      seen = text.indexOf(question, seen) + question.length;
      input.write(`${answer}\n`);
    }
  });

  const ui = createUi({ output, input, isTTY: true, signal: controller.signal });
  try {
    const code = await run({ argv: argv(url), cwd, ui, signal: controller.signal, isTTY: true });
    ui.close();
    const downloads = path.join(cwd, 'downloads');
    const runDirs = (await exists(downloads)) ? await fs.readdir(downloads) : null;
    await fn({ code, text, server, cwd, runDirs, unanswered: queue });
  } finally {
    await server.close();
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

test('ссылка вводится по запросу; после запуска папку можно удалить', () => interactive(
  {
    handler: (req, res) => sendFile(res, BODY),
    argv: () => ['--count', '2'],
    answers: (url) => [['Ссылка на файл', url], ['Удалить папку', 'y']],
  },
  async ({ code, text, runDirs, unanswered }) => {
    assert.equal(code, 0, text);
    assert.deepEqual(unanswered, [], 'оба вопроса были заданы');
    assert.ok(text.includes('Файл по умолчанию'), 'предлагается файл по умолчанию');
    assert.ok(text.includes('2 из 2') && text.includes('Папка запуска удалена'), text);
    assert.deepEqual(runDirs, [], 'папка запуска удалена, downloads осталась');
  },
));

test('отказ от удаления оставляет файлы', () => interactive(
  {
    handler: (req, res) => sendFile(res, BODY),
    argv: (url) => [url, '--count', '1'],
    answers: () => [['Удалить папку', 'n']],
  },
  async ({ code, text, cwd, runDirs }) => {
    assert.equal(code, 0, text);
    assert.equal(runDirs.length, 1);
    assert.deepEqual(await fs.readdir(path.join(cwd, 'downloads', runDirs[0])), ['01_clip.mp4']);
    assert.ok(text.includes('Файлы сохранены'), text);
  },
));

test('неизвестный формат: вопрос, отказ — ничего не скачано', () => interactive(
  {
    handler: (req, res) => sendFile(res, BODY, { type: 'application/octet-stream', name: 'data.xyz' }),
    argv: (url) => [url],
    answers: () => [['Всё равно скачать', 'n']],
  },
  async ({ code, text, server, runDirs, unanswered }) => {
    assert.equal(code, 0, text);
    assert.deepEqual(unanswered, []);
    assert.ok(text.includes('не входит в список безопасных') && text.includes('Загрузка отменена'), text);
    assert.equal(runDirs, null);
    assert.equal(server.requests.length, 1);
  },
));

test('неизвестный формат: вопрос, согласие — файл скачан', () => interactive(
  {
    handler: (req, res) => sendFile(res, BODY, { type: 'application/octet-stream', name: 'data.xyz' }),
    argv: (url) => [url, '--count', '1'],
    answers: () => [['Всё равно скачать', 'да'], ['Удалить папку', '']],
  },
  async ({ code, text, cwd, runDirs }) => {
    assert.equal(code, 0, text);
    assert.deepEqual(await fs.readdir(path.join(cwd, 'downloads', runDirs[0])), ['01_data.xyz']);
  },
));

test('Ctrl+C посреди загрузки: итог, код 130, без недокачанных файлов и без вопросов', () => interactive(
  {
    // проверка и первая загрузка проходят; вторая загрузка зависает, и её прерывают
    handler: (req, res, n, controller) => {
      if (n <= 2) return sendFile(res, BODY);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': 1000 });
      res.write(BODY.subarray(0, 500));
      setTimeout(() => controller.abort(), 50);
      return undefined;
    },
    argv: (url) => [url, '--count', '3'],
  },
  async ({ code, text, server, cwd, runDirs }) => {
    assert.equal(code, 130, text);
    assert.deepEqual(await fs.readdir(path.join(cwd, 'downloads', runDirs[0])), ['01_clip.mp4']);
    assert.ok(text.includes('запуск прерван') && text.includes('1 из 2'), text);
    assert.ok(!text.includes('Удалить папку'), 'после прерывания вопросы не задаются');
    assert.equal(server.requests.length, 3, 'третья загрузка не начиналась');
  },
));

test('Ctrl+C на вопросе о ссылке: код 130, запросов нет', async () => {
  const controller = new AbortController();
  const output = new PassThrough();
  output.on('data', (chunk) => {
    if (String(chunk).includes('Ссылка на файл')) controller.abort();
  });
  const ui = createUi({ output, input: new PassThrough(), isTTY: true, signal: controller.signal });
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-app-'));
  try {
    const code = await run({ argv: [], cwd, ui, signal: controller.signal, isTTY: true });
    assert.equal(code, 130);
    assert.equal(await exists(path.join(cwd, 'downloads')), false);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

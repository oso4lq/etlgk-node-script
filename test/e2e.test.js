// Сквозные тесты: запускаем настоящий index.js отдельным процессом
// против локального сервера. stdin/stdout здесь не терминал.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, sendFile } from './helpers/server.js';

const INDEX = fileURLToPath(new URL('../index.js', import.meta.url));
const BODY = Buffer.alloc(1000, 7);
const RUN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}$/;

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INDEX, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function scenario(handler, fn) {
  const server = await startServer(handler);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-e2e-'));
  try {
    await fn({ server, cwd, url: `${server.url}/f`, run: (...args) => runCli(args, cwd) });
  } finally {
    await server.close();
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

const exists = (p) => fs.access(p).then(() => true, () => false);
const listRunDirs = async (cwd) => (await exists(path.join(cwd, 'downloads')) ? fs.readdir(path.join(cwd, 'downloads')) : []);
const assertNoStackTrace = (out) => assert.ok(!/\n\s+at .+\(.+:\d+:\d+\)/.test(out) && !out.includes('    at '), out);

test('успешный запуск: файлы на месте, итог напечатан', () => scenario(
  (req, res) => sendFile(res, BODY),
  async ({ server, cwd, url, run }) => {
    const { code, out } = await run(url, '--count', '3');
    assert.equal(code, 0, out);

    const runDirs = await listRunDirs(cwd);
    assert.equal(runDirs.length, 1);
    assert.match(runDirs[0], RUN_DIR_PATTERN);

    const runDir = path.join(cwd, 'downloads', runDirs[0]);
    assert.deepEqual((await fs.readdir(runDir)).sort(), ['01_clip.mp4', '02_clip.mp4', '03_clip.mp4']);
    for (const name of await fs.readdir(runDir)) {
      assert.ok((await fs.readFile(path.join(runDir, name))).equals(BODY), name);
    }

    for (const part of ['[1/4]', '[2/4]', '[3/4]', '[4/4]', 'clip.mp4', 'Среднее время запроса', 'Общее время',
      'Скорость скачивания', '2.93 KB', '3 из 3']) {
      assert.ok(out.includes(part), `${part} в:\n${out}`);
    }
    assert.ok(!out.includes('\x1b') && !out.includes('\r'), 'без управляющих символов');
    assert.equal(server.requests.length, 4, 'проверка + 3 загрузки');
  },
));

test('невалидная ссылка', () => scenario(
  (req, res) => sendFile(res, BODY),
  async ({ cwd, run }) => {
    const { code, out } = await run('ftp://x/y');
    assert.equal(code, 1);
    assert.ok(out.includes('Ссылка невалидна'), out);
    assert.equal(await exists(path.join(cwd, 'downloads')), false);
  },
));

test('исполняемый файл не скачивается', () => scenario(
  (req, res) => sendFile(res, BODY, { type: 'application/octet-stream', name: 'setup.exe' }),
  async ({ server, cwd, url, run }) => {
    const { code, out } = await run(url, '--yes');
    assert.equal(code, 1);
    assert.ok(out.includes('исполняемый'), out);
    assert.equal(await exists(path.join(cwd, 'downloads')), false);
    assert.equal(server.requests.length, 1, 'только проверка, без загрузки');
  },
));

test('неизвестный формат: без --yes отказ, с --yes загрузка', () => scenario(
  (req, res) => sendFile(res, BODY, { type: 'application/octet-stream', name: 'data.xyz' }),
  async ({ cwd, url, run }) => {
    const refused = await run(url, '--count', '1');
    assert.equal(refused.code, 1);
    assert.ok(refused.out.includes('--yes'), refused.out);
    assert.equal(await exists(path.join(cwd, 'downloads')), false);

    const forced = await run(url, '--count', '1', '--yes');
    assert.equal(forced.code, 0, forced.out);
    assert.equal((await listRunDirs(cwd)).length, 1);
  },
));

test('по ссылке ничего нет (404)', () => scenario(
  (req, res) => { res.writeHead(404); res.end(); },
  async ({ cwd, url, run }) => {
    const { code, out } = await run(url);
    assert.equal(code, 1);
    assert.ok(out.includes('404'), out);
    assertNoStackTrace(out);
    assert.equal(await exists(path.join(cwd, 'downloads')), false);
  },
));

test('сбой посреди запуска: итог по успешным попыткам, код 1', () => scenario(
  (req, res, n) => {
    if (n <= 2) sendFile(res, BODY); // проверка и первая загрузка
    else { res.writeHead(404); res.end(); }
  },
  async ({ cwd, url, run }) => {
    const { code, out } = await run(url, '--count', '3');
    assert.equal(code, 1);
    const [runDir] = await listRunDirs(cwd);
    assert.deepEqual(await fs.readdir(path.join(cwd, 'downloads', runDir)), ['01_clip.mp4']);
    for (const part of ['OK', '404', '1 из 2', 'Скорость скачивания']) assert.ok(out.includes(part), `${part} в:\n${out}`);
    assertNoStackTrace(out);
  },
));

test('исполняемое содержимое под видом mp4: ничего не остаётся', () => scenario(
  (req, res) => sendFile(res, Buffer.concat([Buffer.from('MZ'), BODY])),
  async ({ cwd, url, run }) => {
    const { code, out } = await run(url, '--count', '2');
    assert.equal(code, 1);
    assert.ok(out.includes('исполняемый'), out);
    assert.deepEqual(await listRunDirs(cwd), [], 'пустая папка запуска удалена');
  },
));

test('неверные аргументы: сообщение без stack trace', () => scenario(
  (req, res) => sendFile(res, BODY),
  async ({ server, url, run }) => {
    for (const args of [[url, '--count', 'abc'], [url, '--count', '0'], [url, '--nope']]) {
      const { code, out } = await run(...args);
      assert.equal(code, 1, args.join(' '));
      assert.ok(out.includes('Ошибка'), out);
      assertNoStackTrace(out);
    }
    assert.equal(server.requests.length, 0);
  },
));

test('--help', () => scenario(
  (req, res) => sendFile(res, BODY),
  async ({ run }) => {
    const { code, out } = await run('--help');
    assert.equal(code, 0);
    assert.ok(out.includes('--count') && out.includes('--yes'), out);
  },
));

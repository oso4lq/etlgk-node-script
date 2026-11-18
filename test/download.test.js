import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { downloadOnce, downloadWithRetry, DownloadError } from '../lib/download.js';
import { startServer, sendFile } from './helpers/server.js';

const BODY = crypto.randomBytes(64 * 1024);
BODY[0] = 0; // случайные байты не должны случайно совпасть с сигнатурой исполняемого файла
const SMALL = Buffer.alloc(1000, 7);
const exists = (p) => fs.access(p).then(() => true, () => false);

/** Поднимает сервер и временную папку; после теста проверяет, что не осталось *.part. */
async function scenario(handler, fn) {
  const server = await startServer(handler);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-test-'));
  const info = (extra = {}) => ({ url: `${server.url}/f`, filename: 'clip.mp4', contentType: 'video/mp4', size: null, ...extra });
  try {
    await fn({ server, dir, dest: path.join(dir, '01_clip.mp4'), info });
    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith('.part'));
    assert.deepEqual(leftovers, [], 'не должно оставаться *.part');
  } finally {
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const rejectsWith = (promise, expected) => assert.rejects(promise, (err) => {
  assert.ok(err instanceof DownloadError, `ожидалась DownloadError, получено: ${err?.stack ?? err}`);
  for (const [key, value] of Object.entries(expected)) assert.equal(err[key], value, key);
  return true;
});

/** Отдаёт часть тела и оставляет соединение открытым. */
function sendPartialAndHang(res, body, declaredLength) {
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': declaredLength });
  res.write(body);
}

test('скачивает файл целиком и замеряет время', () => scenario(
  (req, res) => sendFile(res, BODY),
  async ({ dest, info }) => {
    const calls = [];
    const result = await downloadOnce(info(), dest, { onProgress: (received, total) => calls.push([received, total]) });
    assert.equal(result.bytes, 65536);
    assert.ok(result.durationMs > 0);
    assert.ok((await fs.readFile(dest)).equals(BODY));
    assert.ok(calls.length >= 1);
    assert.deepEqual(calls.at(-1), [65536, 65536]);
  },
));

test('работает без Content-Length', () => scenario(
  (req, res) => sendFile(res, BODY, { length: false }),
  async ({ dest, info }) => {
    const totals = new Set();
    const result = await downloadOnce(info(), dest, { onProgress: (received, total) => totals.add(total) });
    assert.equal(result.bytes, 65536);
    assert.deepEqual([...totals], [null]);
    assert.ok((await fs.readFile(dest)).equals(BODY));
  },
));

test('сжатый ответ не считается повреждённым', () => scenario(
  (req, res) => sendFile(res, zlib.gzipSync(BODY), { headers: { 'Content-Encoding': 'gzip' } }),
  async ({ dest, info }) => {
    const result = await downloadOnce(info(), dest);
    assert.equal(result.bytes, 65536);
    assert.ok((await fs.readFile(dest)).equals(BODY));
  },
));

test('обрыв соединения: ошибка с повтором, файла нет', () => scenario(
  (req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': 1000 });
    res.write(SMALL.subarray(0, 500), () => res.destroy());
  },
  async ({ dest, info }) => {
    await assert.rejects(downloadOnce(info(), dest), (err) => {
      assert.ok(err instanceof DownloadError);
      assert.ok(['NETWORK', 'SIZE_MISMATCH'].includes(err.code), err.code);
      assert.equal(err.retryable, true);
      return true;
    });
    assert.equal(await exists(dest), false);
  },
));

test('размер отличается от ожидаемого', () => scenario(
  (req, res) => sendFile(res, SMALL),
  async ({ dest, info }) => {
    await rejectsWith(downloadOnce(info(), dest, { expectedSize: 999 }), { code: 'SIZE_MISMATCH', retryable: true });
    assert.equal(await exists(dest), false);
  },
));

test('исполняемый файл под видом mp4 не сохраняется', () => scenario(
  (req, res) => sendFile(res, Buffer.concat([Buffer.from('MZ'), SMALL])),
  async ({ dest, info }) => {
    await rejectsWith(downloadOnce(info(), dest), { code: 'EXECUTABLE', retryable: false });
    assert.equal(await exists(dest), false);
  },
));

test('исполняемый файл короче четырёх байт тоже распознаётся', () => scenario(
  (req, res) => sendFile(res, Buffer.from('#!x')),
  async ({ dest, info }) => {
    await rejectsWith(downloadOnce(info(), dest), { code: 'EXECUTABLE' });
    assert.equal(await exists(dest), false);
  },
));

test('страница вместо файла посреди запуска', () => scenario(
  (req, res) => sendFile(res, Buffer.from('<html>Quota exceeded</html>'), { type: 'text/html; charset=utf-8', name: null }),
  async ({ dest, info }) => {
    await rejectsWith(downloadOnce(info(), dest), { code: 'NOT_A_FILE', retryable: false });
    assert.equal(await exists(dest), false);
  },
));

test('сервер замолчал посреди загрузки', () => scenario(
  (req, res) => sendPartialAndHang(res, SMALL.subarray(0, 500), 1000),
  async ({ dest, info }) => {
    await rejectsWith(downloadOnce(info(), dest, { stallMs: 200 }), { code: 'STALL', retryable: true });
    assert.equal(await exists(dest), false);
  },
));

test('прерывание пользователем посреди загрузки', () => scenario(
  (req, res) => sendPartialAndHang(res, SMALL.subarray(0, 500), 1000),
  async ({ dest, info }) => {
    const controller = new AbortController();
    const promise = downloadOnce(info(), dest, { signal: controller.signal, onProgress: () => controller.abort() });
    await rejectsWith(promise, { code: 'ABORTED', retryable: false });
    assert.equal(await exists(dest), false);
  },
));

test('404 — без повтора', () => scenario(
  (req, res) => { res.writeHead(404); res.end(); },
  ({ dest, info }) => rejectsWith(downloadOnce(info(), dest), { code: 'HTTP', status: 404, retryable: false }),
));

test('нет папки назначения — ошибка диска', () => scenario(
  (req, res) => sendFile(res, SMALL),
  ({ dir, info }) => rejectsWith(
    downloadOnce(info(), path.join(dir, 'missing', '01_clip.mp4')),
    { code: 'DISK', retryable: false },
  ),
));

test('повтор: два сбоя 500, затем успех', () => scenario(
  (req, res, n) => {
    if (n <= 2) { res.writeHead(500); res.end(); } else sendFile(res, SMALL);
  },
  async ({ dest, info }) => {
    const retries = [];
    const result = await downloadWithRetry(info(), dest, {
      baseDelayMs: 10,
      onRetry: (retryNo, error, delayMs) => retries.push([retryNo, error.status, delayMs]),
    });
    assert.equal(result.retries, 2);
    assert.equal(result.bytes, 1000);
    assert.deepEqual(retries, [[1, 500, 10], [2, 500, 20]]);
    assert.ok((await fs.readFile(dest)).equals(SMALL));
  },
));

test('повтор: время неудачных попыток не входит в результат', () => scenario(
  (req, res, n) => {
    if (n === 1) { res.writeHead(500); res.end(); } else sendFile(res, SMALL);
  },
  async ({ dest, info }) => {
    const result = await downloadWithRetry(info(), dest, { baseDelayMs: 300 });
    assert.ok(result.durationMs < 250, `durationMs=${result.durationMs} включает паузу`);
  },
));

test('повтор: попытки заканчиваются', () => scenario(
  (req, res) => { res.writeHead(500); res.end(); },
  async ({ server, dest, info }) => {
    await rejectsWith(downloadWithRetry(info(), dest, { maxRetries: 2, baseDelayMs: 10 }), { code: 'HTTP', retries: 2 });
    assert.equal(server.requests.length, 3);
  },
));

test('повтор: 404 не повторяется', () => scenario(
  (req, res) => { res.writeHead(404); res.end(); },
  async ({ server, dest, info }) => {
    await rejectsWith(downloadWithRetry(info(), dest, { baseDelayMs: 10 }), { code: 'HTTP', retries: 0 });
    assert.equal(server.requests.length, 1);
  },
));

test('повтор: прерывание во время паузы не ждёт её конца', () => scenario(
  (req, res) => { res.writeHead(500); res.end(); },
  async ({ dest, info }) => {
    const controller = new AbortController();
    const started = Date.now();
    const promise = downloadWithRetry(info(), dest, {
      signal: controller.signal,
      baseDelayMs: 10_000,
      onRetry: () => setTimeout(() => controller.abort(), 50),
    });
    await rejectsWith(promise, { code: 'ABORTED' });
    assert.ok(Date.now() - started < 2000);
  },
));

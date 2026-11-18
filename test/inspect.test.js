import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectUrl, DownloadError } from '../lib/download.js';
import { startServer, sendFile } from './helpers/server.js';

const BODY = Buffer.alloc(1000, 7);

async function withServer(handler, fn) {
  const server = await startServer(handler);
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

const rejectsWith = (promise, expected) => assert.rejects(promise, (err) => {
  assert.ok(err instanceof DownloadError, `ожидалась DownloadError, получено: ${err}`);
  for (const [key, value] of Object.entries(expected)) assert.equal(err[key], value, key);
  return true;
});

test('возвращает имя, тип и размер файла', () => withServer(
  (req, res) => sendFile(res, BODY, { type: 'video/mp4; charset=x' }),
  async ({ url }) => {
    assert.deepEqual(await inspectUrl(`${url}/f`), {
      url: `${url}/f`, filename: 'clip.mp4', contentType: 'video/mp4', size: 1000,
    });
  },
));

test('без Content-Length размер неизвестен', () => withServer(
  (req, res) => sendFile(res, BODY, { length: false }),
  async ({ url }) => assert.equal((await inspectUrl(`${url}/f`)).size, null),
));

test('идёт по редиректу и берёт имя из конечного адреса', () => withServer(
  (req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { Location: '/files/final.zip' });
      res.end();
    } else {
      sendFile(res, BODY, { type: 'application/zip', name: null });
    }
  },
  async ({ url }) => {
    const info = await inspectUrl(`${url}/start`);
    assert.equal(info.filename, 'final.zip');
    assert.equal(info.contentType, 'application/zip');
    assert.equal(info.url, `${url}/start`);
  },
));

test('404 — ошибка без повтора', () => withServer(
  (req, res) => { res.writeHead(404); res.end('nope'); },
  ({ url }) => rejectsWith(inspectUrl(`${url}/f`), { code: 'HTTP', status: 404, retryable: false }),
));

test('503 — ошибка с повтором', () => withServer(
  (req, res) => { res.writeHead(503); res.end(); },
  ({ url }) => rejectsWith(inspectUrl(`${url}/f`), { code: 'HTTP', status: 503, retryable: true }),
));

test('пустой файл — это не файл', () => withServer(
  (req, res) => sendFile(res, Buffer.alloc(0)),
  ({ url }) => rejectsWith(inspectUrl(`${url}/f`), { code: 'NOT_A_FILE' }),
));

test('недоступный сервер — сетевая ошибка', async () => {
  const server = await startServer(() => {});
  await server.close();
  await rejectsWith(inspectUrl(`${server.url}/f`), { code: 'NETWORK', retryable: true });
});

test('сервер молчит — таймаут', () => withServer(
  () => {},
  ({ url }) => rejectsWith(inspectUrl(`${url}/f`, { timeoutMs: 200 }), { code: 'STALL', retryable: true }),
));

test('прерывание пользователем', () => withServer(
  () => {},
  async ({ url }) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await rejectsWith(inspectUrl(`${url}/f`, { signal: controller.signal }), { code: 'ABORTED', retryable: false });
  },
));

test('Drive: HTML без формы — файла нет', () => withServer(
  (req, res) => sendFile(res, Buffer.from('<html>Quota exceeded</html>'), { type: 'text/html; charset=utf-8', name: null }),
  async ({ url }) => {
    await assert.rejects(inspectUrl(`${url}/download?id=abc`, { driveId: 'abc' }), (err) => {
      assert.equal(err.code, 'NOT_A_FILE');
      assert.match(err.message, /Google Drive/);
      return true;
    });
  },
));

test('Drive: страница подтверждения — переходим по форме', () => withServer(
  (req, res) => {
    if (req.url.startsWith('/confirmed')) return sendFile(res, BODY);
    const base = `http://${req.headers.host}`;
    const html = `<html><body><form id="download-form" action="${base}/confirmed" method="get">
      <input type="hidden" name="id" value="abc"><input type="hidden" name="export" value="download">
      <input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u1">
      <input type="submit" value="Download anyway"></form></body></html>`;
    return sendFile(res, Buffer.from(html), { type: 'text/html; charset=utf-8', name: null });
  },
  async ({ url, requests }) => {
    const info = await inspectUrl(`${url}/download?id=abc`, { driveId: 'abc' });
    assert.ok(info.url.endsWith('/confirmed?id=abc&export=download&confirm=t&uuid=u1'), info.url);
    assert.equal(info.filename, 'clip.mp4');
    assert.equal(info.size, 1000);
    assert.equal(requests.length, 2);
  },
));

test('Drive: подтверждение не помогло — не зацикливаемся', () => withServer(
  (req, res) => {
    const base = `http://${req.headers.host}`;
    const html = `<form id="download-form" action="${base}/again"><input type="hidden" name="id" value="abc"></form>`;
    sendFile(res, Buffer.from(html), { type: 'text/html', name: null });
  },
  async ({ url, requests }) => {
    await rejectsWith(inspectUrl(`${url}/download?id=abc`, { driveId: 'abc' }), { code: 'NOT_A_FILE' });
    assert.equal(requests.length, 2);
  },
));

test('обычный сайт: HTML считается файлом, решает классификатор', () => withServer(
  (req, res) => sendFile(res, Buffer.from('<html></html>'), { type: 'text/html; charset=utf-8', name: null }),
  async ({ url }) => {
    const info = await inspectUrl(`${url}/page.html`);
    assert.equal(info.contentType, 'text/html');
    assert.equal(info.filename, 'page.html');
  },
));

test('204 No Content — файла нет', () => withServer(
  (req, res) => { res.writeHead(204); res.end(); },
  ({ url }) => rejectsWith(inspectUrl(`${url}/f`), { code: 'NOT_A_FILE', retryable: false }),
));

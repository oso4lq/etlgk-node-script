import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filenameFromContentDisposition,
  sanitizeFilename,
  resolveFilename,
  attemptFilename,
  runFolderName,
} from '../lib/filename.js';

test('Content-Disposition', () => {
  assert.equal(filenameFromContentDisposition('attachment; filename="a b.mp4"'), 'a b.mp4');
  assert.equal(
    filenameFromContentDisposition("attachment; filename=\"x.pdf\"; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82.pdf"),
    'отчёт.pdf',
  );
  // UTF-8, прочитанный как latin1 (так заголовок отдаёт fetch)
  const mojibake = Buffer.from('отчёт.pdf', 'utf8').toString('latin1');
  assert.equal(filenameFromContentDisposition(`attachment; filename="${mojibake}"`), 'отчёт.pdf');
  assert.equal(filenameFromContentDisposition('attachment; filename="café.txt"'), 'café.txt'); // настоящий latin1 не портим
  assert.equal(filenameFromContentDisposition('attachment; filename=plain.zip'), 'plain.zip');
  assert.equal(filenameFromContentDisposition('inline'), null);
  assert.equal(filenameFromContentDisposition(null), null);
});

test('sanitizeFilename', () => {
  const rick = 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster).mp4';
  assert.equal(sanitizeFilename(rick), rick);
  assert.equal(sanitizeFilename('отчёт: итог?.pdf'), 'отчёт_ итог_.pdf');
  assert.equal(sanitizeFilename('..\\..\\etc/passwd'), 'passwd'); // берём только последний сегмент пути
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeFilename('name. '), 'name');
  assert.equal(sanitizeFilename('😀.png'), '_.png');
  assert.equal(sanitizeFilename(''), 'file');
  assert.equal(sanitizeFilename('...'), 'file');
  const long = sanitizeFilename('я'.repeat(300) + '.mp4');
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.mp4'));
});

test('resolveFilename: заголовок → URL → file', () => {
  assert.equal(resolveFilename({ contentDisposition: 'attachment; filename="a.mp4"', url: 'https://x.com/b.zip' }), 'a.mp4');
  assert.equal(resolveFilename({ contentDisposition: null, url: 'https://x.com/dir/%D1%84%D0%B0%D0%B9%D0%BB.zip?q=1' }), 'файл.zip');
  assert.equal(resolveFilename({ contentDisposition: null, url: 'https://x.com/' }), 'file');
});

test('attemptFilename', () => {
  assert.equal(attemptFilename(1, 10, 'a.mp4'), '01_a.mp4');
  assert.equal(attemptFilename(10, 10, 'a.mp4'), '10_a.mp4');
  assert.equal(attemptFilename(7, 100, 'a.mp4'), '007_a.mp4');
});

test('runFolderName', () => {
  assert.equal(runFolderName(new Date(2026, 10, 18, 14, 30, 5)), '2026-11-18 14-30-05');
});

test('Content-Disposition: filename*= с «сырыми» байтами UTF-8 вместо percent-кодирования', () => {
  // так отвечают серверы, нарушающие RFC 5987; fetch отдаёт эти байты как latin1
  const mojibake = Buffer.from('отчёт за 2026.pdf', 'utf8').toString('latin1');
  assert.equal(filenameFromContentDisposition(`attachment; filename*=UTF-8''${mojibake}`), 'отчёт за 2026.pdf');
});

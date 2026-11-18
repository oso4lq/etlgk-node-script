import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_URL, normalizeUrl } from '../lib/url.js';

const ID = '1Pk2Gk1l2TODrjQO0xxaAAfvZCJ9khqVR';
const DIRECT = `https://drive.usercontent.google.com/download?id=${ID}&export=download`;

test('DEFAULT_URL — прямая ссылка', () => assert.equal(DEFAULT_URL, DIRECT));

test('ссылки Drive приводятся к прямой', () => {
  for (const input of [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?export=download&id=${ID}`,
    DIRECT,
    `  ${DIRECT}  `,
  ]) assert.deepEqual(normalizeUrl(input), { ok: true, url: DIRECT, driveId: ID }, input);
});

test('обычная ссылка не меняется', () => {
  assert.deepEqual(normalizeUrl('https://example.com/a/file.zip?x=1'),
    { ok: true, url: 'https://example.com/a/file.zip?x=1', driveId: null });
});

test('невалидные ссылки', () => {
  assert.equal(normalizeUrl('').ok, false);
  assert.equal(normalizeUrl('просто текст').reason, 'Некорректная ссылка');
  assert.equal(normalizeUrl('ftp://example.com/f.zip').reason, 'Поддерживаются только ссылки http и https');
  assert.match(normalizeUrl('https://drive.google.com/drive/folders/abc123').reason, /папк/);
  assert.match(normalizeUrl('https://docs.google.com/document/d/abc123/edit').reason, /Google Docs/);
});

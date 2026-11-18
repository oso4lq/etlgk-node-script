import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRunDir, removeRunDir, removeIfEmpty } from '../lib/rundir.js';

const DATE = new Date(2026, 10, 18, 14, 30, 5);
const exists = (p) => fs.access(p).then(() => true, () => false);

async function withTmp(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-rundir-'));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('createRunDir создаёт downloads/{timestamp}', () => withTmp(async (tmp) => {
  const dir = await createRunDir(tmp, DATE);
  assert.equal(dir, path.join(tmp, 'downloads', '2026-11-18 14-30-05'));
  assert.ok((await fs.stat(dir)).isDirectory());
}));

test('createRunDir не переиспользует существующую папку', () => withTmp(async (tmp) => {
  await createRunDir(tmp, DATE);
  const second = await createRunDir(tmp, DATE);
  const third = await createRunDir(tmp, DATE);
  assert.equal(second, path.join(tmp, 'downloads', '2026-11-18 14-30-05 (2)'));
  assert.equal(third, path.join(tmp, 'downloads', '2026-11-18 14-30-05 (3)'));
}));

test('removeRunDir удаляет папку запуска, но не downloads', () => withTmp(async (tmp) => {
  const dir = await createRunDir(tmp, DATE);
  await fs.writeFile(path.join(dir, '01_a.bin'), 'data');
  await removeRunDir(dir);
  assert.equal(await exists(dir), false);
  assert.equal(await exists(path.join(tmp, 'downloads')), true);
}));

test('removeIfEmpty удаляет только пустую папку', () => withTmp(async (tmp) => {
  const empty = await createRunDir(tmp, DATE);
  const full = await createRunDir(tmp, DATE);
  await fs.writeFile(path.join(full, '01_a.bin'), 'data');
  await removeIfEmpty(empty);
  await removeIfEmpty(full);
  assert.equal(await exists(empty), false);
  assert.equal(await exists(full), true);
}));

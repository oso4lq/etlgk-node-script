import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, createSpeedMeter } from '../lib/stats.js';

test('computeStats', () => {
  const s = computeStats([
    { index: 1, ok: true, bytes: 1048576, durationMs: 1000, retries: 0 },
    { index: 2, ok: true, bytes: 1048576, durationMs: 3000, retries: 1 },
    { index: 3, ok: false, bytes: 500, durationMs: 9999, retries: 3, error: 'x' },
  ]);
  assert.deepEqual(s, {
    okCount: 2, failCount: 1, totalBytes: 2097152, totalMs: 4000,
    avgMs: 2000, minMs: 1000, maxMs: 3000, avgSpeed: 524288,
  });
});

test('computeStats без успешных попыток и с нулевым временем', () => {
  assert.deepEqual(computeStats([]), {
    okCount: 0, failCount: 0, totalBytes: 0, totalMs: 0,
    avgMs: 0, minMs: 0, maxMs: 0, avgSpeed: 0,
  });
  assert.equal(computeStats([{ index: 1, ok: true, bytes: 10, durationMs: 0, retries: 0 }]).avgSpeed, 0);
});

test('createSpeedMeter', () => {
  const m = createSpeedMeter(1000);
  assert.equal(m.speed(), 0);
  m.push(0, 0); m.push(1000, 500); m.push(2000, 1000);
  assert.equal(m.speed(), 2000);
  m.push(2000, 3000); // данные не идут 2 с — старые замеры вышли из окна
  assert.equal(m.speed(), 0);
});

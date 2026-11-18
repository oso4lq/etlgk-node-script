import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatSpeed, formatDuration } from '../lib/format.js';

test('formatBytes подбирает единицу', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(29903185), '28.52 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.00 GB');
  assert.equal(formatBytes(5 * 1024 ** 4), '5.00 TB');
  assert.equal(formatBytes(1024 ** 5), '1024.00 TB'); // выше TB не поднимаемся
});

test('formatSpeed', () => {
  assert.equal(formatSpeed(5463000), '5.21 MB/s');
  assert.equal(formatSpeed(0), '0 B/s');
  assert.equal(formatSpeed(Infinity), '0 B/s');
  assert.equal(formatSpeed(NaN), '0 B/s');
});

test('formatDuration', () => {
  assert.equal(formatDuration(850), '850 мс');
  assert.equal(formatDuration(5480), '5.48 с');
  assert.equal(formatDuration(125000), '2 мин 05 с');
});

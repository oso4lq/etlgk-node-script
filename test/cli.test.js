import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, HELP_TEXT } from '../lib/cli.js';

test('parseCliArgs', () => {
  assert.deepEqual(parseCliArgs([]), { url: null, count: 10, yes: false, help: false });
  assert.deepEqual(parseCliArgs(['https://x.com/a.zip', '--count', '3', '--yes']),
    { url: 'https://x.com/a.zip', count: 3, yes: true, help: false });
  assert.deepEqual(parseCliArgs(['-c', '2', '-y', 'https://x.com/a.zip']),
    { url: 'https://x.com/a.zip', count: 2, yes: true, help: false });
  assert.equal(parseCliArgs(['-h']).help, true);
  assert.equal(parseCliArgs(['--help']).help, true);
});

test('parseCliArgs отклоняет неверные аргументы понятным сообщением', () => {
  for (const bad of [['--count', '0'], ['--count', 'abc'], ['--count', '1.5'], ['--count', '1001'], ['--count', '-3'], ['--nope'], ['a', 'b']]) {
    assert.throws(() => parseCliArgs(bad), (err) => {
      assert.match(err.message, /[а-яё]/i, `сообщение на русском для "${bad.join(' ')}": ${err.message}`);
      return true;
    }, bad.join(' '));
  }
});

test('HELP_TEXT описывает флаги', () => {
  for (const part of ['--count', '--yes', '--help']) assert.ok(HELP_TEXT.includes(part), part);
});

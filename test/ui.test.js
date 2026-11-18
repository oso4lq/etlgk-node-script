import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { renderBar, renderProgressLine, renderAttemptLine, renderSummary, createUi } from '../lib/ui.js';
import { computeStats } from '../lib/stats.js';

test('renderBar', () => {
  assert.equal(renderBar(0.5, 10), '█████░░░░░');
  assert.equal(renderBar(0, 4), '░░░░');
  assert.equal(renderBar(1.7, 4), '████');
  assert.equal(renderBar(-1, 4), '░░░░');
  assert.equal(renderBar(NaN, 4), '░░░░');
  assert.equal(renderBar(0.5).length, 20);
});

test('renderProgressLine с известным размером', () => {
  const line = renderProgressLine({ index: 3, total: 10, received: 18245222, size: 29903185, speed: 5463000, etaMs: 2000 });
  for (const part of [' 3/10', '61%', '17.40 MB / 28.52 MB', '5.21 MB/s', 'осталось 2.00 с', '█']) {
    assert.ok(line.includes(part), `${part} в "${line}"`);
  }
});

test('renderProgressLine без размера', () => {
  const line = renderProgressLine({ index: 1, total: 10, received: 2048, size: null, speed: 1024, etaMs: null });
  assert.ok(line.includes('2.00 KB') && line.includes('1.00 KB/s'), line);
  assert.ok(!line.includes('%') && !line.includes('█') && !line.includes('осталось'), line);
});

test('renderAttemptLine', () => {
  const ok = renderAttemptLine({ index: 3, ok: true, bytes: 1048576, durationMs: 2000, retries: 1 }, 10);
  for (const part of [' 3/10', 'OK', '2.00 с', '1.00 MB', '512.00 KB/s', 'повторов: 1']) assert.ok(ok.includes(part), `${part} в "${ok}"`);
  const failed = renderAttemptLine({ index: 4, ok: false, bytes: 0, durationMs: 0, retries: 3, error: 'HTTP 500' }, 10);
  for (const part of [' 4/10', 'ОШИБКА', 'HTTP 500']) assert.ok(failed.includes(part), `${part} в "${failed}"`);
});

test('renderSummary', () => {
  const attempts = [
    { index: 1, ok: true, bytes: 1048576, durationMs: 1000, retries: 0 },
    { index: 2, ok: false, bytes: 0, durationMs: 0, retries: 3, error: 'HTTP 500' },
  ];
  const out = renderSummary(attempts, computeStats(attempts));
  for (const part of ['Среднее время запроса', 'Общее время', 'Общий объём', 'Скорость скачивания',
    '1.00 MB', '1.00 MB/s', 'OK', 'HTTP 500', 'повторов: 3', '1 из 2']) {
    assert.ok(out.includes(part), `${part} в:\n${out}`);
  }
});

function makeUi({ isTTY, typed = null }) {
  const output = new PassThrough();
  const input = new PassThrough();
  let text = '';
  output.on('data', (chunk) => { text += chunk; });
  if (typed !== null) input.write(typed);
  const ui = createUi({ output, input, isTTY });
  return { ui, input, text: () => text };
}

test('не терминал: прогресс и управляющие символы не выводятся', () => {
  const { ui, text } = makeUi({ isTTY: false });
  ui.stage(1, 4, 'Проверка ссылки');
  ui.progress({ index: 1, total: 10, received: 10, size: 100, speed: 5, etaMs: 1000 });
  ui.progressEnd();
  ui.info('готово');
  ui.warn('осторожно');
  ui.error('сбой');
  assert.ok(text().includes('[1/4] Проверка ссылки'));
  assert.ok(text().includes('готово') && text().includes('осторожно') && text().includes('сбой'));
  assert.ok(!text().includes('\r') && !text().includes('\x1b'), JSON.stringify(text()));
  assert.ok(!text().includes('█'));
});

test('не терминал: вопросы не задаются', async () => {
  const { ui, text } = makeUi({ isTTY: false, typed: 'y\n' });
  assert.equal(await ui.confirm('Удалить? (y/N) '), false);
  assert.equal(await ui.askText('Ссылка: '), '');
  assert.equal(text(), '');
});

test('терминал: прогресс выводится', () => {
  const { ui, text } = makeUi({ isTTY: true });
  ui.progress({ index: 1, total: 10, received: 50, size: 100, speed: 5, etaMs: 1000 });
  assert.ok(text().includes('█') && text().includes('50%'), JSON.stringify(text()));
});

test('терминал: confirm понимает y/д/да, остальное — нет', async () => {
  const cases = { 'y\n': true, 'Y\n': true, 'yes\n': true, 'Д\n': true, 'да\n': true, '\n': false, 'n\n': false, 'что-то\n': false };
  for (const [typed, expected] of Object.entries(cases)) {
    const { ui } = makeUi({ isTTY: true, typed });
    assert.equal(await ui.confirm('Удалить? (y/N) '), expected, JSON.stringify(typed));
    ui.close();
  }
});

test('терминал: askText возвращает введённую строку без пробелов по краям', async () => {
  const { ui, text } = makeUi({ isTTY: true, typed: '  https://example.com/a.zip \n' });
  assert.equal(await ui.askText('Ссылка: '), 'https://example.com/a.zip');
  assert.ok(text().includes('Ссылка: '));
});

test('терминал: закрытый ввод даёт ответ по умолчанию', async () => {
  const { ui, input } = makeUi({ isTTY: true });
  const answer = ui.confirm('Удалить? (y/N) ');
  input.end();
  assert.equal(await answer, false);
});

test('терминал: Ctrl+C во время вопроса завершает его ответом по умолчанию', async () => {
  const output = new PassThrough();
  output.resume();
  const controller = new AbortController();
  const ui = createUi({ output, input: new PassThrough(), isTTY: true, signal: controller.signal });
  const answer = ui.confirm('Удалить? (y/N) ');
  controller.abort();
  assert.equal(await answer, false);
  assert.equal(await ui.askText('Ссылка: '), '', 'после прерывания вопросы больше не задаются');
});

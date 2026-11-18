#!/usr/bin/env node
// Точка входа: связывает процесс (аргументы, Ctrl+C, консоль) со сценарием.

import { run } from './lib/app.js';
import { createUi } from './lib/ui.js';

const controller = new AbortController();
let interrupts = 0;
process.on('SIGINT', () => {
  interrupts += 1;
  if (interrupts > 1) process.exit(130); // повторный Ctrl+C — выходим немедленно
  controller.abort(); // первый — аккуратно: удаляем недокачанный файл, печатаем итог
});

// Вопросы задаём, только если и ввод, и вывод — настоящий терминал.
const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const ui = createUi({ output: process.stdout, input: process.stdin, isTTY, signal: controller.signal });

let exitCode;
try {
  exitCode = await run({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    ui,
    signal: controller.signal,
    isTTY,
  });
} catch (err) {
  ui.error(`Непредвиденная ошибка: ${err?.message ?? err}`);
  exitCode = 1;
} finally {
  ui.close();
}
process.exitCode = exitCode;

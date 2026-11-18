// Разбор аргументов командной строки.

import { parseArgs } from 'node:util';
import { DEFAULT_URL } from './url.js';

const DEFAULT_COUNT = 10;
const MAX_COUNT = 1000;

export const HELP_TEXT = `Замер скорости скачивания: файл по ссылке скачивается несколько раз подряд.

Использование:
  node index.js [ссылка] [флаги]

Если ссылка не указана, скрипт спросит её и предложит файл по умолчанию:
  ${DEFAULT_URL}

Флаги:
  -c, --count N   сколько запросов сделать (от 1 до ${MAX_COUNT}, по умолчанию ${DEFAULT_COUNT})
  -y, --yes       не спрашивать подтверждение для файлов неизвестного формата
  -h, --help      показать эту справку

Файлы сохраняются в папку downloads/{дата и время запуска}/ в текущем каталоге.
Коды выхода: 0 — успех, 1 — ошибка, 130 — прервано (Ctrl+C).`;

/**
 * @param {string[]} argv аргументы без "node" и имени скрипта
 * @returns {{url: string|null, count: number, yes: boolean, help: boolean}}
 * @throws {Error} с сообщением для пользователя
 */
export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        count: { type: 'string', short: 'c' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    if (err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      const flag = err.message.match(/'([^']+)'/)?.[1];
      throw new Error(`Неизвестный флаг${flag ? ` ${flag}` : ''}`);
    }
    throw new Error('Не удалось разобрать аргументы: проверьте, что у флага --count указано число');
  }

  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new Error('Ожидается одна ссылка. Если в ссылке есть символ &, возьмите её в кавычки');
  }

  let count = DEFAULT_COUNT;
  if (values.count !== undefined) {
    if (!/^\d+$/.test(values.count) || Number(values.count) < 1 || Number(values.count) > MAX_COUNT) {
      throw new Error(`Значение --count должно быть целым числом от 1 до ${MAX_COUNT}`);
    }
    count = Number(values.count);
  }

  return {
    url: positionals[0] ?? null,
    count,
    yes: Boolean(values.yes),
    help: Boolean(values.help),
  };
}

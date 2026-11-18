// Локальный HTTP-сервер для тестов: тесты не ходят в интернет.

import http from 'node:http';

/**
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, n: number) => void} handler
 *   n — порядковый номер запроса, начиная с 1
 * @returns {Promise<{url: string, requests: string[], close(): Promise<void>}>}
 */
export function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    handler(req, res, requests.length);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

/** Обычный ответ с файлом. */
export function sendFile(res, body, { type = 'video/mp4', name = 'clip.mp4', length = true, headers = {} } = {}) {
  const head = { 'Content-Type': type, ...headers };
  if (name) head['Content-Disposition'] = `attachment; filename="${name}"`;
  if (length) head['Content-Length'] = body.length;
  res.writeHead(200, head);
  res.end(body);
}

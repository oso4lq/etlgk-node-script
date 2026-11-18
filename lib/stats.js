// Итоги запуска и текущая скорость загрузки.

/**
 * @typedef {{index: number, ok: boolean, bytes: number, durationMs: number, retries: number, error?: string}} AttemptResult
 */

/**
 * Итоги по попыткам. Время и объём считаются только по успешным:
 * неудачная попытка не должна искажать скорость.
 * Средняя скорость = общий объём / суммарное время, в байтах в секунду.
 * @param {AttemptResult[]} attempts
 */
export function computeStats(attempts) {
  const ok = attempts.filter((a) => a.ok);
  const totalBytes = ok.reduce((sum, a) => sum + a.bytes, 0);
  const totalMs = ok.reduce((sum, a) => sum + a.durationMs, 0);
  const durations = ok.map((a) => a.durationMs);
  return {
    okCount: ok.length,
    failCount: attempts.length - ok.length,
    totalBytes,
    totalMs,
    avgMs: ok.length ? totalMs / ok.length : 0,
    minMs: ok.length ? Math.min(...durations) : 0,
    maxMs: ok.length ? Math.max(...durations) : 0,
    avgSpeed: totalMs > 0 ? totalBytes / (totalMs / 1000) : 0,
  };
}

/**
 * Текущая скорость за скользящее окно: показывает, что происходит сейчас,
 * а не среднее с начала загрузки.
 * @param {number} windowMs
 */
export function createSpeedMeter(windowMs = 1000) {
  /** @type {{bytes: number, time: number}[]} */
  let samples = [];
  return {
    /** @param {number} totalReceived всего получено байт  @param {number} nowMs */
    push(totalReceived, nowMs) {
      samples.push({ bytes: totalReceived, time: nowMs });
      samples = samples.filter((s) => nowMs - s.time <= windowMs);
    },
    /** @returns {number} байт в секунду */
    speed() {
      if (samples.length < 2) return 0;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const elapsedMs = last.time - first.time;
      return elapsedMs > 0 ? ((last.bytes - first.bytes) / elapsedMs) * 1000 : 0;
    },
  };
}

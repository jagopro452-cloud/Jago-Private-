/**
 * In-process request and error counters for API error rate calculation.
 * Node.js single-threaded event loop makes these safe without locks.
 * Counters reset every hour; callers get rate as a percentage.
 */

let requestCount = 0;
let errorCount = 0;
let windowStartMs = Date.now();
const WINDOW_MS = 60 * 60 * 1000; // 1-hour rolling window

export function recordRequest(): void { requestCount++; }
export function recordError(): void   { errorCount++; }

export function getApiErrorStats(): {
  requestCount: number;
  errorCount: number;
  errorRatePct: number;
  windowAgeMs: number;
} {
  return {
    requestCount,
    errorCount,
    errorRatePct: requestCount > 0
      ? Math.round((errorCount / requestCount) * 1000) / 10
      : 0,
    windowAgeMs: Date.now() - windowStartMs,
  };
}

// Reset hourly so rate reflects recent behavior
setInterval(() => {
  requestCount = 0;
  errorCount = 0;
  windowStartMs = Date.now();
}, WINDOW_MS);

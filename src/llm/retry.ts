/**
 * Retry a flaky async operation with exponential backoff.
 *
 * Extracted from src/llm/visual-gate.ts so the visual gate and the rubric
 * runner share one proven retry path instead of duplicating it. Behaviour is
 * unchanged from the original visual-gate implementation: `maxAttempts` total
 * tries (default 3), backoff `retryDelayMs * 3^(attempt-1)` between them, and
 * the last error rethrown when every attempt fails.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  retryDelayMs: number,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = retryDelayMs * Math.pow(3, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

import { test, expect } from '@playwright/test';
import { withRetries } from '../../src/llm/retry.js';

test('returns the value on first success without retrying', async () => {
  let calls = 0;
  const result = await withRetries(async () => {
    calls++;
    return 'ok';
  }, 1);
  expect(result).toBe('ok');
  expect(calls).toBe(1);
});

test('retries on failure then succeeds', async () => {
  let calls = 0;
  const result = await withRetries(async () => {
    calls++;
    if (calls < 3) throw new Error('transient');
    return 'recovered';
  }, 1);
  expect(result).toBe('recovered');
  expect(calls).toBe(3);
});

test('throws the last error after exhausting all attempts', async () => {
  let calls = 0;
  await expect(
    withRetries(async () => {
      calls++;
      throw new Error(`boom-${calls}`);
    }, 1),
  ).rejects.toThrow('boom-3');
  expect(calls).toBe(3);
});

test('respects a custom maxAttempts', async () => {
  let calls = 0;
  await expect(
    withRetries(
      async () => {
        calls++;
        throw new Error('always');
      },
      1,
      5,
    ),
  ).rejects.toThrow('always');
  expect(calls).toBe(5);
});

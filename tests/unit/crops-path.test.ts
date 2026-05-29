import { test, expect } from '@playwright/test';
import { cropPath } from '../../src/crops/path.js';

test('cropPath builds the canonical <outputDir>/crops/<runId>/<findingId>.png path', () => {
  const p = cropPath('/out', { id: 'f-abc123', runId: 'run-2026-05-29' });
  expect(p).toBe('/out/crops/run-2026-05-29/f-abc123.png');
});

test('cropPath: different runIds produce non-colliding paths', () => {
  const a = cropPath('/out', { id: 'f-1', runId: 'runA' });
  const b = cropPath('/out', { id: 'f-1', runId: 'runB' });
  expect(a).not.toBe(b);
});

test('cropPath: different findingIds within a run produce non-colliding paths', () => {
  const a = cropPath('/out', { id: 'f-1', runId: 'runA' });
  const b = cropPath('/out', { id: 'f-2', runId: 'runA' });
  expect(a).not.toBe(b);
});

// tests/unit/agent-loop.test.ts
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runSession } from '../../src/discovery/agent-loop.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Page } from '@playwright/test';

const TMP_DIR = join(process.cwd(), 'data', 'tmp');
const TEST_SCREENSHOTS = join(TMP_DIR, 'agent-loop-screenshots');

function makeMockPage(): Page {
  return {
    on: () => {},
    goto: async () => ({ status: () => 200 }),
    title: async () => 'Test Product',
    url: () => 'https://www.ryzesuperfoods.com/products/coffee',
    waitForTimeout: async () => {},
    screenshot: async ({ path }: { path: string }) => { writeFileSync(path, Buffer.from('PNG')); },
    evaluate: async () => {},
    content: async () => '<html><body>Test</body></html>',
    locator: () => ({ first: () => ({ click: async () => {}, innerHTML: async () => '', waitFor: async () => {} }) }),
  } as unknown as Page;
}

function makeMockClient(responses: Anthropic.Message[]): Anthropic {
  let callIndex = 0;
  return {
    messages: {
      create: async () => {
        const response = responses[Math.min(callIndex, responses.length - 1)];
        callIndex++;
        return response;
      },
    },
  } as unknown as Anthropic;
}

function makeEndTurnResponse(): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'I have reviewed the pages.' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

function makeDoneResponse(): Anthropic.Message {
  return {
    id: 'msg_done',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tu_done', name: 'done', input: {} }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

test.beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(TEST_SCREENSHOTS, { recursive: true });
});

test('session ends when Claude returns end_turn with no tool use', async ({}, testInfo) => {
  const discoveriesPath = join(TMP_DIR, `al-discoveries-${testInfo.workerIndex}.jsonl`);
  writeFileSync(discoveriesPath, '');
  const client = makeMockClient([makeEndTurnResponse()]);
  const result = await runSession({
    client,
    page: makeMockPage(),
    personaSystemPrompt: 'You are a test persona.',
    personaName: 'test-persona',
    targetUrls: ['https://www.ryzesuperfoods.com/products/coffee'],
    previousFindingsSummary: '',
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath,
  });
  expect(result.toolCallCount).toBe(0);
  expect(result.visitedUrls).toHaveLength(0);
});

test('session ends when Claude calls done()', async ({}, testInfo) => {
  const discoveriesPath = join(TMP_DIR, `al-discoveries-${testInfo.workerIndex}.jsonl`);
  writeFileSync(discoveriesPath, '');
  const client = makeMockClient([makeDoneResponse()]);
  const result = await runSession({
    client,
    page: makeMockPage(),
    personaSystemPrompt: 'You are a test persona.',
    personaName: 'test-persona',
    targetUrls: ['https://www.ryzesuperfoods.com/products/coffee'],
    previousFindingsSummary: '',
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath,
  });
  expect(result.toolCallCount).toBe(1);
});

test('previousFindingsSummary is included in user message', async ({}, testInfo) => {
  const discoveriesPath = join(TMP_DIR, `al-discoveries-${testInfo.workerIndex}.jsonl`);
  writeFileSync(discoveriesPath, '');
  let capturedMessage = '';
  const client = {
    messages: {
      create: async ({ messages }: { messages: Anthropic.MessageParam[] }) => {
        capturedMessage = messages[0].content as string;
        return makeEndTurnResponse();
      },
    },
  } as unknown as Anthropic;

  await runSession({
    client,
    page: makeMockPage(),
    personaSystemPrompt: 'You are a test persona.',
    personaName: 'test-persona',
    targetUrls: ['https://www.ryzesuperfoods.com/products/coffee'],
    previousFindingsSummary: '[discovery:fake-timer] https://... — timer resets on refresh',
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath,
  });
  expect(capturedMessage).toContain('Previously found this run');
  expect(capturedMessage).toContain('fake-timer');
});

test('session respects sessionBudget URL cap', async ({}, testInfo) => {
  const discoveriesPath = join(TMP_DIR, `al-discoveries-${testInfo.workerIndex}.jsonl`);
  writeFileSync(discoveriesPath, '');
  const navigateResponse: Anthropic.Message = {
    id: 'msg_nav',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tu_nav', name: 'navigate', input: { url: 'https://www.ryzesuperfoods.com/products/coffee' } },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
  const client = makeMockClient([navigateResponse, makeDoneResponse()]);
  const result = await runSession({
    client,
    page: makeMockPage(),
    personaSystemPrompt: 'You are a test persona.',
    personaName: 'test-persona',
    targetUrls: ['https://www.ryzesuperfoods.com/products/coffee'],
    previousFindingsSummary: '',
    screenshotsDir: TEST_SCREENSHOTS,
    discoveriesPath,
    sessionBudget: 1,
  });
  expect(result.visitedUrls).toHaveLength(1);
});

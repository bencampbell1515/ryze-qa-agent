// src/discovery/agent-loop.ts
import Anthropic from '@anthropic-ai/sdk';
import { type Page } from '@playwright/test';
import { createTools } from './tools.js';

const MAX_TOOL_CALLS = 150;

export interface SessionOptions {
  client: Anthropic;
  page: Page;
  personaSystemPrompt: string;
  personaName: string;
  targetUrls: string[];
  previousFindingsSummary: string;
  screenshotsDir: string;
  discoveriesPath: string;
  sessionBudget?: number;
  model?: string;
}

export interface SessionResult {
  visitedUrls: string[];
  toolCallCount: number;
}

function formatToolResult(
  toolName: string,
  result: Record<string, unknown>
): Anthropic.ToolResultBlockParam['content'] {
  if (toolName === 'screenshot' && result.base64 && !result.error) {
    return [
      { type: 'text', text: `Screenshot saved to ${result.path as string}` },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: result.base64 as string },
      },
    ];
  }
  return JSON.stringify(result);
}

export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  const {
    client, page, personaSystemPrompt, personaName,
    targetUrls, previousFindingsSummary, screenshotsDir,
    discoveriesPath, sessionBudget = 20, model,
  } = opts;

  const tools = createTools(page, { screenshotsDir, discoveriesPath, personaName });
  const urlBatch = targetUrls.slice(0, sessionBudget);

  const userContent = [
    previousFindingsSummary ? `Previously found this run:\n${previousFindingsSummary}\n` : '',
    `Your target URLs this session (visit in any order, skip irrelevant ones):\n${urlBatch.map(u => `- ${u}`).join('\n')}`,
    `\nUse your tools to explore. Take screenshots to see the page. Call done() when finished with these URLs.`,
  ].filter(Boolean).join('\n');

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ];

  let toolCallCount = 0;
  let lastToolKey = '';
  let consecutiveCount = 0;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const response = await client.messages.create({
      model: model ?? 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: personaSystemPrompt,
      tools: tools.definitions,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    if (toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let sessionDone = false;

    for (const toolUse of toolUses) {
      toolCallCount++;

      if (toolUse.name === 'done') {
        sessionDone = true;
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Session complete.' });
        break;
      }

      const currentToolKey = `${toolUse.name}:${JSON.stringify(toolUse.input)}`;
      if (currentToolKey === lastToolKey) {
        consecutiveCount++;
      } else {
        lastToolKey = currentToolKey;
        consecutiveCount = 1;
      }
      if (consecutiveCount >= 3) {
        const reflection =
          '[LOOP GUARD] You have called the same tool with the same arguments 3 times in a row. This suggests you may be stuck. Choose a different approach, try a different selector, or call done() if you have processed all URLs in your batch.';
        messages.push({ role: 'user', content: reflection });
        consecutiveCount = 0;
      }

      const result = await tools.execute(toolUse.name, toolUse.input as Record<string, unknown>);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: formatToolResult(toolUse.name, result),
      });

      if (tools.getVisitedUrls().length >= sessionBudget) {
        sessionDone = true;
        break;
      }
    }

    messages.push({ role: 'user', content: toolResults });
    if (sessionDone) break;
  }

  return { visitedUrls: tools.getVisitedUrls(), toolCallCount };
}

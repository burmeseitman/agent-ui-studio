import { describe, expect, it } from 'vitest';
import { applyToolResults, resolveToolMode, toWireMessages } from './useChat';
import { ChatMessage } from '../types';

const base = { timestamp: 0 };

describe('toWireMessages', () => {
  it('prepends the system prompt when there is one', () => {
    const wire = toWireMessages([{ id: '1', role: 'user', content: 'hi', ...base }], 'be helpful');
    expect(wire[0]).toEqual({ role: 'system', content: 'be helpful' });
    expect(wire[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('omits an empty system prompt', () => {
    const wire = toWireMessages([{ id: '1', role: 'user', content: 'hi', ...base }], '');
    expect(wire).toHaveLength(1);
  });

  it('expands executed tool calls into assistant + tool message pairs', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'what files are here?', ...base },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Let me look.',
        ...base,
        toolCalls: [
          {
            id: 'call_1',
            toolName: 'list_dir',
            arguments: '{"path":"."}',
            output: 'README.md',
            status: 'success',
          },
        ],
      },
    ];

    const wire = toWireMessages(messages, '');
    expect(wire).toEqual([
      { role: 'user', content: 'what files are here?' },
      {
        role: 'assistant',
        content: 'Let me look.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } },
        ],
      },
      { role: 'tool', name: 'list_dir', tool_call_id: 'call_1', content: 'README.md' },
    ]);
  });

  it('tells the model when the user denied a tool call', () => {
    const wire = toWireMessages(
      [
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          ...base,
          toolCalls: [
            { id: 'c1', toolName: 'write_file', arguments: '{}', status: 'denied' },
          ],
        },
      ],
      ''
    );

    expect(wire[1].role).toBe('tool');
    expect(wire[1].content).toMatch(/denied permission/i);
  });

  it('passes tool errors back to the model instead of dropping them', () => {
    const wire = toWireMessages(
      [
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          ...base,
          toolCalls: [
            { id: 'c1', toolName: 'read_file', arguments: '{}', error: 'no such file', status: 'error' },
          ],
        },
      ],
      ''
    );

    expect(wire[1].content).toBe('ERROR: no such file');
  });

  it('never sends unapproved tool calls to the model', () => {
    const wire = toWireMessages(
      [
        {
          id: 'a1',
          role: 'assistant',
          content: 'I need to run something.',
          ...base,
          toolCalls: [
            { id: 'c1', toolName: 'execute_command', arguments: '{"command":"ls"}', status: 'pending' },
          ],
        },
      ],
      ''
    );

    expect(wire.some((m) => m.role === 'tool')).toBe(false);
    expect(wire.some((m) => m.tool_calls)).toBe(false);
    expect(wire[0]).toEqual({ role: 'assistant', content: 'I need to run something.' });
  });

  it('drops empty assistant placeholders', () => {
    const wire = toWireMessages(
      [
        { id: 'u1', role: 'user', content: 'hi', ...base },
        { id: 'a1', role: 'assistant', content: '', ...base, isStreaming: true },
      ],
      ''
    );
    expect(wire).toHaveLength(1);
  });
});

describe('applyToolResults', () => {
  const message: ChatMessage = {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    toolCalls: [
      { id: 'c1', toolName: 'list_dir', arguments: '{}', status: 'pending' },
      { id: 'c2', toolName: 'read_file', arguments: '{}', status: 'pending' },
    ],
  };

  it('applies every outcome, including the last one written', () => {
    // Regression: reading the messages ref back after dispatch dropped the final
    // tool result, so the model was handed an empty "running" call.
    const patched = applyToolResults(
      [message],
      'a1',
      new Map([
        ['c1', { status: 'success' as const, output: 'README.md' }],
        ['c2', { status: 'success' as const, output: 'package main' }],
      ])
    );

    const wire = toWireMessages(patched, '');
    const toolMessages = wire.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((m) => m.content)).toEqual(['README.md', 'package main']);
    // No tool result may be sent back empty — that was the symptom of the bug.
    expect(toolMessages.some((m) => m.content === '')).toBe(false);
  });

  it('leaves untouched calls and other messages alone', () => {
    const patched = applyToolResults(
      [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, message],
      'a1',
      new Map([['c1', { status: 'denied' as const }]])
    );

    expect(patched[0]).toEqual({ id: 'u1', role: 'user', content: 'hi', timestamp: 0 });
    expect(patched[1].toolCalls?.[0].status).toBe('denied');
    expect(patched[1].toolCalls?.[1].status).toBe('pending');
  });
});

function bigMessage(id: string, role: 'user' | 'assistant', chars: number): ChatMessage {
  // Content is id-prefixed so tests can tell same-sized messages apart.
  return { id, role, content: `${id}:${'x'.repeat(chars)}`, timestamp: 0 };
}

describe('toWireMessages context budget', () => {
  it('drops the oldest turns once the budget is exceeded', () => {
    const messages = [
      bigMessage('m1', 'user', 5000),
      bigMessage('m2', 'assistant', 5000),
      bigMessage('m3', 'user', 5000),
      bigMessage('m4', 'assistant', 5000),
    ];

    const wire = toWireMessages(messages, '', 12000);
    const contents = wire.filter((m) => m.role !== 'system').map((m) => m.content.length);

    expect(contents.length).toBeLessThan(4);
    // Newest turns survive; oldest go first.
    expect(wire.some((m) => m.content === messages[3].content)).toBe(true);
    expect(wire.some((m) => m.content === messages[0].content)).toBe(false);
  });

  it('tells the model that history was trimmed', () => {
    const wire = toWireMessages(
      [bigMessage('m1', 'user', 9000), bigMessage('m2', 'assistant', 9000)],
      'sys',
      5000
    );
    expect(wire.filter((m) => m.role === 'system').some((m) => m.content.includes('trimmed'))).toBe(
      true
    );
  });

  it('keeps the newest turn even when it alone exceeds the budget', () => {
    const wire = toWireMessages([bigMessage('m1', 'user', 50000)], '', 1000);
    expect(wire.some((m) => m.role === 'user')).toBe(true);
  });

  it('never separates tool results from the assistant message that requested them', () => {
    const withTools: ChatMessage[] = [
      bigMessage('old', 'user', 20000),
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 'c1', toolName: 'read_file', arguments: '{}', output: 'data', status: 'success' }],
      },
    ];

    const wire = toWireMessages(withTools, '', 1000);
    const assistant = wire.find((m) => m.role === 'assistant');
    const tool = wire.find((m) => m.role === 'tool');

    expect(assistant?.tool_calls).toHaveLength(1);
    expect(tool?.tool_call_id).toBe('c1');
    expect(wire.indexOf(assistant!)).toBeLessThan(wire.indexOf(tool!));
  });

  it('truncates oversized tool output instead of dropping the turn', () => {
    const huge = 'y'.repeat(20000);
    const wire = toWireMessages(
      [
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          timestamp: 0,
          toolCalls: [{ id: 'c1', toolName: 'read_file', arguments: '{}', output: huge, status: 'success' }],
        },
      ],
      ''
    );

    const tool = wire.find((m) => m.role === 'tool')!;
    expect(tool.content.length).toBeLessThan(huge.length);
    expect(tool.content).toContain('truncated');
  });

  it('truncates older tool output harder than the most recent turn', () => {
    const output = 'z'.repeat(20000);
    const toolMessage = (id: string): ChatMessage => ({
      id,
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [{ id: `${id}-c`, toolName: 'read_file', arguments: '{}', output, status: 'success' }],
    });

    const wire = toWireMessages([toolMessage('a1'), toolMessage('a2')], '', 100000);
    const toolMessages = wire.filter((m) => m.role === 'tool');

    expect(toolMessages).toHaveLength(2);
    // The older result is the first in the payload and must be the shorter one.
    expect(toolMessages[0].content.length).toBeLessThan(toolMessages[1].content.length);
  });
});

describe('resolveToolMode', () => {
  const params = {
    profession: 'developer' as const,
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: '',
    autoFallbackToLocal: true,
    enabledTools: ['read_file', 'list_dir', 'write_file'],
    toolApproval: 'read-only' as const,
  };
  const readOnly = { read_file: true, list_dir: true };

  it('auto-approves only read-only tools under the read-only policy', () => {
    expect(resolveToolMode(params, readOnly)).toEqual({
      toolMode: 'auto',
      autoApproveTools: ['read_file', 'list_dir'],
    });
  });

  it('asks for everything under the ask policy', () => {
    expect(resolveToolMode({ ...params, toolApproval: 'ask' }, readOnly)).toEqual({
      toolMode: 'manual',
    });
  });

  it('sends no allowlist under the run-everything policy', () => {
    expect(resolveToolMode({ ...params, toolApproval: 'all' }, readOnly)).toEqual({
      toolMode: 'auto',
    });
  });

  it('falls back to asking when no read-only tool is enabled', () => {
    // An empty allowlist on the wire would mean "approve everything", so the
    // read-only policy must degrade to manual rather than to full autonomy.
    expect(resolveToolMode({ ...params, enabledTools: ['write_file'] }, readOnly)).toEqual({
      toolMode: 'manual',
    });
  });

  it('falls back to asking before the read-only set has loaded', () => {
    expect(resolveToolMode(params, {})).toEqual({ toolMode: 'manual' });
  });
});

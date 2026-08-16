import { describe, expect, it, vi, afterEach } from 'vitest';
import { streamChatCompletion, StreamResult, ToolStreamEvent } from './api';

/** Serves a canned SSE body from a stubbed fetch. */
function mockSSE(body: string, ok = true, status = 200) {
  const stub = vi.fn(async () => ({
    ok,
    status,
    text: async () => body,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        // Emit in small slices so the parser's cross-chunk buffering is exercised.
        const bytes = new TextEncoder().encode(body);
        for (let i = 0; i < bytes.length; i += 7) {
          controller.enqueue(bytes.slice(i, i + 7));
        }
        controller.close();
      },
    }),
  }));
  vi.stubGlobal('fetch', stub);
  return stub;
}

function run(overrides: Record<string, unknown> = {}) {
  return new Promise<{ result: StreamResult; tokens: string[]; toolEvents: ToolStreamEvent[]; error?: Error }>(
    (resolve) => {
      const tokens: string[] = [];
      const toolEvents: ToolStreamEvent[] = [];
      let error: Error | undefined;

      streamChatCompletion({
        engine: 'ollama',
        model: 'llama3',
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: (token) => tokens.push(token),
        onToolEvent: (e) => toolEvents.push(e),
        onError: (e) => {
          error = e;
          resolve({ result: { content: '', toolCalls: [], stats: {} as any }, tokens, toolEvents, error });
        },
        onDone: (result) => resolve({ result, tokens, toolEvents, error }),
        ...overrides,
      });
    }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamChatCompletion', () => {
  it('accumulates content across chunks split mid-payload', async () => {
    mockSSE(
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":", world"}}]}\n\n' +
        'data: [DONE]\n\n'
    );

    const { result, tokens } = await run();
    expect(tokens).toEqual(['Hello', ', world']);
    expect(result.content).toBe('Hello, world');
  });

  it('reassembles tool calls that arrive as indexed argument fragments', async () => {
    mockSSE(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\n' +
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"main.go\\"}"}}]}}]}\n\n' +
        'data: [DONE]\n\n'
    );

    const { result } = await run();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({ path: 'main.go' });
  });

  it('keeps parallel tool calls separate', async () => {
    mockSSE(
      'data: {"choices":[{"delta":{"tool_calls":[' +
        '{"index":0,"id":"a","function":{"name":"list_dir","arguments":"{}"}},' +
        '{"index":1,"id":"b","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n' +
        'data: [DONE]\n\n'
    );

    const { result } = await run();
    expect(result.toolCalls.map((c) => c.name)).toEqual(['list_dir', 'read_file']);
  });

  it('surfaces server-side tool execution events', async () => {
    mockSSE(
      'data: {"object":"agentui.tool_started","tool_call_id":"c1","name":"list_dir","arguments":"{}"}\n\n' +
        'data: {"object":"agentui.tool_result","tool_call_id":"c1","name":"list_dir","arguments":"{}","output":"README.md"}\n\n' +
        'data: {"choices":[{"delta":{"content":"done"}}]}\n\n' +
        'data: [DONE]\n\n'
    );

    const { toolEvents, result } = await run();
    expect(toolEvents.map((e) => e.object)).toEqual([
      'agentui.tool_started',
      'agentui.tool_result',
    ]);
    expect(toolEvents[1].output).toBe('README.md');
    expect(result.content).toBe('done');
  });

  it('reports an in-stream error even when its text mentions JSON', async () => {
    // The old parser sniffed error messages for the substring "JSON" and
    // swallowed anything that matched as a parse failure.
    mockSSE('data: {"error":"model returned invalid JSON schema"}\n\ndata: [DONE]\n\n');

    const { error } = await run();
    expect(error?.message).toBe('model returned invalid JSON schema');
  });

  it('skips malformed payloads without aborting the stream', async () => {
    mockSSE(
      'data: {not json at all}\n\n' +
        'data: {"choices":[{"delta":{"content":"still here"}}]}\n\n' +
        'data: [DONE]\n\n'
    );

    const { result, error } = await run();
    expect(error).toBeUndefined();
    expect(result.content).toBe('still here');
  });

  it('prefers engine-reported usage over the character estimate', async () => {
    mockSSE(
      'data: {"choices":[{"delta":{"content":"abcd"}}]}\n\n' +
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":42,"eval_duration_ms":2000}}\n\n' +
        'data: [DONE]\n\n'
    );

    const { result } = await run();
    expect(result.stats.totalTokens).toBe(42);
    expect(result.stats.promptTokens).toBe(10);
    expect(result.stats.estimated).toBe(false);
    // 42 tokens over the engine's own 2s of generation time.
    expect(result.stats.tokensPerSec).toBeCloseTo(21, 1);
  });

  it('marks stats as estimated when the engine reports no usage', async () => {
    mockSSE('data: {"choices":[{"delta":{"content":"12345678"}}]}\n\ndata: [DONE]\n\n');

    const { result } = await run();
    expect(result.stats.estimated).toBe(true);
    expect(result.stats.totalTokens).toBe(2); // 8 chars / 4
  });

  it('sends the tool mode and enabled tool names to the daemon', async () => {
    const stub = mockSSE('data: [DONE]\n\n');

    await run({ enabledTools: ['read_file'], toolMode: 'auto' });

    const body = JSON.parse((stub.mock.calls[0] as any)[1].body);
    expect(body.enabled_tools).toEqual(['read_file']);
    expect(body.tool_mode).toBe('auto');
  });

  it('defaults to manual tool mode', async () => {
    const stub = mockSSE('data: [DONE]\n\n');

    await run();

    const body = JSON.parse((stub.mock.calls[0] as any)[1].body);
    expect(body.tool_mode).toBe('manual');
  });
});

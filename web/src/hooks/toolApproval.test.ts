import { describe, expect, it, vi, afterEach } from 'vitest';
import { streamChatCompletion } from '../services/api';

/**
 * Reproduces the reported failure: under the default "auto-run reads" policy the
 * daemon executes the read tools and hands back write_file unexecuted. The client
 * treated "auto mode" as "everything ran", dropped the unexecuted call, and the
 * user saw neither a created file nor an approval prompt.
 */
function mockStream(body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => body,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
    }))
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('tool calls the daemon did not execute', () => {
  it('reports a withheld write alongside an executed read', async () => {
    const body =
      // list_dir was auto-approved and ran server-side.
      'data: {"object":"agentui.tool_started","tool_call_id":"c1","name":"list_dir","arguments":"{}"}\n\n' +
      'data: {"object":"agentui.tool_result","tool_call_id":"c1","name":"list_dir","arguments":"{}","output":"a.txt"}\n\n' +
      // write_file was withheld and streamed back for approval.
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c2","function":{"name":"write_file","arguments":"{\\"path\\":\\"notes.txt\\"}"}}]}}]}\n\n' +
      'data: [DONE]\n\n';
    mockStream(body);

    const executed: string[] = [];
    const result = await new Promise<{ toolCalls: Array<{ id: string; name: string }> }>((resolve) => {
      streamChatCompletion({
        engine: 'ollama',
        model: 'm',
        messages: [{ role: 'user', content: 'write a file' }],
        toolMode: 'auto',
        autoApproveTools: ['list_dir'],
        onChunk: () => {},
        onToolEvent: (e) => {
          if (e.object === 'agentui.tool_result') executed.push(e.tool_call_id);
        },
        onError: () => resolve({ toolCalls: [] }),
        onDone: (r) => resolve(r),
      });
    });

    // The read executed server-side.
    expect(executed).toEqual(['c1']);

    // The write came back unexecuted and must be treated as pending, which is
    // what the client derives by subtracting executed ids from streamed calls.
    const pending = result.toolCalls.filter((c) => !executed.includes(c.id));
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe('write_file');
  });

  it('treats a fully auto-executed turn as having nothing pending', async () => {
    const body =
      'data: {"object":"agentui.tool_started","tool_call_id":"c1","name":"list_dir","arguments":"{}"}\n\n' +
      'data: {"object":"agentui.tool_result","tool_call_id":"c1","name":"list_dir","arguments":"{}","output":"a.txt"}\n\n' +
      'data: {"choices":[{"delta":{"content":"Done."}}]}\n\n' +
      'data: [DONE]\n\n';
    mockStream(body);

    const executed: string[] = [];
    const result = await new Promise<{ toolCalls: Array<{ id: string }> }>((resolve) => {
      streamChatCompletion({
        engine: 'ollama',
        model: 'm',
        messages: [{ role: 'user', content: 'list files' }],
        toolMode: 'auto',
        onChunk: () => {},
        onToolEvent: (e) => {
          if (e.object === 'agentui.tool_result') executed.push(e.tool_call_id);
        },
        onError: () => resolve({ toolCalls: [] }),
        onDone: (r) => resolve(r),
      });
    });

    expect(result.toolCalls.filter((c) => !executed.includes(c.id))).toHaveLength(0);
  });
});

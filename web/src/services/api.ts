import {
  EngineInfo,
  EnginesResponse,
  HealthResponse,
  StreamStats,
  StreamToolCall,
  ToolMode,
  ToolsResponse,
  WireMessage,
} from '../types';
import { authHeaders, AuthError } from './auth';

import { daemonBaseUrl } from './daemon';

const getAuthHeaders = authHeaders;

/** Turns a 401 into a typed error so the UI can prompt for a token. */
function assertAuthorized(res: { ok: boolean; status: number }): void {
  if (res.status === 401) {
    throw new AuthError();
  }
}

/** Health is the one unauthenticated route; it tells us whether a token is needed. */
export async function fetchHealth(explicitBaseUrl?: string): Promise<HealthResponse> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/health`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Daemon health check failed: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function fetchEngines(explicitBaseUrl?: string): Promise<EngineInfo[]> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/engines`, {
    headers: { Accept: 'application/json', ...getAuthHeaders() },
    signal: AbortSignal.timeout(30000),
  });
  assertAuthorized(res);
  if (!res.ok) {
    throw new Error(`Failed to fetch engines: HTTP ${res.status}`);
  }
  const data: EnginesResponse = await res.json();
  return data.engines || [];
}

export async function fetchTools(
  profession: string,
  explicitBaseUrl?: string
): Promise<ToolsResponse> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/tools?profession=${encodeURIComponent(profession)}`, {
    headers: { Accept: 'application/json', ...getAuthHeaders() },
    signal: AbortSignal.timeout(30000),
  });
  assertAuthorized(res);
  if (!res.ok) {
    throw new Error(`Failed to fetch tools: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function executeToolApi(
  name: string,
  argumentsJson: string,
  toolCallId?: string,
  explicitBaseUrl?: string
): Promise<{ name: string; output: string; error?: string }> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ name, arguments: argumentsJson, tool_call_id: toolCallId }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 401) {
    return { name, output: '', error: new AuthError().message };
  }
  if (!res.ok) {
    const errText = await res.text();
    return { name, output: '', error: `HTTP ${res.status}: ${errText}` };
  }
  return await res.json();
}

export interface WorkspaceInfo {
  path: string;
  entries?: string[];
  /** True when the sandbox is the home directory, which is rarely intended. */
  is_home_dir?: boolean;
}

/** The directory the daemon's file tools are confined to. */
export async function fetchWorkspace(explicitBaseUrl?: string): Promise<WorkspaceInfo> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/workspace`, {
    headers: { Accept: 'application/json', ...getAuthHeaders() },
    signal: AbortSignal.timeout(15000),
  });
  assertAuthorized(res);
  if (!res.ok) {
    throw new Error(`Failed to read workspace: HTTP ${res.status}`);
  }
  return await res.json();
}

/** Repoints the file tools at another directory. */
export async function setWorkspace(path: string, explicitBaseUrl?: string): Promise<WorkspaceInfo> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ path }),
    signal: AbortSignal.timeout(15000),
  });
  assertAuthorized(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

export interface DaemonSettings {
  project_execution: boolean;
  allowed_commands: string[];
}

export async function fetchSettings(explicitBaseUrl?: string): Promise<DaemonSettings> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/settings`, {
    headers: { Accept: 'application/json', ...getAuthHeaders() },
    signal: AbortSignal.timeout(15000),
  });
  assertAuthorized(res);
  if (!res.ok) throw new Error(`Failed to read settings: HTTP ${res.status}`);
  return await res.json();
}

export async function updateSettings(
  patch: { project_execution?: boolean },
  explicitBaseUrl?: string
): Promise<DaemonSettings> {
  const res = await fetch(`${daemonBaseUrl(explicitBaseUrl)}/api/v1/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(15000),
  });
  assertAuthorized(res);
  if (!res.ok) throw new Error(`Failed to update settings: HTTP ${res.status}`);
  return await res.json();
}

/** A server-side tool execution event, emitted only in `auto` tool mode. */
export interface ToolStreamEvent {
  object: 'agentui.tool_started' | 'agentui.tool_result';
  tool_call_id: string;
  name: string;
  arguments: string;
  output?: string;
  error?: string;
}

/**
 * Sent when the daemon recovered a tool call the model wrote as plain text.
 * `content` is the prose with that JSON removed, so the client can replace what
 * it already streamed.
 */
export interface TextToolCallEvent {
  object: 'agentui.text_tool_calls';
  content: string;
  tool_calls: Array<{ id: string; function: { name: string; arguments: string } }>;
}

/** A condition worth telling the user about that is not a failure. */
export interface NoticeEvent {
  object: 'agentui.notice';
  level: string;
  message: string;
}

export interface StreamResult {
  content: string;
  toolCalls: StreamToolCall[];
  stats: StreamStats;
}

export interface StreamChatOptions {
  daemonUrl?: string;
  engine: string;
  model: string;
  messages: WireMessage[];
  temperature?: number;
  maxTokens?: number;
  enabledTools?: string[];
  toolMode?: ToolMode;
  /** In auto mode, restricts unattended execution to these tools. */
  autoApproveTools?: string[];
  /** Server-side tool rounds allowed for this request. */
  maxToolIterations?: number;
  onChunk: (token: string, fullContent: string, stats: StreamStats) => void;
  onToolEvent?: (event: ToolStreamEvent) => void;
  /** Replaces the visible message text after a text-mode tool call is recovered. */
  onContentReplaced?: (content: string) => void;
  onNotice?: (notice: NoticeEvent) => void;
  onError: (error: Error) => void;
  onDone: (result: StreamResult) => void;
}

/** Reassembles OpenAI-style indexed tool call deltas into whole calls. */
class ToolCallAccumulator {
  private byIndex = new Map<number, StreamToolCall>();
  private order: number[] = [];

  add(delta: any): void {
    const index = typeof delta?.index === 'number' ? delta.index : this.order.length;
    let call = this.byIndex.get(index);
    if (!call) {
      call = { id: '', name: '', arguments: '' };
      this.byIndex.set(index, call);
      this.order.push(index);
    }
    if (delta?.id) call.id = delta.id;
    if (delta?.function?.name) call.name = delta.function.name;
    // Argument fragments arrive as partial JSON strings and must be concatenated.
    if (delta?.function?.arguments) call.arguments += delta.function.arguments;
  }

  calls(): StreamToolCall[] {
    return this.order.map((i, position) => {
      const call = this.byIndex.get(i)!;
      return { ...call, id: call.id || `call_${position}` };
    });
  }
}

function buildStats(
  startTime: number,
  firstTokenTime: number | null,
  fallbackTokens: number,
  usage: { completion_tokens?: number; prompt_tokens?: number; eval_duration_ms?: number } | null
): StreamStats {
  const elapsedMs = performance.now() - startTime;

  // Prefer the engine's own accounting; fall back to a character estimate only
  // when the engine reports nothing, and say so.
  const estimated = !usage || !usage.completion_tokens;
  const totalTokens = estimated ? fallbackTokens : usage!.completion_tokens!;

  // Engine-reported eval duration excludes prompt processing, which makes for a
  // far more honest tokens/sec than wall clock.
  const durationMs = !estimated && usage?.eval_duration_ms ? usage.eval_duration_ms : elapsedMs;
  const tps = totalTokens > 0 && durationMs > 0 ? totalTokens / (durationMs / 1000) : 0;

  return {
    totalTokens,
    promptTokens: usage?.prompt_tokens,
    tokensPerSec: Number(tps.toFixed(1)),
    elapsedMs: Math.round(elapsedMs),
    timeToFirstTokenMs: firstTokenTime ? Math.round(firstTokenTime - startTime) : undefined,
    estimated,
  };
}

export function streamChatCompletion({
  daemonUrl,
  engine,
  model,
  messages,
  temperature,
  maxTokens,
  enabledTools,
  toolMode = 'manual',
  autoApproveTools,
  maxToolIterations,
  onChunk,
  onToolEvent,
  onContentReplaced,
  onNotice,
  onError,
  onDone,
}: StreamChatOptions): () => void {
  const abortController = new AbortController();

  (async () => {
    const startTime = performance.now();
    let firstTokenTime: number | null = null;
    let accumulatedContent = '';
    let usage: any = null;
    const toolCalls = new ToolCallAccumulator();

    const estimateTokens = () => Math.ceil(accumulatedContent.length / 4);

    try {
      const response = await fetch(`${daemonBaseUrl(daemonUrl)}/api/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          engine,
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          enabled_tools: enabledTools,
          tool_mode: toolMode,
          auto_approve_tools: autoApproveTools,
          max_tool_iterations: maxToolIterations,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (response.status === 401) {
        throw new AuthError();
      }
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }
      if (!response.body) {
        throw new Error('Response body is null, streaming unsupported');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finished = false;

      const finish = () => {
        finished = true;
        onDone({
          content: accumulatedContent,
          toolCalls: toolCalls.calls(),
          stats: buildStats(startTime, firstTokenTime, estimateTokens(), usage),
        });
      };

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            finish();
            return;
          }

          // Parsing and interpreting are kept separate so that a genuine error
          // carried by a well-formed event is never mistaken for a parse failure.
          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            console.warn('Skipping malformed SSE payload:', dataStr.slice(0, 200));
            continue;
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.object === 'agentui.tool_started' || parsed.object === 'agentui.tool_result') {
            onToolEvent?.(parsed as ToolStreamEvent);
            continue;
          }

          if (parsed.object === 'agentui.text_tool_calls') {
            // The JSON already streamed into the message; swap it for the prose.
            accumulatedContent = parsed.content ?? '';
            onContentReplaced?.(accumulatedContent);
            continue;
          }

          if (parsed.object === 'agentui.notice') {
            onNotice?.(parsed as NoticeEvent);
            continue;
          }

          if (parsed.usage) {
            usage = parsed.usage;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          for (const call of delta.tool_calls ?? []) {
            toolCalls.add(call);
          }

          const tokenDelta = delta.content || '';
          if (tokenDelta) {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
            }
            accumulatedContent += tokenDelta;
            onChunk(
              tokenDelta,
              accumulatedContent,
              buildStats(startTime, firstTokenTime, estimateTokens(), usage)
            );
          }
        }
      }

      if (!finished) finish();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => abortController.abort();
}

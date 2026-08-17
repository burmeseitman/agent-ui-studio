import { useReducer, useRef, useCallback, useEffect } from 'react';
import {
  ChatMessage,
  ChatParams,
  StreamStats,
  StreamToolCall,
  ToolCallExecution,
  WireMessage,
} from '../types';
import { CloudDetector } from '../utils/models';
import { executeToolApi, streamChatCompletion, ToolStreamEvent } from '../services/api';

type ChatAction =
  | { type: 'UPDATE_STREAMING_CONTENT'; id: string; content: string; stats?: StreamStats }
  | { type: 'FINISH_STREAMING'; id: string; content: string; stats?: StreamStats }
  | { type: 'SET_TOOL_CALLS'; id: string; toolCalls: ToolCallExecution[] }
  | { type: 'PATCH_TOOL_CALL'; messageId: string; toolCallId: string; patch: Partial<ToolCallExecution> }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_FALLBACK_TOAST'; toast: string | null }
  | { type: 'SET_STREAMING'; isStreaming: boolean }
  | { type: 'SET_STATS'; stats: StreamStats | null };

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentStats: StreamStats | null;
  errorMessage: string | null;
  fallbackToast: string | null;
}

function makeInitialState(messages: ChatMessage[]): ChatState {
  return {
    messages,
    isStreaming: false,
    currentStats: null,
    errorMessage: null,
    fallbackToast: null,
  };
}

function mapToolCalls(
  messages: ChatMessage[],
  messageId: string,
  fn: (calls: ToolCallExecution[]) => ToolCallExecution[]
): ChatMessage[] {
  return messages.map((msg) =>
    msg.id === messageId ? { ...msg, toolCalls: fn(msg.toolCalls ?? []) } : msg
  );
}

/**
 * Applies tool outcomes to a message list without going through the reducer.
 *
 * Dispatching only schedules a re-render, so the messages ref is still stale on
 * the line after a dispatch. Anything that has to hand the updated list straight
 * to the next request must compute it here instead of reading the ref back.
 */
export function applyToolResults(
  messages: ChatMessage[],
  messageId: string,
  patches: Map<string, Partial<ToolCallExecution>>
): ChatMessage[] {
  return mapToolCalls(messages, messageId, (calls) =>
    calls.map((call) => (patches.has(call.id) ? { ...call, ...patches.get(call.id)! } : call))
  );
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'UPDATE_STREAMING_CONTENT':
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === action.id ? { ...msg, content: action.content, stats: action.stats } : msg
        ),
      };
    case 'FINISH_STREAMING': {
      const newMessages = state.messages.map((msg) =>
        msg.id === action.id
          ? { ...msg, content: action.content, stats: action.stats, isStreaming: false }
          : msg
      );
      return { ...state, isStreaming: false, messages: newMessages };
    }
    case 'SET_TOOL_CALLS':
      return {
        ...state,
        messages: mapToolCalls(state.messages, action.id, () => action.toolCalls),
      };
    case 'PATCH_TOOL_CALL':
      return {
        ...state,
        messages: mapToolCalls(state.messages, action.messageId, (calls) =>
          calls.map((call) => (call.id === action.toolCallId ? { ...call, ...action.patch } : call))
        ),
      };
    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        currentStats: null,
        errorMessage: null,
        fallbackToast: null,
        isStreaming: false,
      };
    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };
    case 'SET_ERROR':
      return { ...state, errorMessage: action.error };
    case 'SET_FALLBACK_TOAST':
      return { ...state, fallbackToast: action.toast };
    case 'SET_STREAMING':
      return { ...state, isStreaming: action.isStreaming };
    case 'SET_STATS':
      return { ...state, currentStats: action.stats };
    default:
      return state;
  }
}

/**
 * Context budget, in characters.
 *
 * Tool output is the dominant cost here — read_file alone can return 20KB, and
 * without a ceiling a handful of file reads will overflow a local model's
 * context, or slow it to a crawl re-processing the same prompt every turn.
 * Roughly 4 characters per token, so ~8k tokens of history by default.
 */
export const DEFAULT_CONTEXT_BUDGET_CHARS = 32000;

/** Tool output from the most recent turn, which the model is actively using. */
const RECENT_TOOL_OUTPUT_CHARS = 6000;

/** Tool output from older turns, kept only as a trace of what happened. */
const OLDER_TOOL_OUTPUT_CHARS = 800;

const TRIM_NOTICE =
  '[Earlier conversation was trimmed to fit the context window. Ask the user to repeat anything you need.]';

function truncateForContext(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... [truncated, ${text.length - limit} more characters]`;
}

function toolResultContent(call: ToolCallExecution, limit: number): string {
  if (call.status === 'denied') {
    return 'The user denied permission to run this tool.';
  }
  if (call.error) {
    return `ERROR: ${call.error}`;
  }
  return truncateForContext(call.output ?? '', limit);
}

/**
 * Expands one UI message into the wire messages it represents.
 *
 * An assistant message with tool calls becomes an assistant message plus one
 * tool message per call. These must stay together: sending tool_calls without
 * their matching results, or the reverse, is rejected by the engines.
 */
function expandMessage(msg: ChatMessage, toolOutputLimit: number): WireMessage[] {
  if (msg.role === 'system') return [];

  const settledCalls = (msg.toolCalls ?? []).filter((call) => call.status !== 'pending');

  if (msg.role === 'assistant' && settledCalls.length > 0) {
    return [
      {
        role: 'assistant',
        content: msg.content,
        tool_calls: settledCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.toolName, arguments: call.arguments },
        })),
      },
      ...settledCalls.map((call) => ({
        role: 'tool',
        name: call.toolName,
        tool_call_id: call.id,
        content: toolResultContent(call, toolOutputLimit),
      })),
    ];
  }

  if (msg.content) {
    return [{ role: msg.role, content: msg.content }];
  }

  return [];
}

function costOf(group: WireMessage[]): number {
  return group.reduce(
    (sum, m) => sum + m.content.length + (m.tool_calls?.reduce((n, c) => n + c.function.arguments.length, 0) ?? 0),
    0
  );
}

/**
 * Converts UI messages into the wire format, dropping the oldest turns when the
 * conversation exceeds the context budget.
 *
 * The system prompt and the newest turn are always kept — a request without them
 * is useless — so the budget is a target rather than a hard cap for a single
 * enormous message.
 */
export function toWireMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  budgetChars: number = DEFAULT_CONTEXT_BUDGET_CHARS
): WireMessage[] {
  // Expand newest-first so recency decides how much tool output each turn keeps.
  const groups: WireMessage[][] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const isRecent = groups.length === 0;
    const group = expandMessage(messages[i], isRecent ? RECENT_TOOL_OUTPUT_CHARS : OLDER_TOOL_OUTPUT_CHARS);
    if (group.length > 0) groups.push(group);
  }

  const systemCost = systemPrompt.length;
  let used = systemCost;
  const kept: WireMessage[][] = [];

  for (const group of groups) {
    const cost = costOf(group);
    // The newest turn is always included, however large it is.
    if (kept.length > 0 && used + cost > budgetChars) break;
    kept.push(group);
    used += cost;
  }

  const trimmed = kept.length < groups.length;
  kept.reverse();

  const payload: WireMessage[] = [];
  if (systemPrompt) {
    payload.push({ role: 'system', content: systemPrompt });
  }
  if (trimmed) {
    payload.push({ role: 'system', content: TRIM_NOTICE });
  }
  for (const group of kept) {
    payload.push(...group);
  }

  return payload;
}

interface UseChatProps {
  paramsRef: React.RefObject<ChatParams>;
  fallbackLocalModel: { engine: string; model: string } | null;
  handleSelectModel: (engine: string, model: string) => void;
  /** Tool names the daemon reports as side-effect free. */
  readOnlyTools: Record<string, boolean>;
  /** Classifies a model as cloud-hosted using its engine's real URL. */
  isCloud: CloudDetector;
  /** Absolute path the file tools are sandboxed to. */
  workspacePath: string;
  /** A shallow listing of that directory, so the model can orient itself. */
  workspaceEntries: string[];
  /** The conversation being edited. Changing it swaps the visible history. */
  sessionId: string;
  /** Messages belonging to sessionId, as loaded from storage. */
  sessionMessages: ChatMessage[];
  /** Persists the conversation once it has settled. */
  onCommitMessages: (messages: ChatMessage[]) => void;
}

/**
 * Translates the user's approval policy into the wire fields the daemon expects.
 *
 * The daemon is the enforcement point: it only auto-runs what this list names,
 * so a policy of 'ask' cannot be overridden by anything the model does.
 */
export function resolveToolMode(
  params: ChatParams,
  readOnlyTools: Record<string, boolean>
): { toolMode: 'manual' | 'auto'; autoApproveTools?: string[] } {
  switch (params.toolApproval) {
    case 'all':
      return { toolMode: 'auto' };
    case 'read-only': {
      const safe = params.enabledTools.filter((name) => readOnlyTools[name]);
      // With nothing safe enabled, auto mode with an empty list would mean
      // "approve everything" on the wire, so fall back to asking.
      if (safe.length === 0) return { toolMode: 'manual' };
      return { toolMode: 'auto', autoApproveTools: safe };
    }
    case 'ask':
    default:
      return { toolMode: 'manual' };
  }
}

export function useChat({
  paramsRef,
  fallbackLocalModel,
  handleSelectModel,
  readOnlyTools,
  isCloud,
  workspacePath,
  workspaceEntries,
  sessionId,
  sessionMessages,
  onCommitMessages,
}: UseChatProps) {
  const [state, dispatch] = useReducer(chatReducer, sessionMessages, makeInitialState);
  const abortStreamRef = useRef<(() => void) | null>(null);

  const { messages, isStreaming, currentStats, errorMessage, fallbackToast } = state;

  // Kept in sync during render so callbacks can read the latest messages without
  // taking them as a dependency — otherwise every streamed token would produce
  // new callback identities and re-render the whole message list.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const selectionRef = useRef({ engine: '', model: '' });

  const readOnlyToolsRef = useRef(readOnlyTools);
  readOnlyToolsRef.current = readOnlyTools;

  const isCloudRef = useRef(isCloud);
  isCloudRef.current = isCloud;

  const onCommitRef = useRef(onCommitMessages);
  onCommitRef.current = onCommitMessages;

  // Tracks which session the in-memory messages belong to, so a switch cannot
  // write the outgoing conversation into the incoming one.
  const loadedSessionRef = useRef(sessionId);

  useEffect(() => {
    if (loadedSessionRef.current === sessionId) return;
    if (abortStreamRef.current) {
      abortStreamRef.current();
      abortStreamRef.current = null;
    }
    loadedSessionRef.current = sessionId;
    dispatch({ type: 'SET_MESSAGES', messages: sessionMessages });
    dispatch({ type: 'SET_STREAMING', isStreaming: false });
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_STATS', stats: null });
  }, [sessionId, sessionMessages]);

  // Persist once a turn settles. Skipping while streaming avoids a storage
  // write per token, which is both slow and pointless.
  useEffect(() => {
    if (isStreaming) return;
    if (loadedSessionRef.current !== sessionId) return;
    onCommitRef.current(messages);
  }, [messages, isStreaming, sessionId]);

  const handleClearChat = useCallback(() => {
    if (abortStreamRef.current) {
      abortStreamRef.current();
      abortStreamRef.current = null;
    }
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const handleStopGeneration = useCallback(() => {
    if (abortStreamRef.current) {
      abortStreamRef.current();
      abortStreamRef.current = null;
    }
    dispatch({ type: 'SET_STREAMING', isStreaming: false });
  }, []);

  const workspaceRef = useRef({ path: workspacePath, entries: workspaceEntries });
  workspaceRef.current = { path: workspacePath, entries: workspaceEntries };

  const buildSystemPrompt = useCallback(() => {
    const params = paramsRef.current;
    if (!params) return '';

    const prompt = params.systemPrompt.trim();
    const { path, entries } = workspaceRef.current;
    if (!path || (params.enabledTools?.length ?? 0) === 0) return prompt;

    // Without this the model has no idea which directory relative paths resolve
    // against, so it guesses names like "main.go" and every read fails.
    const listing = entries.length > 0 ? `\nIt currently contains: ${entries.join(', ')}.` : '';
    const context =
      `\n\nYour file tools operate inside ${path}. ` +
      `Relative paths resolve against that directory, and anything outside it is refused.` +
      listing;

    return prompt + context;
  }, [paramsRef]);

  /**
   * Streams one assistant turn. Tool calls returned by the model are attached
   * to the assistant message as pending; nothing is executed here.
   */
  const runTurn = useCallback(
    (baseMessages: ChatMessage[], engineToUse: string, modelToUse: string, isRetry = false) => {
      const params = paramsRef.current;
      selectionRef.current = { engine: engineToUse, model: modelToUse };
      dispatch({ type: 'SET_ERROR', error: null });

      const assistantMsgId = `assistant-${crypto.randomUUID()}`;
      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      const withAssistant = [...baseMessages, assistantMessage];
      dispatch({ type: 'SET_MESSAGES', messages: withAssistant });
      dispatch({ type: 'SET_STREAMING', isStreaming: true });

      const { toolMode, autoApproveTools } = params
        ? resolveToolMode(params, readOnlyToolsRef.current)
        : { toolMode: 'manual' as const, autoApproveTools: undefined };
      const autoMode = toolMode === 'auto';

      const abortFn = streamChatCompletion({
        engine: engineToUse,
        model: modelToUse,
        messages: toWireMessages(baseMessages, buildSystemPrompt()),
        temperature: params?.temperature ?? 0.7,
        maxTokens: params?.maxTokens ?? 2048,
        enabledTools: params?.enabledTools,
        toolMode,
        autoApproveTools,
        // Coding tasks are multi-step by nature; a single question is not.
        maxToolIterations:
          params?.maxToolIterations ?? (params?.profession === 'developer' ? 24 : 8),

        onContentReplaced: (content) => {
          dispatch({ type: 'UPDATE_STREAMING_CONTENT', id: assistantMsgId, content });
        },

        onNotice: (notice) => {
          dispatch({ type: 'SET_FALLBACK_TOAST', toast: notice.message });
          setTimeout(() => dispatch({ type: 'SET_FALLBACK_TOAST', toast: null }), 8000);
        },

        onChunk: (_token, fullText, stats) => {
          dispatch({ type: 'SET_STATS', stats });
          dispatch({ type: 'UPDATE_STREAMING_CONTENT', id: assistantMsgId, content: fullText, stats });
        },

        // Only fires for tools the daemon was cleared to run unattended.
        onToolEvent: (event: ToolStreamEvent) => {
          const execution: ToolCallExecution = {
            id: event.tool_call_id,
            toolName: event.name,
            arguments: event.arguments,
            output: event.output,
            error: event.error,
            status:
              event.object === 'agentui.tool_started'
                ? 'running'
                : event.error
                  ? 'error'
                  : 'success',
          };
          const existing = messagesRef.current.find((m) => m.id === assistantMsgId)?.toolCalls ?? [];
          const next = existing.some((c) => c.id === execution.id)
            ? existing.map((c) => (c.id === execution.id ? { ...c, ...execution } : c))
            : [...existing, execution];
          dispatch({ type: 'SET_TOOL_CALLS', id: assistantMsgId, toolCalls: next });
        },

        onError: (err) => {
          const modelIsCloud = isCloudRef.current(engineToUse, modelToUse);
          const hasLocalFallback = fallbackLocalModel && fallbackLocalModel.model !== modelToUse;

          if (modelIsCloud && hasLocalFallback && params?.autoFallbackToLocal && !isRetry) {
            dispatch({
              type: 'SET_FALLBACK_TOAST',
              toast: `⚡ Cloud quota reached. Auto-switched to local model (${fallbackLocalModel.model})`,
            });
            handleSelectModel(fallbackLocalModel.engine, fallbackLocalModel.model);
            setTimeout(() => dispatch({ type: 'SET_FALLBACK_TOAST', toast: null }), 5000);

            runTurn(baseMessages, fallbackLocalModel.engine, fallbackLocalModel.model, true);
            return;
          }

          dispatch({ type: 'SET_ERROR', error: err.message || 'Stream connection failed' });
          dispatch({ type: 'SET_STREAMING', isStreaming: false });
          dispatch({
            type: 'FINISH_STREAMING',
            id: assistantMsgId,
            content: err.message || 'Error occurred',
          });
        },

        onDone: ({ content, toolCalls, stats }) => {
          dispatch({ type: 'SET_STATS', stats });

          // In manual mode, surface the requested calls for approval instead of
          // running them. In auto mode the daemon already executed them and the
          // results arrived via onToolEvent.
          if (!autoMode && toolCalls.length > 0) {
            dispatch({
              type: 'SET_TOOL_CALLS',
              id: assistantMsgId,
              toolCalls: toolCalls.map((call: StreamToolCall) => ({
                id: call.id,
                toolName: call.name,
                arguments: call.arguments,
                status: 'pending' as const,
              })),
            });
          }

          dispatch({ type: 'FINISH_STREAMING', id: assistantMsgId, content, stats });
          abortStreamRef.current = null;
        },
      });

      abortStreamRef.current = abortFn;
    },
    [paramsRef, buildSystemPrompt, fallbackLocalModel, handleSelectModel]
  );

  const handleSendMessage = useCallback(
    (userText: string, selectedEngine: string, selectedModel: string) => {
      if (!selectedModel) return;

      const userMessage: ChatMessage = {
        id: `user-${crypto.randomUUID()}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
      };

      runTurn([...messagesRef.current, userMessage], selectedEngine, selectedModel);
    },
    [runTurn]
  );

  /**
   * Runs the tool calls the user approved, then hands the results back to the
   * model so it can finish its answer.
   */
  const handleApproveToolCalls = useCallback(
    async (messageId: string) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      const pending = (message?.toolCalls ?? []).filter((c) => c.status === 'pending');
      if (!message || pending.length === 0) return;

      // Collected locally as well as dispatched: the dispatches drive the live
      // UI, but the follow-up request needs the finished list synchronously.
      const outcomes = new Map<string, Partial<ToolCallExecution>>();

      for (const call of pending) {
        dispatch({
          type: 'PATCH_TOOL_CALL',
          messageId,
          toolCallId: call.id,
          patch: { status: 'running' },
        });

        const result = await executeToolApi(call.toolName, call.arguments, call.id);
        const patch: Partial<ToolCallExecution> = {
          status: result.error ? 'error' : 'success',
          output: result.output,
          error: result.error,
        };

        outcomes.set(call.id, patch);
        dispatch({ type: 'PATCH_TOOL_CALL', messageId, toolCallId: call.id, patch });
      }

      const { engine, model } = selectionRef.current;
      if (engine && model) {
        runTurn(applyToolResults(messagesRef.current, messageId, outcomes), engine, model);
      }
    },
    [runTurn]
  );

  /** Declines the pending calls and lets the model answer without them. */
  const handleDenyToolCalls = useCallback(
    (messageId: string) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      const pending = (message?.toolCalls ?? []).filter((c) => c.status === 'pending');
      if (!message || pending.length === 0) return;

      const outcomes = new Map<string, Partial<ToolCallExecution>>();
      for (const call of pending) {
        const patch: Partial<ToolCallExecution> = { status: 'denied' };
        outcomes.set(call.id, patch);
        dispatch({ type: 'PATCH_TOOL_CALL', messageId, toolCallId: call.id, patch });
      }

      const { engine, model } = selectionRef.current;
      if (engine && model) {
        runTurn(applyToolResults(messagesRef.current, messageId, outcomes), engine, model);
      }
    },
    [runTurn]
  );

  const handleFallbackAndRetry = useCallback(
    (engineName: string, modelName: string) => {
      handleSelectModel(engineName, modelName);
      dispatch({ type: 'SET_ERROR', error: null });

      // Drop the failed assistant turn before retrying.
      const trimmed = [...messagesRef.current];
      while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === 'assistant') {
        trimmed.pop();
      }
      if (trimmed.length > 0) {
        runTurn(trimmed, engineName, modelName, true);
      }
    },
    [handleSelectModel, runTurn]
  );

  return {
    messages,
    isStreaming,
    currentStats,
    errorMessage,
    fallbackToast,
    handleSendMessage,
    handleStopGeneration,
    handleClearChat,
    handleFallbackAndRetry,
    handleApproveToolCalls,
    handleDenyToolCalls,
  };
}

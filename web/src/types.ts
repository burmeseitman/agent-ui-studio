export { isCloudModel } from './utils/models';

export type Profession = 'developer' | 'writer' | 'researcher' | 'custom';
export type ProfessionType = Profession;

/**
 * manual: tool calls are surfaced for user approval before anything runs.
 * auto:   the daemon executes tool calls and continues the loop on its own.
 */
export type ToolMode = 'manual' | 'auto';

export interface ToolDefinition {
  type: string;
  category: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface HealthResponse {
  status: string;
  auth_required: boolean;
}

export interface ToolsResponse {
  tools: ToolDefinition[];
  read_only_tools: Record<string, boolean>;
  allowed_commands: string[];
}

/** A tool call as it arrives from the model, before any execution. */
export interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'denied';

export interface ToolCallExecution {
  id: string;
  toolName: string;
  arguments: string;
  output?: string;
  error?: string;
  status: ToolCallStatus;
}

export interface EngineInfo {
  name: string;
  url: string;
  active: boolean;
  models: string[];
}

export interface EnginesResponse {
  engines: EngineInfo[];
}

export interface StreamStats {
  totalTokens: number;
  promptTokens?: number;
  tokensPerSec: number;
  elapsedMs: number;
  timeToFirstTokenMs?: number;
  /** True when the engine reported no usage and the count is a rough estimate. */
  estimated?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  stats?: StreamStats;
  isStreaming?: boolean;
  toolCalls?: ToolCallExecution[];
}

/** A message in the shape the daemon and engines expect. */
export interface WireMessage {
  role: string;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

/**
 * How much autonomy tool calls get.
 *
 * `read-only` is the default: inspection tools run unattended, while anything
 * that changes the workspace waits for the user. A turn is judged as a whole —
 * if a model asks for a read and a write together, the whole batch is held.
 */
export type ToolApprovalPolicy = 'ask' | 'read-only' | 'all';

export const TOOL_APPROVAL_LABELS: Record<ToolApprovalPolicy, { label: string; hint: string }> = {
  ask: {
    label: 'Ask every time',
    hint: 'Every tool call waits for your approval before it runs.',
  },
  'read-only': {
    label: 'Auto-run reads',
    hint: 'Inspection tools run on their own; anything that writes to your workspace waits for approval.',
  },
  all: {
    label: 'Run everything',
    hint: 'All tool calls execute immediately, including file writes. Only for models and prompts you trust.',
  },
};

export interface ChatParams {
  profession: Profession;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  autoFallbackToLocal: boolean;
  enabledTools: string[];
  toolApproval: ToolApprovalPolicy;
}

export interface SelectedEngineModel {
  engine: string;
  model: string;
}

export const PROFESSION_PRESETS: Record<
  Profession,
  { label: string; name: string; icon: string; description: string; defaultPrompt: string; defaultTools: string[] }
> = {
  developer: {
    label: 'Developer',
    name: 'Developer',
    icon: '🧑‍💻',
    description: 'Expert software engineer with terminal and file system access.',
    defaultPrompt:
      'You are an expert pair programmer in AgentUI Studio. Write clean, idiomatic code and explain root causes succinctly. Call the provided tools when you need to inspect the workspace rather than guessing at its contents.',
    defaultTools: ['execute_command', 'read_file', 'write_file', 'list_dir', 'fetch_url'],
  },
  writer: {
    label: 'Content Writer',
    name: 'Content Writer',
    icon: '✍️',
    description: 'Creative writer & copy editor with web reader and readability tools.',
    defaultPrompt:
      'You are an elite copywriter, content strategist, and editor in AgentUI Studio. Craft engaging hooks, punchy storytelling, and clear structure. Call analyze_readability and fetch_url when they would ground your answer in real data.',
    defaultTools: ['fetch_url', 'analyze_readability', 'read_file'],
  },
  researcher: {
    label: 'Researcher',
    name: 'Researcher',
    icon: '🔬',
    description: 'Analytical investigator synthesizing web sources and documents.',
    defaultPrompt:
      'You are a rigorous research analyst in AgentUI Studio. Synthesize complex topics with structured bullet points, comparison tables, and cited findings. Call fetch_url and analyze_readability to gather primary evidence.',
    defaultTools: ['fetch_url', 'read_file', 'analyze_readability'],
  },
  custom: {
    label: 'Custom',
    name: 'Custom',
    icon: '⚙️',
    description: 'User-configured custom persona with bespoke tool selection.',
    defaultPrompt: 'You are a versatile AI assistant equipped with custom tools.',
    defaultTools: ['execute_command', 'fetch_url', 'analyze_readability'],
  },
};

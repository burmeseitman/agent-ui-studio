import React, { useState } from 'react';
import { ToolCallExecution } from '../types';
import {
  Terminal,
  FileText,
  FolderOpen,
  Globe,
  BarChart2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Code2,
  ShieldAlert,
  X,
  FilePen,
  Trash2,
  FolderInput,
  FolderTree,
  Search,
} from 'lucide-react';

import { WriteDiff } from './WriteDiff';

interface ToolCallCardProps {
  toolCall: ToolCallExecution;
  onApprove?: () => void;
  onDeny?: () => void;
}

/** Tools that change the user's machine, and so warrant a louder prompt. */
const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'move_file']);

/** Tools whose pending arguments are best reviewed as a diff. */
const DIFF_TOOLS = new Set(['write_file', 'edit_file']);

/** Renders raw JSON arguments readably, falling back to the original string. */
function formatArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  execute_command: <Terminal className="w-3.5 h-3.5 text-success-fg" />,
  read_file: <FileText className="w-3.5 h-3.5 text-info-fg" />,
  write_file: <Code2 className="w-3.5 h-3.5 text-warning-fg" />,
  list_dir: <FolderOpen className="w-3.5 h-3.5 text-accent-fg" />,
  fetch_url: <Globe className="w-3.5 h-3.5 text-accent-fg" />,
  analyze_readability: <BarChart2 className="w-3.5 h-3.5 text-danger-fg" />,
  edit_file: <FilePen className="w-3.5 h-3.5 text-warning-fg" />,
  delete_file: <Trash2 className="w-3.5 h-3.5 text-danger-fg" />,
  move_file: <FolderInput className="w-3.5 h-3.5 text-info-fg" />,
  list_tree: <FolderTree className="w-3.5 h-3.5 text-accent-fg" />,
  search_files: <Search className="w-3.5 h-3.5 text-info-fg" />,
};

export const ToolCallCard: React.FC<ToolCallCardProps> = React.memo(({ toolCall, onApprove, onDeny }) => {
  const isPending = toolCall.status === 'pending';
  // A pending call is a decision the user has to make, so show the details up front.
  const [isExpanded, setIsExpanded] = useState(isPending);
  const [copied, setCopied] = useState(false);

  const handleCopyOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(toolCall.output || toolCall.error || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  };

  const isSuccess = toolCall.status === 'success';
  const isRunning = toolCall.status === 'running';
  const isError = toolCall.status === 'error';
  const isDenied = toolCall.status === 'denied';
  const isMutating = MUTATING_TOOLS.has(toolCall.toolName);
  const isDiffable = DIFF_TOOLS.has(toolCall.toolName);

  const outputLines = (toolCall.output || toolCall.error || '').split('\n').filter(Boolean).length;

  return (
    <div
      className={`rounded-lg border overflow-hidden font-mono text-xs shadow-sm ${
        isPending
          ? 'border-warning/40 bg-warning-muted/40'
          : 'border-white/[0.08] bg-surface-canvas/70'
      }`}
    >
      {/* Header Bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        className="flex items-center justify-between px-3 py-2 bg-surface-base/90 hover:bg-surface-raised cursor-pointer transition-colors select-none"
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1 rounded bg-white/[0.04] border border-white/[0.06]">
            {TOOL_ICONS[toolCall.toolName] || <Terminal className="w-3.5 h-3.5 text-ink-400" />}
          </div>

          <div className="flex items-center space-x-2 truncate">
            <span className="font-semibold text-ink-100 truncate">
              {toolCall.toolName}
            </span>
            <span className="text-[10px] text-ink-400 truncate max-w-[200px] opacity-75">
              {toolCall.arguments}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0 ml-2">
          {/* Status Badge */}
          {isPending && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-warning/15 text-warning-fg border border-warning/30">
              <ShieldAlert className="w-3 h-3" />
              <span>approval required</span>
            </span>
          )}
          {isDenied && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-slate-500/10 text-ink-400 border border-slate-500/20">
              <X className="w-3 h-3" />
              <span>denied</span>
            </span>
          )}
          {isRunning && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-warning/10 text-warning-fg border border-warning/25">
              <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
              <span>executing</span>
            </span>
          )}
          {isSuccess && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-success/10 text-success-fg border border-success/25">
              <CheckCircle2 className="w-3 h-3" />
              <span>{outputLines} lines</span>
            </span>
          )}
          {isError && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] bg-danger/10 text-danger-fg border border-danger/25">
              <AlertCircle className="w-3 h-3" />
              <span>error</span>
            </span>
          )}

          {/* Expand toggle */}
          <div className="text-ink-400">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </div>
        </div>
      </div>

      {/* Expandable Body */}
      {isExpanded && (
        <div className="p-3 border-t border-white/[0.06] bg-surface-canvas space-y-2.5">
          {/* Arguments */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">
              Parameters
            </div>
            <pre className="p-2 rounded bg-surface-base border border-white/[0.04] text-ink-200 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
              {formatArguments(toolCall.arguments)}
            </pre>
          </div>

          {/* For writes, show what would actually change rather than raw JSON. */}
          {isPending && isDiffable && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">
                Proposed changes
              </div>
              <WriteDiff toolName={toolCall.toolName} argumentsJson={toolCall.arguments} />
            </div>
          )}

          {/* Approval gate: nothing has run yet at this point. */}
          {isPending && (
            <div className="rounded border border-warning/30 bg-warning-muted/50 p-2.5 space-y-2">
              <div className="flex items-start space-x-2 text-[11px] text-warning-fg font-sans leading-relaxed">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  {isMutating
                    ? 'The model wants to modify a file in your workspace. Review the changes above before allowing it.'
                    : 'The model wants to run this tool against your local workspace. Review the parameters above before allowing it.'}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove?.();
                  }}
                  disabled={!onApprove}
                  className="px-2.5 py-1 rounded bg-success hover:bg-success/80 disabled:opacity-40 text-ink-50 text-[11px] font-sans font-medium transition-colors"
                >
                  Run tool
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeny?.();
                  }}
                  disabled={!onDeny}
                  className="px-2.5 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 text-ink-200 text-[11px] font-sans font-medium transition-colors"
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          {/* Output */}
          {!isPending && (
          <div>
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink-400 mb-1">
              <span>Tool Output</span>
              <button
                type="button"
                onClick={handleCopyOutput}
                className="flex items-center space-x-1 text-ink-400 hover:text-ink-100 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-2.5 h-2.5 text-success-fg" />
                    <span className="text-success-fg">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-2.5 h-2.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <pre
              className={`p-2.5 rounded text-[11px] max-h-60 overflow-y-auto leading-relaxed border ${
                isError
                  ? 'bg-danger-muted/50 border-danger/25 text-danger-fg'
                  : 'bg-surface-base border-white/[0.04] text-ink-100'
              }`}
            >
              {toolCall.output ||
                toolCall.error ||
                (isDenied ? 'Denied by user — not executed.' : 'No output returned.')}
            </pre>
          </div>
          )}
        </div>
      )}
    </div>
  );
});

ToolCallCard.displayName = 'ToolCallCard';

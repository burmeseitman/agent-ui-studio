import React from 'react';
import { ChatParams, ToolApprovalPolicy, TOOL_APPROVAL_LABELS } from '../types';
import { Check, ShieldCheck } from 'lucide-react';

export interface AvailableTool {
  id: string;
  name: string;
  desc: string;
}

interface ToolsPanelProps {
  params: ChatParams;
  onChangeParams: (partial: Partial<ChatParams>) => void;
  availableTools: AvailableTool[];
  onToggleTool: (id: string) => void;
  /** Enabled tools the daemon will run unattended under the current policy. */
  autoRunTools: string[];
}

/** Tool selection and the approval policy that governs how those tools run. */
export const ToolsPanel: React.FC<ToolsPanelProps> = ({
  params,
  onChangeParams,
  availableTools,
  onToggleTool,
  autoRunTools,
}) => (
  <div className="space-y-2">
    {availableTools.map((tool) => {
      const isEnabled = params.enabledTools.includes(tool.id);
      return (
        <button
          key={tool.id}
          type="button"
          onClick={() => onToggleTool(tool.id)}
          aria-pressed={isEnabled}
          className={`w-full flex items-start space-x-2.5 p-2.5 rounded-lg text-left transition-colors border cursor-pointer ${
            isEnabled
              ? 'bg-accent/[0.12] border-accent/40 text-ink-50 shadow-sm'
              : 'bg-surface-raised/60 border-white/[0.06] text-ink-200 hover:bg-surface-overlay hover:text-ink-50'
          }`}
        >
          <div
            className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${
              isEnabled
                ? 'bg-accent border-accent text-ink-50'
                : 'border-ink-600 bg-surface-overlay'
            }`}
          >
            {isEnabled && <Check className="w-2.5 h-2.5 stroke-[3]" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono font-bold text-ink-50 truncate">{tool.name}</div>
            <div className="text-[11px] text-ink-400 truncate mt-0.5">{tool.desc}</div>
          </div>
        </button>
      );
    })}

    {/* Tool approval policy */}
    <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
      <div className="flex items-center space-x-1.5 text-xs font-medium text-ink-100">
        <ShieldCheck
          className={`w-3.5 h-3.5 ${
            params.toolApproval === 'all' ? 'text-warning-fg' : 'text-success-fg'
          }`}
        />
        <span>Tool approval</span>
      </div>

      <div
        role="radiogroup"
        aria-label="Tool approval policy"
        className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-surface-canvas border border-white/[0.06]"
      >
        {(Object.keys(TOOL_APPROVAL_LABELS) as ToolApprovalPolicy[]).map((policy) => (
          <button
            key={policy}
            type="button"
            role="radio"
            aria-checked={params.toolApproval === policy}
            onClick={() => onChangeParams({ toolApproval: policy })}
            className={`px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${
              params.toolApproval === policy
                ? policy === 'all'
                  ? 'bg-warning/80 text-ink-50'
                  : 'bg-accent text-ink-50'
                : 'text-ink-400 hover:text-ink-100 hover:bg-white/[0.04]'
            }`}
          >
            {TOOL_APPROVAL_LABELS[policy].label}
          </button>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-ink-400">
        {TOOL_APPROVAL_LABELS[params.toolApproval].hint}
      </p>

      {params.toolApproval === 'read-only' && autoRunTools.length > 0 && (
        <p className="text-[10px] leading-relaxed text-ink-500 font-mono">
          Runs unattended: {autoRunTools.join(', ')}
        </p>
      )}
    </div>
  </div>
);

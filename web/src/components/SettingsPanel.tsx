import React from 'react';
import { ChatParams } from '../types';
import { Zap, TerminalSquare } from 'lucide-react';
import { TokenPrompt } from './TokenPrompt';

export interface AuthControls {
  authRequired: boolean;
  hasToken: boolean;
  tokenFromEnv: boolean;
  saveToken: (token: string) => void;
  removeToken: () => void;
}

export interface DaemonCapabilities {
  projectExecution: boolean;
  isSaving: boolean;
  setProjectExecution: (enabled: boolean) => void;
}

interface SettingsPanelProps {
  params: ChatParams;
  onChangeParams: (partial: Partial<ChatParams>) => void;
  auth: AuthControls;
  daemon: DaemonCapabilities;
}

/** Daemon authentication and generation parameters. */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  params,
  onChangeParams,
  auth,
  daemon,
}) => (
  <div className="space-y-4">
    {/* Project execution: the deliberate escape hatch from read-only commands. */}
    <div className="pb-3 border-b border-white/[0.06]">
      <label className="flex items-center justify-between text-xs text-ink-100 cursor-pointer py-1">
        <span className="flex items-center gap-1.5 font-medium">
          <TerminalSquare
            className={`w-3.5 h-3.5 ${daemon.projectExecution ? 'text-warning-fg' : 'text-ink-400'}`}
          />
          <span>Let the agent build &amp; run</span>
        </span>
        <input
          type="checkbox"
          className="sr-only peer"
          checked={daemon.projectExecution}
          disabled={daemon.isSaving}
          onChange={(e) => daemon.setProjectExecution(e.target.checked)}
        />
        <div className="w-7 h-4 bg-ink-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-warning/80 relative"></div>
      </label>
      <p className="text-[10px] leading-relaxed text-ink-400 mt-1">
        {daemon.projectExecution
          ? 'npm install, node, python, go test and similar can now run. These execute code from your project and its dependencies — keep this off unless you are actively building something.'
          : 'Commands are limited to read-only inspection. Turn this on to let the agent install dependencies, run builds and run tests.'}
      </p>
    </div>

    {/* Daemon authentication */}
    {(auth.authRequired || auth.hasToken) && (
      <div className="pb-3 border-b border-white/[0.06]">
        <TokenPrompt
          blocking={false}
          hasToken={auth.hasToken}
          tokenFromEnv={auth.tokenFromEnv}
          onSave={auth.saveToken}
          onClear={auth.removeToken}
        />
      </div>
    )}

    {/* Temperature Slider */}
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-ink-200 font-mono text-[11px] font-medium">Temperature</span>
        <span className="text-ink-50 font-mono font-bold bg-surface-overlay px-1.5 py-0.5 rounded border border-white/[0.08]">
          {params.temperature}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="1.5"
        step="0.05"
        aria-label="Temperature"
        value={params.temperature}
        onChange={(e) => onChangeParams({ temperature: parseFloat(e.target.value) })}
        className="w-full h-1.5 bg-ink-750 rounded-lg appearance-none cursor-pointer accent-accent"
      />
    </div>

    {/* Max Tokens Slider */}
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-ink-200 font-mono text-[11px] font-medium">Max Tokens</span>
        <span className="text-ink-50 font-mono font-bold bg-surface-overlay px-1.5 py-0.5 rounded border border-white/[0.08]">
          {params.maxTokens}
        </span>
      </div>
      <input
        type="range"
        min="256"
        max="8192"
        step="256"
        aria-label="Max tokens"
        value={params.maxTokens}
        onChange={(e) => onChangeParams({ maxTokens: parseInt(e.target.value) })}
        className="w-full h-1.5 bg-ink-750 rounded-lg appearance-none cursor-pointer accent-accent"
      />
    </div>

    {/* Smart Fallback Switch */}
    <div className="pt-2 border-t border-white/[0.06]">
      <label className="flex items-center justify-between text-xs text-ink-100 cursor-pointer py-1">
        <span className="flex items-center space-x-1.5 font-medium">
          <Zap className="w-3.5 h-3.5 text-warning-fg" />
          <span>Smart Cloud-to-Local Fallback</span>
        </span>
        <input
          type="checkbox"
          className="sr-only peer"
          checked={params.autoFallbackToLocal}
          onChange={(e) => onChangeParams({ autoFallbackToLocal: e.target.checked })}
        />
        <div className="w-7 h-4 bg-ink-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent relative"></div>
      </label>
      <p className="text-[10px] leading-relaxed text-ink-400 mt-1">
        Retries on a local model when a cloud model fails or hits its quota.
      </p>
    </div>
  </div>
);

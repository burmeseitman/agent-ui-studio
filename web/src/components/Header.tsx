import React from 'react';
import { EngineInfo } from '../types';
import { CloudDetector } from '../utils/models';
import { Terminal, RotateCw, Cpu, Cloud, Command, Eye, EyeOff } from 'lucide-react';

interface HeaderProps {
  engines: EngineInfo[];
  isLoadingEngines: boolean;
  onRefreshEngines: () => void;
  selectedEngine: string;
  selectedModel: string;
  isCloud: CloudDetector;
  onOpenCommandPalette?: () => void;
  isPreviewOpen?: boolean;
  onTogglePreview?: () => void;
}

/**
 * Doubles as the window's title bar in the desktop build.
 *
 * The whole strip is a drag region, with interactive controls opted back out —
 * otherwise buttons inside it would move the window instead of being clickable.
 * The left inset clears the macOS traffic lights.
 */
export const Header: React.FC<HeaderProps> = React.memo(
  ({
    engines,
    isLoadingEngines,
    onRefreshEngines,
    selectedEngine,
    selectedModel,
    isCloud,
    onOpenCommandPalette,
    isPreviewOpen,
    onTogglePreview,
  }) => {
    const modelIsCloud = isCloud(selectedEngine, selectedModel);

    return (
      <header
        data-tauri-drag-region
        className="drag-region h-[52px] shrink-0 z-30 select-none flex items-center justify-between gap-4 border-b border-white/[0.06] bg-surface-base/80 backdrop-blur-xl pr-3"
        style={{ paddingLeft: 'max(0.875rem, var(--titlebar-inset))' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-active flex items-center justify-center text-ink-50 shadow-accent-glow shrink-0">
            <Terminal className="w-3.5 h-3.5 stroke-[2.5]" />
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-sm font-semibold tracking-tight text-ink-50">AgentUI</span>
            <span className="text-sm font-normal text-ink-400 tracking-tight">Studio</span>
          </div>
        </div>

        {/* Active model — also the command palette entry point */}
        <div className="no-drag flex items-center justify-center flex-1 min-w-0">
          {selectedModel ? (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title="Search models and actions (⌘K)"
              className="group flex items-center gap-2 max-w-full px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-150 ease-swift"
            >
              {modelIsCloud ? (
                <Cloud className="w-3.5 h-3.5 text-info-fg shrink-0" />
              ) : (
                <Cpu className="w-3.5 h-3.5 text-accent-fg shrink-0" />
              )}
              <span className="font-mono text-xs font-medium text-ink-100 group-hover:text-ink-50 truncate">
                {selectedModel}
              </span>
              <span className="text-2xs text-ink-500 font-mono uppercase tracking-wide shrink-0">
                {selectedEngine}
              </span>
              <kbd className="hidden sm:flex items-center gap-0.5 ml-1 pl-2 border-l border-white/[0.08] text-2xs text-ink-500 font-sans shrink-0">
                <Command className="w-2.5 h-2.5" />K
              </kbd>
            </button>
          ) : (
            <span className="text-xs text-ink-500">No model selected</span>
          )}
        </div>

        {/* Engine status */}
        <div className="no-drag flex items-center gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-1.5">
            {engines.map((eng) => (
              <div
                key={eng.name}
                title={`${eng.name}: ${eng.active ? `${eng.models.length} models ready` : 'offline'}`}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-2xs font-medium border transition-colors ${
                  eng.active
                    ? 'bg-success/[0.07] border-success/20 text-success-fg'
                    : 'bg-white/[0.02] border-white/[0.05] text-ink-500'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    eng.active
                      ? 'bg-success shadow-[0_0_6px_rgba(16,185,129,0.7)]'
                      : 'bg-ink-600'
                  }`}
                />
                <span className="capitalize">{eng.name}</span>
                {eng.active && <span className="tabular opacity-60">{eng.models.length}</span>}
              </div>
            ))}
          </div>

          {/* Live Preview Toggle Button */}
          {onTogglePreview && (
            <button
              type="button"
              onClick={onTogglePreview}
              title={isPreviewOpen ? 'Close Live Preview' : 'Open Live Preview'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                isPreviewOpen
                  ? 'bg-accent/15 border-accent/30 text-accent-fg'
                  : 'border-white/[0.06] text-ink-400 hover:text-ink-100 hover:bg-white/[0.04]'
              }`}
            >
              {isPreviewOpen ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Preview</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRefreshEngines}
            disabled={isLoadingEngines}
            aria-label="Rescan local engines"
            title="Rescan local engines"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-100 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            <RotateCw
              className={`w-3.5 h-3.5 ${isLoadingEngines ? 'animate-spin text-accent-fg' : ''}`}
            />
          </button>
        </div>
      </header>
    );
  }
);

Header.displayName = 'Header';

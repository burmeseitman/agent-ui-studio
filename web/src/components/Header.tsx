import React from 'react';
import { EngineInfo } from '../types';
import { CloudDetector } from '../utils/models';
import { RotateCw, Cpu, Cloud, Command, Eye, EyeOff } from 'lucide-react';

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
 * Tauri decides what drags from the attribute on the element under the pointer,
 * not from an ancestor, so every non-interactive wrapper in the strip carries
 * data-tauri-drag-region; without it the layout containers swallow the press
 * and the window cannot be moved. Buttons are left without it so they stay
 * clickable. The -webkit-app-region rules are kept for parity with browsers
 * that honour them, but WKWebView ignores them, which is why the attribute is
 * what actually does the work here. The left inset clears the macOS traffic
 * lights.
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
        {/* Active model — also the command palette entry point */}
        <div
          data-tauri-drag-region
          className="flex items-center justify-center flex-1 min-w-0"
        >
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
        <div data-tauri-drag-region className="flex items-center gap-2 shrink-0">
          <div data-tauri-drag-region className="hidden md:flex items-center gap-1.5">
            {engines.map((eng) => (
              <div
                key={eng.name}
                data-tauri-drag-region
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

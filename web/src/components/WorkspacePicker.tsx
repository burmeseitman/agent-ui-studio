import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, FolderTree, Check, X, AlertTriangle, Pencil } from 'lucide-react';

export interface WorkspaceControls {
  workspacePath: string;
  entries: string[];
  isHomeDir: boolean;
  error: string | null;
  isChanging: boolean;
  canPickFolder: boolean;
  pickWorkspace: () => void;
  changeWorkspace: (path: string) => void;
}

interface WorkspacePickerProps {
  workspace: WorkspaceControls;
  /**
   * hero  — the pre-prompt choice on the empty chat screen
   * bar   — a slim always-visible strip above the composer
   * panel — the sidebar entry
   */
  variant: 'hero' | 'bar' | 'panel';
}

/** Shows the last two segments, which is what identifies a project. */
function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

function folderName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * Lets the user choose which folder the agent may read and write.
 *
 * Surfaced next to the chat rather than only in the sidebar, because the useful
 * moment to make this choice is before the first prompt — a model pointed at the
 * wrong directory fails every relative path it tries.
 */
export const WorkspacePicker: React.FC<WorkspacePickerProps> = ({ workspace, variant }) => {
  const {
    workspacePath,
    entries,
    isHomeDir,
    error,
    isChanging,
    canPickFolder,
    pickWorkspace,
    changeWorkspace,
  } = workspace;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select explicitly: React's autoFocus runs before the onFocus
  // handler is attached, so selecting there silently did nothing and typing
  // appended to the existing path instead of replacing it.
  useEffect(() => {
    if (!isEditing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditing]);

  const startEditing = () => {
    setDraft(workspacePath);
    setIsEditing(true);
  };

  const choose = () => (canPickFolder ? pickWorkspace() : startEditing());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.trim()) changeWorkspace(draft.trim());
    setIsEditing(false);
  };

  const pathInput = (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setIsEditing(false)}
        spellCheck={false}
        aria-label="Workspace folder path"
        placeholder="/absolute/path/to/your/project"
        className="flex-1 min-w-0 bg-surface-canvas border border-white/[0.1] rounded-md px-2 py-1.5 text-xs font-mono text-ink-50 placeholder-ink-600 focus:outline-none focus:border-accent/60"
      />
      <button
        type="submit"
        aria-label="Set workspace"
        className="p-1.5 rounded-md bg-accent hover:bg-accent-hover text-white transition-colors"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setIsEditing(false)}
        aria-label="Cancel"
        className="p-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-ink-200 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </form>
  );

  const errorLine = error && (
    <p className="flex items-start gap-1.5 text-2xs text-danger-fg leading-relaxed">
      <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
      <span>{error}</span>
    </p>
  );

  if (variant === 'hero') {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-surface-raised/60 p-3.5 text-left space-y-2.5">
        {isEditing ? (
          <>
            <div className="text-2xs font-medium uppercase tracking-widest text-ink-500">
              Project folder
            </div>
            {pathInput}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <FolderOpen className="w-4 h-4 text-accent-fg" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink-100 truncate">
                    {workspacePath ? folderName(workspacePath) : 'No folder selected'}
                  </span>
                  <span
                    className="block text-2xs text-ink-500 font-mono truncate"
                    title={workspacePath}
                  >
                    {workspacePath ? shortPath(workspacePath) : 'Choose where the agent may work'}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={choose}
                  disabled={isChanging}
                  className="px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                  {isChanging ? 'Opening…' : canPickFolder ? 'Choose folder' : 'Set folder'}
                </button>
                {canPickFolder && (
                  <button
                    type="button"
                    onClick={startEditing}
                    aria-label="Type a path instead"
                    title="Type a path instead"
                    className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-ink-400 hover:text-ink-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {isHomeDir ? (
              // The default sandbox is the home directory, which is almost never
              // the project the user has in mind.
              <p className="flex items-start gap-1.5 text-2xs text-warning-fg leading-relaxed">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                <span>
                  This is your home folder. Choose the project you want to work on so the agent can
                  find files by their normal paths.
                </span>
              </p>
            ) : (
              entries.length > 0 && (
                <p className="text-2xs text-ink-600 font-mono truncate" title={entries.join(', ')}>
                  {entries.slice(0, 6).join('  ')}
                  {entries.length > 6 ? ' …' : ''}
                </p>
              )
            )}
          </>
        )}
        {errorLine}
      </div>
    );
  }

  if (variant === 'bar') {
    if (isEditing) {
      return <div className="px-1 pb-2">{pathInput}</div>;
    }
    return (
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-2xs">
        <button
          type="button"
          onClick={choose}
          disabled={isChanging}
          title={workspacePath || 'Choose a folder'}
          className="group flex items-center gap-1.5 min-w-0 text-ink-500 hover:text-ink-200 transition-colors disabled:opacity-40"
        >
          <FolderOpen
            className={`w-3 h-3 shrink-0 ${isHomeDir ? 'text-warning-fg' : 'text-ink-600 group-hover:text-accent-fg'}`}
          />
          <span className="font-mono truncate max-w-[280px]">
            {workspacePath ? shortPath(workspacePath) : 'No folder selected'}
          </span>
          <span className="text-ink-700 group-hover:text-ink-500 shrink-0">change</span>
        </button>
        {isHomeDir && <span className="text-warning-fg shrink-0">· home folder</span>}
      </div>
    );
  }

  // panel
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-widest text-ink-600">
          Agent workspace
        </span>
        {!isEditing && (
          <button
            type="button"
            onClick={choose}
            disabled={isChanging}
            className="text-2xs text-accent-fg hover:text-ink-50 transition-colors disabled:opacity-40"
          >
            {isChanging ? 'Changing…' : 'Change'}
          </button>
        )}
      </div>

      {isEditing ? (
        pathInput
      ) : (
        <button
          type="button"
          onClick={choose}
          title={workspacePath}
          className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] transition-colors group"
        >
          <FolderOpen
            className={`w-3.5 h-3.5 shrink-0 ${isHomeDir ? 'text-warning-fg' : 'text-accent-fg'}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-2xs font-mono text-ink-100 truncate">
              {workspacePath ? shortPath(workspacePath) : 'Not set'}
            </span>
            <span className="block text-2xs text-ink-600">
              {isHomeDir
                ? 'home folder — pick a project'
                : entries.length > 0
                  ? `${entries.length}+ items visible`
                  : 'empty or unreadable'}
            </span>
          </span>
          <FolderTree className="w-3.5 h-3.5 text-ink-600 group-hover:text-accent-fg shrink-0 transition-colors" />
        </button>
      )}
      {errorLine}
    </div>
  );
};

import React, { useState } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';

interface TokenPromptProps {
  /** Rendered as a blocking panel when the daemon requires a token we don't have. */
  blocking: boolean;
  hasToken: boolean;
  tokenFromEnv: boolean;
  onSave: (token: string) => void;
  onClear: () => void;
  onDismiss?: () => void;
}

/**
 * Collects the daemon's API token.
 *
 * Without this the token could only be set by hand in devtools, which made
 * `-api-token` effectively unusable from the browser.
 */
export const TokenPrompt: React.FC<TokenPromptProps> = ({
  blocking,
  hasToken,
  tokenFromEnv,
  onSave,
  onClear,
  onDismiss,
}) => {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSave(value);
    setValue('');
  };

  const form = (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="agentui-token" className="sr-only">
        API token
      </label>
      <input
        id="agentui-token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={hasToken ? 'Replace stored token…' : 'Paste the daemon API token'}
        className="w-full bg-surface-canvas border border-white/[0.1] rounded-md px-2.5 py-1.5 text-xs font-mono text-ink-50 placeholder-ink-500 focus:outline-none focus:border-accent/60"
      />
      <div className="flex items-center space-x-2">
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-2.5 py-1 rounded bg-accent hover:bg-accent-hover disabled:opacity-40 text-ink-50 text-[11px] font-medium transition-colors"
        >
          Save token
        </button>
        {hasToken && !tokenFromEnv && (
          <button
            type="button"
            onClick={onClear}
            className="px-2.5 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-ink-200 text-[11px] font-medium transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[10px] text-ink-400 leading-relaxed">
        Stored in this browser only, and sent as a bearer token to the daemon.
      </p>
    </form>
  );

  if (!blocking) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center space-x-1.5 text-xs font-medium text-ink-100">
            <KeyRound className="w-3.5 h-3.5 text-accent-fg" />
            <span>API token</span>
          </span>
          {hasToken && (
            <span className="flex items-center space-x-1 text-[10px] text-success-fg">
              <ShieldCheck className="w-3 h-3" />
              <span>{tokenFromEnv ? 'from env' : 'saved'}</span>
            </span>
          )}
        </div>
        {form}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-canvas/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-surface-base p-4 shadow-elevated space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-md bg-accent/15 border border-accent/30">
              <KeyRound className="w-4 h-4 text-accent-fg" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink-50">Authentication required</h2>
              <p className="text-[11px] text-ink-400">
                This daemon was started with an API token.
              </p>
            </div>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="text-ink-400 hover:text-ink-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {form}
      </div>
    </div>
  );
};

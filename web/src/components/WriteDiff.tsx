import React, { useEffect, useState } from 'react';
import { FilePlus2, FileDiff, Loader2 } from 'lucide-react';
import { executeToolApi } from '../services/api';
import { collapseContext, diffLines, diffStats } from '../utils/diff';

interface WriteDiffProps {
  /** JSON arguments of a pending write_file call. */
  argumentsJson: string;
}

interface ParsedWrite {
  path: string;
  content: string;
}

function parseWriteArgs(argumentsJson: string): ParsedWrite | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (typeof parsed?.path !== 'string') return null;
    return { path: parsed.path, content: typeof parsed.content === 'string' ? parsed.content : '' };
  } catch {
    return null;
  }
}

/** Diffs beyond this are summarised rather than rendered line by line. */
const MAX_DIFF_CHARS = 200_000;

/**
 * Shows what a pending write_file call would actually change.
 *
 * Approving a write meant reading a JSON blob of the whole new file, which made
 * approval ceremonial rather than informative. Reading the current contents is
 * itself a read-only tool call, so it is safe to do before the user decides.
 */
export const WriteDiff: React.FC<WriteDiffProps> = ({ argumentsJson }) => {
  const parsed = parseWriteArgs(argumentsJson);
  const [current, setCurrent] = useState<string | null>(null);
  const [isNewFile, setIsNewFile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!parsed) {
      setLoading(false);
      return;
    }

    (async () => {
      const result = await executeToolApi('read_file', JSON.stringify({ path: parsed.path }));
      if (cancelled) return;
      if (result.error) {
        // Most often the file simply does not exist yet.
        setIsNewFile(true);
        setCurrent('');
      } else {
        setCurrent(result.output ?? '');
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argumentsJson]);

  if (!parsed) {
    return (
      <p className="text-[11px] text-danger-fg font-sans">
        Could not read the write parameters — review the raw arguments above.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center space-x-1.5 text-[11px] text-ink-400 font-sans">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Reading current file…</span>
      </div>
    );
  }

  const oldText = current ?? '';
  const tooLarge = oldText.length + parsed.content.length > MAX_DIFF_CHARS;

  if (tooLarge) {
    return (
      <p className="text-[11px] text-ink-200 font-sans">
        {parsed.path} — {parsed.content.length.toLocaleString()} characters. Too large to preview;
        review the raw arguments above before approving.
      </p>
    );
  }

  const lines = diffLines(oldText, parsed.content);
  const { added, removed } = diffStats(lines);
  const rendered = collapseContext(lines);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="flex items-center space-x-1.5 text-ink-200 truncate">
          {isNewFile ? (
            <FilePlus2 className="w-3 h-3 text-success-fg shrink-0" />
          ) : (
            <FileDiff className="w-3 h-3 text-warning-fg shrink-0" />
          )}
          <span className="truncate">{parsed.path}</span>
          {isNewFile && <span className="text-success-fg shrink-0">(new file)</span>}
        </span>
        <span className="space-x-1.5 shrink-0">
          <span className="text-success-fg">+{added}</span>
          <span className="text-danger-fg">-{removed}</span>
        </span>
      </div>

      {added === 0 && removed === 0 ? (
        <p className="text-[11px] text-ink-400 font-sans">
          This write would not change the file's contents.
        </p>
      ) : (
        <div className="max-h-64 overflow-auto rounded border border-white/[0.06] bg-surface-base">
          <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
            <tbody>
              {rendered.map((line, index) => {
                if (line.op === 'skip') {
                  return (
                    <tr key={`skip-${index}`} className="text-ink-500 bg-surface-canvas/60">
                      <td colSpan={3} className="px-2 py-0.5 text-[10px] italic">
                        ⋯ {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}
                      </td>
                    </tr>
                  );
                }

                const tone =
                  line.op === 'add'
                    ? 'bg-success/10 text-success-fg'
                    : line.op === 'remove'
                      ? 'bg-danger/10 text-danger-fg'
                      : 'text-ink-200';

                return (
                  <tr key={`${line.op}-${index}`} className={tone}>
                    <td className="select-none px-1.5 py-0.5 text-right text-ink-500 w-9 align-top">
                      {line.oldLine ?? ''}
                    </td>
                    <td className="select-none px-1.5 py-0.5 text-right text-ink-500 w-9 align-top">
                      {line.newLine ?? ''}
                    </td>
                    <td className="px-2 py-0.5 whitespace-pre-wrap break-all">
                      <span className="select-none text-ink-500">
                        {line.op === 'add' ? '+' : line.op === 'remove' ? '-' : ' '}{' '}
                      </span>
                      {line.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

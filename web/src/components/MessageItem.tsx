import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hljs, resolveLanguage } from '../utils/highlight';
import { ChatMessage } from '../types';
import { ToolCallCard } from './ToolCallCard';
import {
  Copy,
  Check,
  Cpu,
  User,
  Terminal,
} from 'lucide-react';

interface MessageItemProps {
  message: ChatMessage;
  modelName?: string;
  onApproveToolCalls?: (messageId: string) => void;
  onDenyToolCalls?: (messageId: string) => void;
}

/** Highlighting failures must not inject raw code into innerHTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback or ignore
    }
  };

  const highlightedCode = React.useMemo(() => {
    const resolved = resolveLanguage(language);
    if (resolved) {
      try {
        return hljs.highlight(code, { language: resolved }).value;
      } catch {
        return escapeHtml(code);
      }
    }
    try {
      // Auto-detection is limited to the registered subset, which keeps the
      // bundle small at the cost of guessing on exotic languages.
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }, [code, language]);

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.07] bg-surface-canvas font-mono text-xs shadow-card">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-surface-base border-b border-white/[0.06] text-ink-400 select-none">
        <div className="flex items-center space-x-2">
          <Terminal className="w-3.5 h-3.5 text-accent-fg" />
          <span className="text-[11px] font-medium text-ink-200">
            {language || 'plaintext'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center space-x-1 px-2 py-0.5 text-[10px] text-ink-400 hover:text-ink-100 hover:bg-white/[0.06] rounded transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-success-fg" />
              <span className="text-success-fg">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code contents */}
      <div className="p-3.5 overflow-x-auto">
        <pre className="text-ink-100 leading-relaxed font-mono">
          <code
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
      </div>
    </div>
  );
};

export const MessageItem: React.FC<MessageItemProps> = React.memo(({
  message,
  modelName,
  onApproveToolCalls,
  onDenyToolCalls,
}) => {
  const isUser = message.role === 'user';
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopyFull = () => {
    try {
      navigator.clipboard.writeText(message.content);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // Ignore
    }
  };

  const formattedTime = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="group relative py-4 first:pt-2">
      {/* Top Meta Bar */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
              isUser
                ? 'bg-white/[0.06] text-ink-300 border border-white/[0.08]'
                : 'bg-gradient-to-br from-accent to-accent-active text-white shadow-subtle'
            }`}
          >
            {isUser ? <User className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-ink-100">
              {isUser ? 'You' : modelName || 'Agent'}
            </span>
            <span className="text-2xs text-ink-600 tabular">{formattedTime}</span>
          </div>
        </div>

        {/* Copy full message action */}
        {!isUser && message.content && (
          <button
            type="button"
            onClick={handleCopyFull}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 flex items-center gap-1 px-2 py-1 text-2xs text-ink-400 hover:text-ink-100 hover:bg-white/[0.06] rounded-md transition-all"
            title="Copy full message"
          >
            {copiedAll ? (
              <>
                <Check className="w-3 h-3 text-success-fg" />
                <span className="text-success-fg">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Render Attached Tool Executions (if any) */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="my-2 space-y-2 pl-[2.125rem]">
          {message.toolCalls.map((tc) => (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              onApprove={onApproveToolCalls ? () => onApproveToolCalls(message.id) : undefined}
              onDeny={onDenyToolCalls ? () => onDenyToolCalls(message.id) : undefined}
            />
          ))}
        </div>
      )}

      {/* Main Message Content */}
      <div className="text-sm text-ink-100 leading-[1.7] font-sans pl-[2.125rem]">
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '');
                const codeString = String(children).replace(/\n$/, '');

                if (!inline && match) {
                  return (
                    <CodeBlock
                      language={match[1]}
                      code={codeString}
                    />
                  );
                }

                if (!inline && !match && codeString.includes('\n')) {
                  return <CodeBlock code={codeString} />;
                }

                return (
                  <code
                    className="px-1.5 py-0.5 rounded bg-ink-750 text-accent-fg font-mono text-xs border border-white/[0.06]"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-2.5 last:mb-0">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc pl-5 mb-2.5 space-y-1">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal pl-5 mb-2.5 space-y-1">{children}</ol>;
              },
              li({ children }) {
                return <li className="text-ink-200">{children}</li>;
              },
              h1({ children }) {
                return <h1 className="text-lg font-bold text-ink-50 mt-4 mb-2">{children}</h1>;
              },
              h2({ children }) {
                return <h2 className="text-base font-bold text-ink-50 mt-3.5 mb-1.5">{children}</h2>;
              },
              h3({ children }) {
                return <h3 className="text-sm font-semibold text-ink-50 mt-3 mb-1">{children}</h3>;
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-fg hover:text-accent-fg underline underline-offset-2"
                  >
                    {children}
                  </a>
                );
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-2 border-accent/50 pl-3 italic text-ink-400 my-2">
                    {children}
                  </blockquote>
                );
              },
              table({ children }) {
                return (
                  <div className="overflow-x-auto my-3 rounded-lg border border-white/[0.08]">
                    <table className="min-w-full divide-y divide-white/[0.08] text-xs">
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children }) {
                return (
                  <th className="px-3 py-2 bg-surface-base text-left font-semibold text-ink-200">
                    {children}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td className="px-3 py-2 border-t border-white/[0.04] text-ink-200">
                    {children}
                  </td>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          message.isStreaming && (
            <div className="flex items-center space-x-1.5 text-ink-400 text-xs py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span>Thinking...</span>
            </div>
          )
        )}

        {/* Streaming Blink Cursor */}
        {message.isStreaming && message.content && (
          <span
            aria-hidden="true"
            className="inline-block w-2 h-4 bg-indigo-400 ml-1 translate-y-0.5 animate-pulse"
          />
        )}
      </div>
    </div>
  );
});

MessageItem.displayName = 'MessageItem';

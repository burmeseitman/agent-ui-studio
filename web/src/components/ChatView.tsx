import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ChatMessage, ProfessionType, PROFESSION_PRESETS } from '../types';
import { CloudDetector } from '../utils/models';
import { MessageItem } from './MessageItem';
import { WorkspacePicker, WorkspaceControls } from './WorkspacePicker';
import {
  Send,
  Square,
  Zap,
  ArrowUpRight,
  Terminal,
  FileText,
  FlaskConical,
  CornerDownLeft,
  AlertTriangle,
} from 'lucide-react';

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onStopGeneration: () => void;
  selectedEngine: string;
  selectedModel: string;
  profession: ProfessionType;
  errorMessage: string | null;
  fallbackLocalModel: { engine: string; model: string } | null;
  onFallbackAndRetry: (engine: string, model: string) => void;
  fallbackToast: string | null;
  onApproveToolCalls: (messageId: string) => void;
  onDenyToolCalls: (messageId: string) => void;
  isCloud: CloudDetector;
  workspace: WorkspaceControls;
  /** File tools only matter when some are enabled. */
  showWorkspace: boolean;
  onOpenPreview?: (filePath: string) => void;
  onOpenRawPreview?: (htmlCode: string) => void;
}

const STARTER_PROMPTS: Record<
  ProfessionType,
  Array<{ title: string; prompt: string; icon: React.ReactNode }>
> = {
  developer: [
    {
      title: 'Inspect the workspace',
      prompt: 'List the files in this directory and summarise the project architecture.',
      icon: <Terminal className="w-3.5 h-3.5" />,
    },
    {
      title: 'Review uncommitted work',
      prompt: 'Run git status and tell me what has changed.',
      icon: <Terminal className="w-3.5 h-3.5" />,
    },
    {
      title: 'Explain the entry point',
      prompt: 'Read main.go and explain how the program starts up.',
      icon: <FileText className="w-3.5 h-3.5" />,
    },
  ],
  writer: [
    {
      title: 'Analyse readability',
      prompt:
        'Analyse the readability of: "AgentUI Studio is an ultra-fast developer workspace for managing and interacting with local AI engines."',
      icon: <FileText className="w-3.5 h-3.5" />,
    },
    {
      title: 'Summarise an article',
      prompt: 'Fetch https://news.ycombinator.com and summarise the key takeaways.',
      icon: <FileText className="w-3.5 h-3.5" />,
    },
    {
      title: 'Draft landing copy',
      prompt: 'Draft 3 high-converting hero headlines for a local AI developer workspace.',
      icon: <FileText className="w-3.5 h-3.5" />,
    },
  ],
  researcher: [
    {
      title: 'Research a source',
      prompt: 'Fetch https://ollama.com and summarise its latest model capabilities.',
      icon: <FlaskConical className="w-3.5 h-3.5" />,
    },
    {
      title: 'Compare approaches',
      prompt:
        'Compare local quantised GGUF models against cloud API endpoints on latency, privacy and cost.',
      icon: <FlaskConical className="w-3.5 h-3.5" />,
    },
    {
      title: 'Assess documentation',
      prompt: 'Analyse readability metrics for academic versus developer documentation.',
      icon: <FlaskConical className="w-3.5 h-3.5" />,
    },
  ],
  custom: [
    {
      title: 'List the directory',
      prompt: 'Show me what is in the current directory.',
      icon: <Terminal className="w-3.5 h-3.5" />,
    },
    {
      title: 'Check the environment',
      prompt: 'Run whoami and pwd so I can see the current context.',
      icon: <Terminal className="w-3.5 h-3.5" />,
    },
    {
      title: 'Read a web page',
      prompt: 'Fetch https://example.com and extract the text.',
      icon: <FileText className="w-3.5 h-3.5" />,
    },
  ],
};

/** Grows the composer with its content, up to a ceiling. */
function useAutoResize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Layout effect so the height is correct on the frame the text changes,
  // rather than flashing at the previous size first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapsing to zero before measuring makes scrollHeight report the content
    // height; measuring against 'auto' can return the element's current box.
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return ref;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  onStopGeneration,
  selectedEngine,
  selectedModel,
  profession,
  errorMessage,
  fallbackLocalModel,
  onFallbackAndRetry,
  fallbackToast,
  onApproveToolCalls,
  onDenyToolCalls,
  isCloud,
  workspace,
  showWorkspace,
  onOpenPreview,
  onOpenRawPreview,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef(false);
  const textareaRef = useAutoResize(inputText);

  const scrollToBottom = useCallback((smooth: boolean = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (isStreaming) {
      window.requestAnimationFrame(() => scrollToBottom(false));
    } else {
      scrollToBottom(true);
    }
  }, [messages, isStreaming, scrollToBottom]);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isStreaming || isSendingRef.current) return;

    isSendingRef.current = true;
    setTimeout(() => {
      isSendingRef.current = false;
    }, 300);

    onSendMessage(trimmed);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isCurrentCloud = isCloud(selectedEngine, selectedModel);
  const starterList = STARTER_PROMPTS[profession] || STARTER_PROMPTS.developer;
  const preset = PROFESSION_PRESETS[profession];

  return (
    <div className="flex-1 flex flex-col h-full bg-surface-canvas overflow-hidden relative">
      {/* Fallback toast */}
      {fallbackToast && (
        <div className="absolute top-4 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface-overlay/95 border border-white/[0.1] shadow-elevated backdrop-blur-xl text-xs text-ink-100 animate-slide-up">
            <Zap className="w-3.5 h-3.5 text-warning-fg shrink-0" />
            <span>{fallbackToast}</span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6">
            <div className="w-full max-w-xl text-center animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent to-accent-active flex items-center justify-center mx-auto mb-5 shadow-accent-glow">
                <Terminal className="w-5 h-5 text-ink-50 stroke-[2.25]" />
              </div>

              <h2 className="text-xl font-semibold text-ink-50 mb-1.5">{preset?.name}</h2>
              <p className="text-sm text-ink-400 mb-8 max-w-sm mx-auto leading-relaxed">
                {selectedModel ? (
                  <>
                    Connected to{' '}
                    <span className="font-mono text-ink-200">{selectedModel}</span>
                  </>
                ) : (
                  'No local engine detected. Start Ollama or LM Studio, then rescan.'
                )}
              </p>

              {showWorkspace && (
                <div className="mb-6">
                  <div className="text-2xs font-medium uppercase tracking-widest text-ink-500 mb-2 text-left">
                    Working folder
                  </div>
                  <WorkspacePicker workspace={workspace} variant="hero" />
                </div>
              )}

              <div className="text-2xs font-medium uppercase tracking-widest text-ink-500 mb-3 text-left">
                Try one of these
              </div>

              <div className="space-y-1.5 text-left">
                {starterList.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => onSendMessage(item.prompt)}
                    disabled={!selectedModel || isStreaming}
                    className="group w-full text-left flex items-center gap-3 p-3 rounded-xl bg-surface-raised/70 hover:bg-surface-overlay border border-white/[0.05] hover:border-white/[0.1] transition-all duration-150 ease-swift disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-ink-400 group-hover:text-accent-fg group-hover:border-accent/25 transition-colors shrink-0">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-ink-100 group-hover:text-ink-50">
                        {item.title}
                      </span>
                      <span className="block text-2xs text-ink-500 truncate">{item.prompt}</span>
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-ink-600 group-hover:text-accent-fg shrink-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-5 py-6 space-y-1">
            {messages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                modelName={selectedModel}
                onApproveToolCalls={onApproveToolCalls}
                onDenyToolCalls={onDenyToolCalls}
                onOpenPreview={onOpenPreview}
                onOpenRawPreview={onOpenRawPreview}
              />
            ))}
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="max-w-3xl mx-auto px-5 pb-4"
          >
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-danger/[0.08] border border-danger/25 text-xs text-danger-fg">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="min-w-0">{errorMessage}</span>
              </div>
              {fallbackLocalModel && isCurrentCloud && (
                <button
                  type="button"
                  onClick={() =>
                    onFallbackAndRetry(fallbackLocalModel.engine, fallbackLocalModel.model)
                  }
                  className="px-2.5 py-1 rounded-md bg-danger/15 hover:bg-danger/25 text-danger-fg font-medium transition-colors shrink-0"
                >
                  Use {fallbackLocalModel.model}
                </button>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="px-5 pb-5 pt-2 shrink-0">
        <div className="max-w-3xl mx-auto">
          {showWorkspace && messages.length > 0 && (
            <WorkspacePicker workspace={workspace} variant="bar" />
          )}
          <div className="rounded-xl border border-white/[0.08] bg-surface-raised shadow-composer transition-colors duration-150 focus-within:border-accent/45">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Message"
              placeholder={
                selectedModel
                  ? `Message ${selectedModel}…`
                  : 'Select a model to start chatting'
              }
              disabled={!selectedModel}
              className="w-full bg-transparent text-sm text-ink-50 placeholder-ink-500 px-3.5 pt-3 pb-2 resize-none focus:outline-none disabled:opacity-50 leading-relaxed"
            />

            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <div className="flex items-center gap-2 text-2xs text-ink-500 select-none">
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" />
                  Send
                </span>
                <span className="text-ink-700">·</span>
                <span>Shift + ↵ for newline</span>
              </div>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStopGeneration}
                  aria-label="Stop generating"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-ink-100 text-xs font-medium transition-colors"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!inputText.trim() || !selectedModel}
                  aria-label="Send message"
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent hover:bg-accent-hover disabled:bg-white/[0.05] disabled:text-ink-600 text-white transition-all duration-150 ease-swift disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

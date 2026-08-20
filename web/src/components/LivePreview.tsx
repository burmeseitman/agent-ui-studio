import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  RotateCw,
  ExternalLink,
  X,
  Smartphone,
  Tablet,
  Monitor,
  Maximize2,
  Terminal,
  AlertCircle,
  Info,
  CheckCircle2,
  Trash2,
  Loader2,
  FileCode,
} from 'lucide-react';
import { executeToolApi } from '../services/api';

export type ViewportMode = 'responsive' | 'mobile' | 'tablet' | 'desktop';

interface ConsoleLogItem {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

interface LivePreviewProps {
  filePath?: string | null;
  rawHtml?: string | null;
  onClose: () => void;
  /** Counter or timestamp to trigger a reload when files change on disk */
  refreshTrigger?: number;
}

const VIEWPORT_WIDTHS: Record<ViewportMode, string> = {
  responsive: 'w-full',
  mobile: 'w-[375px]',
  tablet: 'w-[768px]',
  desktop: 'w-[1024px]',
};

export const LivePreview: React.FC<LivePreviewProps> = ({
  filePath,
  rawHtml,
  onClose,
  refreshTrigger,
}) => {
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportMode>('responsive');
  const [logs, setLogs] = useState<ConsoleLogItem[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load file content or use rawHtml
  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (rawHtml) {
      setHtmlContent(rawHtml);
      setLoading(false);
      return;
    }

    if (!filePath) {
      setLoading(false);
      return;
    }

    try {
      const res = await executeToolApi('read_file', JSON.stringify({ path: filePath }));
      if (res.error) {
        setError(`Failed to load ${filePath}: ${res.error}`);
        setHtmlContent('');
      } else {
        let content = res.output ?? '';

        // If it's an HTML file with relative links, attempt to inline simple relative assets
        const baseDir = filePath.includes('/')
          ? filePath.substring(0, filePath.lastIndexOf('/'))
          : '';

        // Inline relative CSS stylesheets if referenced in <link rel="stylesheet" href="...">
        const linkRegex = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
        const cssPromises: Promise<{ tag: string; replacement: string }>[] = [];

        let linkMatch;
        while ((linkMatch = linkRegex.exec(content)) !== null) {
          const href = linkMatch[1];
          if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//')) {
            const relPath = baseDir ? `${baseDir}/${href}` : href;
            const fullTag = linkMatch[0];
            cssPromises.push(
              executeToolApi('read_file', JSON.stringify({ path: relPath })).then((r) => ({
                tag: fullTag,
                replacement: r.output ? `<style>/* Inlined ${href} */\n${r.output}</style>` : fullTag,
              }))
            );
          }
        }

        // Inline relative scripts if referenced in <script src="..."></script>
        const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
        const jsPromises: Promise<{ tag: string; replacement: string }>[] = [];

        let scriptMatch;
        while ((scriptMatch = scriptRegex.exec(content)) !== null) {
          const src = scriptMatch[1];
          if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//')) {
            const relPath = baseDir ? `${baseDir}/${src}` : src;
            const fullTag = scriptMatch[0];
            jsPromises.push(
              executeToolApi('read_file', JSON.stringify({ path: relPath })).then((r) => ({
                tag: fullTag,
                replacement: r.output ? `<script>/* Inlined ${src} */\n${r.output}</script>` : fullTag,
              }))
            );
          }
        }

        if (cssPromises.length > 0 || jsPromises.length > 0) {
          const resolvedCss = await Promise.all(cssPromises);
          const resolvedJs = await Promise.all(jsPromises);

          for (const item of resolvedCss) {
            content = content.replace(item.tag, item.replacement);
          }
          for (const item of resolvedJs) {
            content = content.replace(item.tag, item.replacement);
          }
        }

        setHtmlContent(content);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filePath, rawHtml]);

  useEffect(() => {
    loadContent();
  }, [loadContent, refreshTrigger, reloadKey]);

  // Listen for console logs posted from the iframe bridge
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }
      if (event.data?.type === 'agentui_preview_console') {
        const item: ConsoleLogItem = {
          id: `log_${Date.now()}_${Math.random()}`,
          level: event.data.level || 'log',
          message: event.data.message || '',
          timestamp: Date.now(),
        };
        setLogs((prev) => [...prev.slice(-150), item]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Build sandboxed HTML payload with bridge script
  const srcDoc = React.useMemo(() => {
    if (!htmlContent) return '';

    const bridgeScript = `
<script>
(function() {
  function formatArg(a) {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch(e) { return String(a); }
    }
    return String(a);
  }
  function send(level, args) {
    try {
      window.parent.postMessage({
        type: 'agentui_preview_console',
        level: level,
        message: Array.from(args).map(formatArg).join(' ')
      }, '*');
    } catch(e) {}
  }
  var _log = console.log, _warn = console.warn, _error = console.error, _info = console.info;
  console.log = function() { send('log', arguments); _log.apply(console, arguments); };
  console.info = function() { send('info', arguments); _info.apply(console, arguments); };
  console.warn = function() { send('warn', arguments); _warn.apply(console, arguments); };
  console.error = function() { send('error', arguments); _error.apply(console, arguments); };
  window.addEventListener('error', function(e) {
    send('error', [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')]);
  });
})();
</script>
`;

    if (htmlContent.includes('<head>')) {
      return htmlContent.replace('<head>', `<head>${bridgeScript}`);
    }
    if (htmlContent.includes('<html>')) {
      return htmlContent.replace('<html>', `<html><head>${bridgeScript}</head>`);
    }
    return `${bridgeScript}${htmlContent}`;
  }, [htmlContent]);

  const handleOpenExternal = () => {
    if (!htmlContent) return;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  return (
    <div className="flex flex-col h-full w-full bg-surface-canvas border-l border-white/[0.08] select-none">
      {/* Header Toolbar */}
      <div className="h-[46px] shrink-0 px-3 bg-surface-base border-b border-white/[0.06] flex items-center justify-between gap-2">
        {/* File info */}
        <div className="flex items-center space-x-2 min-w-0">
          <div className="p-1 rounded bg-accent/10 border border-accent/20 text-accent-fg">
            <FileCode className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-mono font-medium text-ink-100 truncate max-w-[180px] sm:max-w-[240px]">
            {filePath || 'HTML Preview'}
          </span>
        </div>

        {/* Viewport & Action Controls */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {/* Device viewport switcher */}
          <div className="hidden sm:flex items-center p-0.5 rounded-lg bg-surface-raised border border-white/[0.06] text-ink-400">
            <button
              type="button"
              onClick={() => setViewport('responsive')}
              title="Responsive (100%)"
              className={`p-1 rounded transition-colors ${
                viewport === 'responsive'
                  ? 'bg-accent/20 text-accent-fg font-medium'
                  : 'hover:text-ink-100'
              }`}
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              title="Desktop (1024px)"
              className={`p-1 rounded transition-colors ${
                viewport === 'desktop'
                  ? 'bg-accent/20 text-accent-fg font-medium'
                  : 'hover:text-ink-100'
              }`}
            >
              <Monitor className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewport('tablet')}
              title="Tablet (768px)"
              className={`p-1 rounded transition-colors ${
                viewport === 'tablet'
                  ? 'bg-accent/20 text-accent-fg font-medium'
                  : 'hover:text-ink-100'
              }`}
            >
              <Tablet className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              title="Mobile (375px)"
              className={`p-1 rounded transition-colors ${
                viewport === 'mobile'
                  ? 'bg-accent/20 text-accent-fg font-medium'
                  : 'hover:text-ink-100'
              }`}
            >
              <Smartphone className="w-3 h-3" />
            </button>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            title="Reload preview"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-100 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-accent-fg' : ''}`} />
          </button>

          {/* Open External */}
          <button
            type="button"
            onClick={handleOpenExternal}
            disabled={!htmlContent}
            title="Open in new window"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-100 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Console Toggle */}
          <button
            type="button"
            onClick={() => setIsConsoleOpen(!isConsoleOpen)}
            title="Toggle Console Logs"
            className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs transition-colors border ${
              isConsoleOpen
                ? 'bg-accent/15 border-accent/30 text-accent-fg'
                : 'border-white/[0.06] text-ink-400 hover:text-ink-100 hover:bg-white/[0.04]'
            }`}
          >
            <Terminal className="w-3 h-3" />
            <span className="text-[10px] font-mono font-medium">Console</span>
            {(errorCount > 0 || warnCount > 0) && (
              <span
                className={`px-1 py-0.2 rounded-full text-[9px] font-mono ${
                  errorCount > 0 ? 'bg-danger/20 text-danger-fg' : 'bg-warning/20 text-warning-fg'
                }`}
              >
                {errorCount || warnCount}
              </span>
            )}
          </button>

          {/* Close Panel */}
          <button
            type="button"
            onClick={onClose}
            title="Close Preview"
            className="p-1.5 rounded-md text-ink-400 hover:text-ink-100 hover:bg-white/[0.06] transition-colors ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Preview Frame Area */}
      <div className="flex-1 overflow-auto p-3 flex flex-col items-center justify-center bg-surface-canvas/90 relative">
        {loading ? (
          <div className="flex flex-col items-center space-y-2 text-ink-400">
            <Loader2 className="w-6 h-6 animate-spin text-accent-fg" />
            <span className="text-xs font-mono">Loading preview…</span>
          </div>
        ) : error ? (
          <div className="max-w-md p-4 rounded-xl border border-danger/30 bg-danger/10 text-danger-fg text-center space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto text-danger-fg" />
            <p className="text-xs font-mono font-semibold">{error}</p>
          </div>
        ) : !htmlContent ? (
          <div className="text-center text-ink-500 space-y-2">
            <FileCode className="w-8 h-8 mx-auto opacity-40" />
            <p className="text-xs font-mono">No HTML content to display</p>
          </div>
        ) : (
          <div
            className={`h-full transition-all duration-200 flex flex-col rounded-xl overflow-hidden shadow-2xl border border-white/[0.08] bg-white ${VIEWPORT_WIDTHS[viewport]}`}
          >
            <iframe
              ref={iframeRef}
              key={`${filePath || 'raw'}_${refreshTrigger || 0}_${reloadKey}`}
              srcDoc={srcDoc}
              title="Live App Preview"
              sandbox="allow-scripts allow-modals allow-forms"
              className="w-full h-full border-0 bg-white"
            />
          </div>
        )}
      </div>

      {/* Interactive Console Drawer */}
      {isConsoleOpen && (
        <div className="h-44 shrink-0 bg-surface-base border-t border-white/[0.08] flex flex-col font-mono text-xs shadow-card">
          <div className="h-7 px-3 bg-surface-raised border-b border-white/[0.06] flex items-center justify-between text-ink-400">
            <div className="flex items-center space-x-2">
              <Terminal className="w-3 h-3 text-accent-fg" />
              <span className="text-[10px] uppercase font-bold tracking-wider text-ink-300">
                Console Output ({logs.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLogs([])}
              title="Clear Console"
              className="flex items-center space-x-1 text-[10px] hover:text-ink-100 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 select-text">
            {logs.length === 0 ? (
              <p className="text-[10px] text-ink-500 italic p-1">No console messages logged.</p>
            ) : (
              logs.map((l) => (
                <div
                  key={l.id}
                  className={`flex items-start space-x-1.5 text-[11px] px-1.5 py-0.5 rounded leading-relaxed break-all ${
                    l.level === 'error'
                      ? 'bg-danger/10 text-danger-fg'
                      : l.level === 'warn'
                        ? 'bg-warning/10 text-warning-fg'
                        : 'text-ink-200 hover:bg-white/[0.03]'
                  }`}
                >
                  {l.level === 'error' && <AlertCircle className="w-3 h-3 text-danger-fg shrink-0 mt-0.5" />}
                  {l.level === 'warn' && <AlertCircle className="w-3 h-3 text-warning-fg shrink-0 mt-0.5" />}
                  {l.level === 'info' && <Info className="w-3 h-3 text-info-fg shrink-0 mt-0.5" />}
                  {l.level === 'log' && <CheckCircle2 className="w-3 h-3 text-ink-500 shrink-0 mt-0.5" />}
                  <span className="flex-1 whitespace-pre-wrap">{l.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

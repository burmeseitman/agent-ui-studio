import React from 'react';
import { StreamStats } from '../types';
import {
  Gauge,
  Hash,
  Clock,
  Timer,
  CheckCircle2,
} from 'lucide-react';

interface StatsBarProps {
  stats: StreamStats | null;
  isStreaming: boolean;
}

export const StatsBar: React.FC<StatsBarProps> = React.memo(({ stats, isStreaming }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="h-7 border-t border-white/[0.05] bg-surface-base/60 px-4 flex items-center justify-between text-2xs text-ink-500 select-none shrink-0 z-10"
    >
      {/* Left: Stream State Badge */}
      <div className="flex items-center space-x-2">
        {isStreaming ? (
          <div className="flex items-center space-x-1.5 text-accent-fg">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="font-medium">streaming...</span>
          </div>
        ) : stats ? (
          <div className="flex items-center space-x-1.5 text-success-fg">
            <CheckCircle2 className="w-3 h-3" />
            <span className="font-medium">done</span>
          </div>
        ) : (
          <span>Ready</span>
        )}
      </div>

      {/* Right: Metrics */}
      {stats ? (
        <div className="flex items-center gap-4">
          {/* Speed */}
          <div
            className="flex items-center gap-1.5 text-ink-300 tabular"
            title={
              stats.estimated
                ? 'Approximate: this engine reported no token usage, so the count is estimated from characters'
                : 'Generation speed reported by the engine'
            }
          >
            <Gauge className="w-3 h-3 text-ink-600" />
            <span>
              {stats.estimated && <span className="text-ink-400">~</span>}
              {stats.tokensPerSec.toFixed(1)} tok/s
            </span>
          </div>

          {/* Tokens */}
          <div
            className="flex items-center gap-1.5 text-ink-300 tabular"
            title={
              stats.estimated
                ? 'Estimated from output length — the engine reported no usage'
                : stats.promptTokens !== undefined
                  ? `${stats.promptTokens} prompt + ${stats.totalTokens} completion tokens`
                  : 'Completion tokens reported by the engine'
            }
          >
            <Hash className="w-3 h-3 text-ink-600" />
            <span>
              {stats.estimated && <span className="text-ink-400">~</span>}
              {stats.totalTokens} tokens
            </span>
          </div>

          {/* TTFT */}
          {stats.timeToFirstTokenMs !== undefined && (
            <div
              className="flex items-center gap-1.5 text-ink-300 tabular"
              title="Time to First Token"
            >
              <Timer className="w-3 h-3 text-ink-600" />
              <span>{stats.timeToFirstTokenMs}ms TTFT</span>
            </div>
          )}

          {/* Elapsed */}
          <div
            className="flex items-center gap-1.5 text-ink-300 tabular"
            title="Total Elapsed Time"
          >
            <Clock className="w-3 h-3 text-ink-600" />
            <span>{(stats.elapsedMs / 1000).toFixed(2)}s</span>
          </div>
        </div>
      ) : (
        <div className="text-ink-600">No generation yet</div>
      )}
    </div>
  );
});

StatsBar.displayName = 'StatsBar';

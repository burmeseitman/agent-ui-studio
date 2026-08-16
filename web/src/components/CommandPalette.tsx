import React, { useState, useEffect, useRef } from 'react';
import { EngineInfo, ProfessionType, PROFESSION_PRESETS } from '../types';
import {
  Search,
  Cpu,
  Terminal,
  FileText,
  FlaskConical,
  Sliders,
  Trash2,
  Zap,
  ArrowRight,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  engines: EngineInfo[];
  selectedEngine: string;
  selectedModel: string;
  onSelectModel: (engine: string, model: string) => void;
  profession: ProfessionType;
  onChangeProfession: (prof: ProfessionType) => void;
  onClearChat: () => void;
  onRefreshEngines: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  engines,
  selectedEngine,
  selectedModel,
  onSelectModel,
  profession,
  onChangeProfession,
  onClearChat,
  onRefreshEngines,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build items list
  interface CommandItem {
    id: string;
    category: string;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    action: () => void;
    active?: boolean;
  }

  const items: CommandItem[] = [];

  // Models
  engines.forEach((eng) => {
    if (eng.active) {
      eng.models.forEach((mod) => {
        const isSelected = eng.name === selectedEngine && mod === selectedModel;
        items.push({
          id: `model-${eng.name}-${mod}`,
          category: 'Models',
          title: mod,
          subtitle: eng.name,
          icon: <Cpu className="w-4 h-4 text-accent-fg" />,
          action: () => onSelectModel(eng.name, mod),
          active: isSelected,
        });
      });
    }
  });

  // Professions
  const profIcons: Record<ProfessionType, React.ReactNode> = {
    developer: <Terminal className="w-4 h-4 text-success-fg" />,
    writer: <FileText className="w-4 h-4 text-warning-fg" />,
    researcher: <FlaskConical className="w-4 h-4 text-info-fg" />,
    custom: <Sliders className="w-4 h-4 text-accent-fg" />,
  };

  (Object.keys(PROFESSION_PRESETS) as ProfessionType[]).forEach((p) => {
    items.push({
      id: `prof-${p}`,
      category: 'Personas',
      title: PROFESSION_PRESETS[p].name,
      subtitle: PROFESSION_PRESETS[p].description,
      icon: profIcons[p],
      action: () => onChangeProfession(p),
      active: profession === p,
    });
  });

  // Actions
  items.push({
    id: 'act-refresh',
    category: 'Actions',
    title: 'Rescan AI Engines',
    subtitle: 'Probe localhost:11434 and localhost:1234',
    icon: <Zap className="w-4 h-4 text-warning-fg" />,
    action: onRefreshEngines,
  });

  items.push({
    id: 'act-clear',
    category: 'Actions',
    title: 'Clear Conversation',
    subtitle: 'Reset current chat messages and metrics',
    icon: <Trash2 className="w-4 h-4 text-danger-fg" />,
    action: onClearChat,
  });

  // Filter items
  const filtered = items.filter((item) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
      item.category.toLowerCase().includes(q)
    );
  });

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface-base border border-white/10 rounded-xl shadow-command overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-white/[0.08] bg-surface-raised">
          <Search className="w-4 h-4 text-ink-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-ink-50 placeholder-ink-500 focus:outline-none"
            placeholder="Type a command or search models, personas, actions..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-ink-400 bg-ink-750 border border-white/10 rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto py-2 divide-y divide-white/[0.04]">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-500">
              No matching commands or models found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-xs transition-colors duration-100 ${
                    isSelected
                      ? 'bg-accent/15 text-ink-50'
                      : 'hover:bg-white/[0.03] text-ink-200'
                  }`}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="flex items-center space-x-3 truncate">
                    <div className="p-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
                      {item.icon}
                    </div>
                    <div className="truncate">
                      <div className="font-medium text-ink-100 flex items-center space-x-2">
                        <span>{item.title}</span>
                        {item.active && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-accent/20 text-accent-fg font-mono">
                            active
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <div className="text-[11px] text-ink-400 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 ml-3">
                    <span className="text-[10px] font-mono text-ink-400 px-1.5 py-0.5 rounded bg-white/[0.04]">
                      {item.category}
                    </span>
                    {isSelected && <ArrowRight className="w-3.5 h-3.5 text-accent-fg" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hint */}
        <div className="flex items-center justify-between px-4 py-2 bg-surface-canvas border-t border-white/[0.06] text-[11px] text-ink-400 font-mono">
          <div className="flex items-center space-x-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>AgentUI Studio Command Hub</span>
        </div>
      </div>
    </div>
  );
};

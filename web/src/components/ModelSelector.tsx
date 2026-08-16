import React, { useEffect, useRef, useState } from 'react';
import { EngineInfo } from '../types';
import { CloudDetector } from '../utils/models';
import { ChevronDown, Cpu, Cloud, Check, Search } from 'lucide-react';

interface ModelSelectorProps {
  engines: EngineInfo[];
  selectedEngine: string;
  selectedModel: string;
  onSelectModel: (engine: string, model: string) => void;
  isCloud: CloudDetector;
}

/** Engine-grouped model picker with a filter for large model lists. */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  engines,
  selectedEngine,
  selectedModel,
  onSelectModel,
  isCloud,
}) => {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState<boolean>(false);
  const [modelFilter, setModelFilter] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isSelectedCloud = isCloud(selectedEngine, selectedModel);
  const activeEngines = engines.filter((e) => e.active && e.models.length > 0);

  // Close on outside click, the usual dropdown affordance.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
          <div>
            <div className="text-2xs font-medium uppercase tracking-widest text-ink-600 mb-2">
              Active Model
            </div>

            <div className="relative" ref={dropdownRef}>
              {/* Trigger Button */}
              <button
                type="button"
                onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                className="w-full flex items-center justify-between bg-surface-raised hover:bg-surface-overlay border border-white/[0.12] hover:border-white/[0.22] text-xs rounded-lg px-3 py-2.5 transition-all text-left shadow-sm cursor-pointer group"
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <div className="p-1 rounded bg-white/[0.06] text-accent-fg shrink-0">
                    {isSelectedCloud ? (
                      <Cloud className="w-3.5 h-3.5 text-info-fg" />
                    ) : (
                      <Cpu className="w-3.5 h-3.5 text-accent-fg" />
                    )}
                  </div>
                  <div className="truncate">
                    <div className="font-mono font-bold text-ink-50 text-[13px] truncate leading-tight">
                      {selectedModel || 'Select a Model'}
                    </div>
                    <div className="text-[10px] font-mono text-ink-400 mt-0.5 flex items-center space-x-1.5">
                      <span className="uppercase text-ink-200">{selectedEngine || 'none'}</span>
                      <span>•</span>
                      <span className={isSelectedCloud ? 'text-info-fg font-medium' : 'text-success-fg font-medium'}>
                        {isSelectedCloud ? 'Cloud API' : 'Local GPU'}
                      </span>
                    </div>
                  </div>
                </div>

                <ChevronDown
                  className={`w-4 h-4 text-ink-400 group-hover:text-ink-100 transition-transform shrink-0 ml-2 ${
                    isModelDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* High-Contrast Dropdown Popover */}
              {isModelDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface-base border border-white/[0.15] rounded-xl shadow-command z-50 overflow-hidden animate-slide-up">
                  {/* Search filter if multiple models */}
                  <div className="p-2 border-b border-white/[0.08] bg-surface-canvas">
                    <div className="flex items-center px-2 py-1 bg-surface-raised rounded-md border border-white/[0.08]">
                      <Search className="w-3.5 h-3.5 text-ink-400 mr-2 shrink-0" />
                      <input
                        type="text"
                        className="w-full bg-transparent text-xs text-ink-50 placeholder-ink-500 focus:outline-none font-mono"
                        placeholder="Filter models..."
                        value={modelFilter}
                        onChange={(e) => setModelFilter(e.target.value)}
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* List of Models grouped by engine */}
                  <div className="max-h-64 overflow-y-auto p-1.5 space-y-2 divide-y divide-white/[0.04]">
                    {activeEngines.length === 0 ? (
                      <div className="p-4 text-center text-xs text-ink-400">
                        No local engines active. Ensure Ollama or LM Studio is running.
                      </div>
                    ) : (
                      activeEngines.map((eng) => {
                        const filteredModels = eng.models.filter((m) =>
                          m.toLowerCase().includes(modelFilter.toLowerCase())
                        );
                        if (filteredModels.length === 0) return null;

                        return (
                          <div key={eng.name} className="pt-1.5 first:pt-0">
                            <div className="px-2.5 py-1 text-[10px] font-bold font-mono text-ink-400 uppercase tracking-wider flex items-center justify-between">
                              <span>{eng.name} Engine</span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-success/15 text-success-fg">
                                online
                              </span>
                            </div>

                            <div className="space-y-0.5 mt-1">
                              {filteredModels.map((mod) => {
                                const isSelected = eng.name === selectedEngine && mod === selectedModel;
                                const modelIsCloud = isCloud(eng.name, mod);

                                return (
                                  <button
                                    key={`${eng.name}-${mod}`}
                                    type="button"
                                    onClick={() => {
                                      onSelectModel(eng.name, mod);
                                      setIsModelDropdownOpen(false);
                                      setModelFilter('');
                                    }}
                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-mono text-left transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-accent/25 text-ink-50 border border-accent/40 shadow-sm'
                                        : 'hover:bg-surface-overlay text-ink-100 hover:text-ink-50'
                                    }`}
                                  >
                                    <div className="flex items-center space-x-2 truncate">
                                      <div
                                        className={`w-2 h-2 rounded-full shrink-0 ${
                                          modelIsCloud ? 'bg-info' : 'bg-success'
                                        }`}
                                      />
                                      <span className="font-bold text-ink-50 text-[12px] truncate">
                                        {mod}
                                      </span>
                                    </div>

                                    <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                                      <span
                                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                          modelIsCloud
                                            ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                                            : 'bg-success/10 text-success-fg border-success/25'
                                        }`}
                                      >
                                        {modelIsCloud ? 'Cloud' : 'Local'}
                                      </span>
                                      {isSelected && <Check className="w-3.5 h-3.5 text-accent-fg" />}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
  );
};

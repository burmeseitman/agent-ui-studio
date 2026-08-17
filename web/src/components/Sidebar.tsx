import React, { useState, useEffect } from 'react';
import {
  EngineInfo,
  ChatParams,
  ProfessionType,
  PROFESSION_PRESETS,
} from '../types';
import { CloudDetector } from '../utils/models';
import { ChatSession } from '../services/sessions';
import { SessionList } from './SessionList';
import { WorkspacePicker, WorkspaceControls } from './WorkspacePicker';
import { ModelSelector } from './ModelSelector';
import { ToolsPanel } from './ToolsPanel';
import { SettingsPanel, AuthControls, DaemonCapabilities } from './SettingsPanel';
import {
  Terminal,
  FileText,
  FlaskConical,
  Sliders,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Wrench,
  Settings2,
  MessagesSquare,
} from 'lucide-react';

interface SidebarProps {
  engines: EngineInfo[];
  selectedEngine: string;
  selectedModel: string;
  onSelectModel: (engine: string, model: string) => void;
  params: ChatParams;
  onChangeParams: (partial: Partial<ChatParams>) => void;
  onClearChat: () => void;
  hasMessages: boolean;
  /** Tool names the daemon reports as side-effect free. */
  readOnlyTools: Record<string, boolean>;
  isCloud: CloudDetector;
  auth: AuthControls;
  daemon: DaemonCapabilities;
  workspace: WorkspaceControls;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
}

const AVAILABLE_TOOLS = [
  { id: 'list_tree', name: 'list_tree', desc: 'See the project structure at a glance' },
  { id: 'search_files', name: 'search_files', desc: 'Find code by literal text, with file:line' },
  { id: 'read_file', name: 'read_file', desc: 'Read a file in the workspace' },
  { id: 'edit_file', name: 'edit_file', desc: 'Change part of a file, leaving the rest intact' },
  { id: 'write_file', name: 'write_file', desc: 'Create a file or overwrite it entirely' },
  { id: 'move_file', name: 'move_file', desc: 'Rename or move a file' },
  { id: 'delete_file', name: 'delete_file', desc: 'Delete a file or empty folder' },
  { id: 'list_dir', name: 'list_dir', desc: 'List one directory level' },
  { id: 'execute_command', name: 'execute_command', desc: 'Run an allowlisted command (no shell)' },
  { id: 'fetch_url', name: 'fetch_url', desc: 'Read a public web page as text' },
  { id: 'analyze_readability', name: 'analyze_readability', desc: 'Flesch scores and reading time' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  engines,
  selectedEngine,
  selectedModel,
  onSelectModel,
  params,
  onChangeParams,
  onClearChat,
  hasMessages,
  readOnlyTools,
  isCloud,
  auth,
  daemon,
  workspace,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'chats' | 'tools' | 'settings'>('chats');

  // Which of the enabled tools the daemon will actually run without asking.
  const autoRunTools = params.enabledTools.filter((name) => readOnlyTools[name]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsCollapsed(true);
    }
  }, []);

  const handleProfessionChange = (prof: ProfessionType) => {
    const preset = PROFESSION_PRESETS[prof];
    onChangeParams({
      profession: prof,
      systemPrompt: preset.defaultPrompt,
      enabledTools: preset.defaultTools,
    });
  };

  const handleToggleTool = (toolId: string) => {
    const current = params.enabledTools;
    const updated = current.includes(toolId)
      ? current.filter((t) => t !== toolId)
      : [...current, toolId];

    onChangeParams({
      enabledTools: updated,
      profession: 'custom',
    });
  };

  const profIcons: Record<ProfessionType, React.ReactNode> = {
    developer: <Terminal className="w-3.5 h-3.5" />,
    writer: <FileText className="w-3.5 h-3.5" />,
    researcher: <FlaskConical className="w-3.5 h-3.5" />,
    custom: <Sliders className="w-3.5 h-3.5" />,
  };

  const handleClearWithConfirm = () => {
    if (hasMessages) {
      if (window.confirm('Clear all conversation messages?')) {
        onClearChat();
      }
    }
  };


  return (
    <aside
      className={`border-r border-white/[0.06] bg-surface-base flex flex-col shrink-0 select-none transition-[width] duration-200 ease-swift z-20 ${
        isCollapsed ? 'w-[52px]' : 'w-[292px]'
      }`}
    >
      {/* Top Header / Toggle */}
      <div className="h-9 flex items-center justify-between px-2.5 shrink-0">
        {!isCollapsed && (
          <span className="text-2xs font-medium tracking-widest text-ink-600 uppercase pl-1">
            Workspace
          </span>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 text-ink-500 hover:text-ink-100 hover:bg-white/[0.06] rounded-md transition-colors ml-auto"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {isCollapsed ? (
        /* Collapsed Icon Bar */
        <div className="flex-1 flex flex-col items-center py-3 space-y-3">
          {(Object.keys(PROFESSION_PRESETS) as ProfessionType[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                handleProfessionChange(p);
                setIsCollapsed(false);
              }}
              className={`p-2 rounded-lg transition-colors cursor-pointer ${
                params.profession === p
                  ? 'bg-accent/25 text-accent-fg border border-accent/40 shadow-sm'
                  : 'text-ink-400 hover:text-ink-100 hover:bg-white/[0.04]'
              }`}
              title={PROFESSION_PRESETS[p].name}
            >
              {profIcons[p]}
            </button>
          ))}
        </div>
      ) : (
        /* Expanded Full Sidebar */
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 space-y-4">
          {/* Section 1: Profession Personas */}
          <div>
            <div className="text-2xs font-medium uppercase tracking-widest text-ink-600 mb-2">
              Persona Preset
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PROFESSION_PRESETS) as ProfessionType[]).map((p) => {
                const isSelected = params.profession === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleProfessionChange(p)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-150 ease-swift text-left border ${
                      isSelected
                        ? 'bg-accent/[0.14] border-accent/40 text-ink-50'
                        : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] text-ink-300 hover:text-ink-50'
                    }`}
                  >
                    <span className={isSelected ? 'text-accent-fg' : 'text-ink-400'}>
                      {profIcons[p]}
                    </span>
                    <span className="truncate">{PROFESSION_PRESETS[p].name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 1b: Where the agent's file tools point */}
          <WorkspacePicker workspace={workspace} variant="panel" />

          {/* Section 2: Model selection */}
          <ModelSelector
            engines={engines}
            profession={params.profession}
            selectedEngine={selectedEngine}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
            isCloud={isCloud}
          />

          {/* Section 3: Sub-Tabs (Chats / Tools / Parameters) */}
          <div className="pt-1">
            <div className="flex border-b border-white/[0.06] mb-3">
              <button
                type="button"
                onClick={() => setActiveTab('chats')}
                className={`flex items-center gap-1.5 pb-2 px-1 text-xs font-medium border-b-2 transition-colors mr-3 ${
                  activeTab === 'chats'
                    ? 'border-accent text-ink-50'
                    : 'border-transparent text-ink-400 hover:text-ink-100'
                }`}
              >
                <MessagesSquare className="w-3.5 h-3.5" />
                <span>Chats</span>
                <span className="text-2xs px-1.5 rounded-full bg-white/[0.07] text-ink-400 tabular">
                  {sessions.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('tools')}
                className={`flex items-center gap-1.5 pb-2 px-1 text-xs font-medium border-b-2 transition-colors mr-3 ${
                  activeTab === 'tools'
                    ? 'border-accent text-ink-50'
                    : 'border-transparent text-ink-400 hover:text-ink-100'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Tools</span>
                <span className="text-2xs px-1.5 rounded-full bg-white/[0.07] text-ink-400 tabular">
                  {params.enabledTools.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-1.5 pb-2 px-1 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === 'settings'
                    ? 'border-accent text-ink-50'
                    : 'border-transparent text-ink-400 hover:text-ink-100'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
            </div>

            {activeTab === 'chats' && (
              <SessionList
                sessions={sessions}
                activeId={activeSessionId}
                onSelect={onSelectSession}
                onNew={onNewSession}
                onDelete={onDeleteSession}
                onRename={onRenameSession}
              />
            )}

            {activeTab === 'tools' && (
              <ToolsPanel
                params={params}
                onChangeParams={onChangeParams}
                availableTools={AVAILABLE_TOOLS}
                onToggleTool={handleToggleTool}
                autoRunTools={autoRunTools}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsPanel params={params} onChangeParams={onChangeParams} auth={auth} daemon={daemon} />
            )}
          </div>
        </div>
      )}

      {/* Sidebar Footer */}
      {!isCollapsed && (
        <div className="p-3.5 border-t border-white/[0.06] bg-surface-canvas/60">
          <button
            type="button"
            onClick={handleClearWithConfirm}
            disabled={!hasMessages}
            className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-medium text-ink-400 hover:text-danger-fg hover:bg-danger/10 border border-transparent hover:border-danger/25 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear Conversation</span>
          </button>
        </div>
      )}
    </aside>
  );
};

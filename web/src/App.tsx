import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatParams, PROFESSION_PRESETS, ProfessionType } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { StatsBar } from './components/StatsBar';
import { CommandPalette } from './components/CommandPalette';
import { TokenPrompt } from './components/TokenPrompt';
import { useEngines } from './hooks/useEngines';
import { useSessions } from './hooks/useSessions';
import { useAuth } from './hooks/useAuth';
import { useTools } from './hooks/useTools';
import { useWorkspace } from './hooks/useWorkspace';
import { useDaemonSettings } from './hooks/useDaemonSettings';
import { useChat } from './hooks/useChat';

export const App: React.FC = () => {
  const [params, setParams] = useState<ChatParams>({
    profession: 'developer',
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: PROFESSION_PRESETS.developer.defaultPrompt,
    autoFallbackToLocal: true,
    enabledTools: PROFESSION_PRESETS.developer.defaultTools,
    // Read-only tools run unattended; anything that writes waits for approval.
    toolApproval: 'read-only',
  });

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const handleUpdateParams = (partial: Partial<ChatParams>) => {
    setParams((prev) => ({ ...prev, ...partial }));
  };

  const auth = useAuth();
  const {
    sessions,
    activeSession,
    activeId,
    selectSession,
    newSession,
    deleteSession,
    renameSession,
    commitMessages,
  } = useSessions();
  const { readOnlyTools } = useTools(params.profession, auth.ready);
  const workspace = useWorkspace(auth.ready);
  const daemon = useDaemonSettings(auth.ready);

  const {
    engines,
    isLoadingEngines,
    selectedEngine,
    selectedModel,
    fallbackLocalModel,
    loadEngines,
    handleSelectModel,
    isCloud,
  } = useEngines(auth.ready, params.profession);

  const {
    messages,
    isStreaming,
    currentStats,
    errorMessage,
    fallbackToast,
    handleSendMessage,
    handleStopGeneration,
    handleClearChat,
    handleFallbackAndRetry,
    handleApproveToolCalls,
    handleDenyToolCalls,
  } = useChat({
    paramsRef,
    fallbackLocalModel,
    handleSelectModel,
    readOnlyTools,
    isCloud,
    workspacePath: workspace.workspacePath,
    workspaceEntries: workspace.entries,
    sessionId: activeId,
    sessionMessages: activeSession?.messages ?? [],
    onCommitMessages: commitMessages,
  });

  // Global Keyboard Shortcuts (⌘K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleChangeProfession = useCallback((prof: ProfessionType) => {
    const preset = PROFESSION_PRESETS[prof];
    handleUpdateParams({
      profession: prof,
      systemPrompt: preset.defaultPrompt,
      enabledTools: preset.defaultTools,
    });
  }, []);

  const onSendMessageWrapper = (text: string) => {
    handleSendMessage(text, selectedEngine, selectedModel);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-canvas text-ink-50 font-sans overflow-hidden">
      {/* Top Header */}
      <Header
        engines={engines}
        isLoadingEngines={isLoadingEngines}
        onRefreshEngines={loadEngines}
        selectedEngine={selectedEngine}
        selectedModel={selectedModel}
        isCloud={isCloud}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          engines={engines}
          selectedEngine={selectedEngine}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          params={params}
          onChangeParams={handleUpdateParams}
          onClearChat={handleClearChat}
          hasMessages={messages.length > 0}
          readOnlyTools={readOnlyTools}
          isCloud={isCloud}
          auth={auth}
          daemon={daemon}
          workspace={workspace}
          sessions={sessions}
          activeSessionId={activeId}
          onSelectSession={selectSession}
          onNewSession={newSession}
          onDeleteSession={deleteSession}
          onRenameSession={renameSession}
        />

        {/* Center / Main Chat Area */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <ChatView
            messages={messages}
            isStreaming={isStreaming}
            onSendMessage={onSendMessageWrapper}
            onStopGeneration={handleStopGeneration}
            selectedEngine={selectedEngine}
            selectedModel={selectedModel}
            profession={params.profession}
            errorMessage={errorMessage}
            fallbackLocalModel={fallbackLocalModel}
            onFallbackAndRetry={handleFallbackAndRetry}
            fallbackToast={fallbackToast}
            onApproveToolCalls={handleApproveToolCalls}
            onDenyToolCalls={handleDenyToolCalls}
            isCloud={isCloud}
            workspace={workspace}
            showWorkspace={params.enabledTools.length > 0}
          />

          {/* Bottom Speedometer Stats Bar */}
          <StatsBar stats={currentStats} isStreaming={isStreaming} />
        </div>
      </div>

      {/* Blocks the app when the daemon needs a token we do not have yet. */}
      {auth.authRequired && !auth.hasToken && (
        <TokenPrompt
          blocking
          hasToken={auth.hasToken}
          tokenFromEnv={auth.tokenFromEnv}
          onSave={auth.saveToken}
          onClear={auth.removeToken}
        />
      )}

      {/* Command Palette Modal (⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        engines={engines}
        selectedEngine={selectedEngine}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        profession={params.profession}
        onChangeProfession={handleChangeProfession}
        onClearChat={handleClearChat}
        onRefreshEngines={loadEngines}
      />
    </div>
  );
};

export default App;

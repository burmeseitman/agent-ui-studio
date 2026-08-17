import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatParams, PROFESSION_PRESETS, ProfessionType } from './types';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { StatsBar } from './components/StatsBar';
import { CommandPalette } from './components/CommandPalette';
import { TokenPrompt } from './components/TokenPrompt';
import { LivePreview } from './components/LivePreview';
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
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [rawPreviewHtml, setRawPreviewHtml] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState<number>(0);

  const handleOpenPreview = useCallback((filePath: string) => {
    setPreviewPath(filePath);
    setRawPreviewHtml(null);
    setIsPreviewOpen(true);
  }, []);

  const handleOpenRawPreview = useCallback((htmlCode: string) => {
    setRawPreviewHtml(htmlCode);
    setPreviewPath(null);
    setIsPreviewOpen(true);
  }, []);

  const handleTogglePreview = useCallback(() => {
    setIsPreviewOpen((prev) => !prev);
  }, []);

  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false);
  }, []);

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

  const handleApproveToolCallsWrapper = useCallback(
    async (messageId: string) => {
      await handleApproveToolCalls(messageId);
      setPreviewRefreshKey((k) => k + 1);
    },
    [handleApproveToolCalls]
  );

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
        isPreviewOpen={isPreviewOpen}
        onTogglePreview={handleTogglePreview}
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

        {/* Center / Main Area (Chat + Optional Live Preview Split) */}
        <div className="flex-1 flex h-full overflow-hidden">
          <div
            className={`flex flex-col h-full overflow-hidden transition-all duration-200 ${
              isPreviewOpen ? 'flex-1 min-w-0 md:max-w-[55%] lg:max-w-[50%]' : 'flex-1'
            }`}
          >
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
              onApproveToolCalls={handleApproveToolCallsWrapper}
              onDenyToolCalls={handleDenyToolCalls}
              isCloud={isCloud}
              workspace={workspace}
              showWorkspace={params.enabledTools.length > 0}
              onOpenPreview={handleOpenPreview}
              onOpenRawPreview={handleOpenRawPreview}
            />

            {/* Bottom Speedometer Stats Bar */}
            <StatsBar stats={currentStats} isStreaming={isStreaming} />
          </div>

          {/* Live Web App Preview Split View */}
          {isPreviewOpen && (
            <div className="flex-1 min-w-0 h-full border-l border-white/[0.08] animate-fade-in">
              <LivePreview
                filePath={
                  previewPath ||
                  (workspace.entries.find(
                    (e) => e.endsWith('.html') || e.endsWith('.htm') || e === 'index.html'
                  ) ??
                    'index.html')
                }
                rawHtml={rawPreviewHtml}
                onClose={handleClosePreview}
                refreshTrigger={previewRefreshKey}
              />
            </div>
          )}
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

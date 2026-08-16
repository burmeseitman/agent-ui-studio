import { useCallback, useMemo, useRef, useState } from 'react';
import { ChatMessage } from '../types';
import {
  ChatSession,
  createSession,
  loadActiveSessionId,
  loadSessions,
  saveActiveSessionId,
  saveSessions,
  updateSessionMessages,
} from '../services/sessions';

interface SessionState {
  sessions: ChatSession[];
  activeId: string;
}

/**
 * Seeds the session list and the active id together.
 *
 * These must come from one read of storage: deriving them independently let the
 * active id point at nothing on a first run, which made every save a no-op while
 * the UI still looked correct because it fell back to the first session.
 */
function initialSessionState(): SessionState {
  const stored = loadSessions();
  const sessions = stored.length > 0 ? stored : [createSession()];
  const storedActive = loadActiveSessionId();
  const activeId =
    storedActive && sessions.some((s) => s.id === storedActive) ? storedActive : sessions[0].id;
  return { sessions, activeId };
}

/**
 * Owns the set of conversations and which one is active.
 *
 * useChat reads and writes only the active session's messages, so switching
 * conversations is a matter of swapping which list it is pointed at.
 */
export function useSessions() {
  const [state, setState] = useState<SessionState>(initialSessionState);
  const { sessions, activeId } = state;

  // Read by callbacks that must not be recreated when the active id changes.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId]
  );

  const selectSession = useCallback((id: string) => {
    saveActiveSessionId(id);
    setState((current) => ({ ...current, activeId: id }));
  }, []);

  const newSession = useCallback(() => {
    const session = createSession();
    saveActiveSessionId(session.id);
    setState((current) => ({
      sessions: saveSessions([session, ...current.sessions]),
      activeId: session.id,
    }));
    return session;
  }, []);

  const deleteSession = useCallback((id: string) => {
    setState((current) => {
      const remaining = current.sessions.filter((s) => s.id !== id);
      // Never leave the workspace with no conversation at all.
      const sessions = saveSessions(remaining.length > 0 ? remaining : [createSession()]);

      if (id !== current.activeId) {
        return { sessions, activeId: current.activeId };
      }
      const fallback = sessions[0].id;
      saveActiveSessionId(fallback);
      return { sessions, activeId: fallback };
    });
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    setState((current) => ({
      ...current,
      sessions: saveSessions(current.sessions.map((s) => (s.id === id ? { ...s, title: clean } : s))),
    }));
  }, []);

  /** Called by useChat whenever the active conversation's messages settle. */
  const commitMessages = useCallback((messages: ChatMessage[]) => {
    setState((current) => ({
      ...current,
      sessions: saveSessions(updateSessionMessages(current.sessions, current.activeId, messages)),
    }));
  }, []);

  return {
    sessions,
    activeSession,
    activeId: activeSession?.id ?? activeIdRef.current,
    selectSession,
    newSession,
    deleteSession,
    renameSession,
    commitMessages,
  };
}

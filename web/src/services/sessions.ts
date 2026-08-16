import { ChatMessage } from '../types';

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const SESSIONS_KEY = 'agentui_sessions';
const ACTIVE_KEY = 'agentui_active_session';
/** The single-conversation key used before sessions existed. */
const LEGACY_HISTORY_KEY = 'agentui_chat_history';

const MAX_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 100;

/**
 * Storage can be absent, stubbed, or throw outright (private browsing, sandboxed
 * frames, non-browser test runners), so every access is feature-detected.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
      ? localStorage
      : null;
  } catch {
    return null;
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function createSession(messages: ChatMessage[] = []): ChatSession {
  const now = Date.now();
  return { id: newId(), title: 'New chat', messages, createdAt: now, updatedAt: now };
}

/**
 * Derives a readable title from the first thing the user actually said.
 * Sessions keep their title once set, so renaming stays under user control.
 */
export function deriveTitle(messages: ChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return null;

  const oneLine = firstUser.content.trim().replace(/\s+/g, ' ');
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

function trimSession(session: ChatSession): ChatSession {
  if (session.messages.length <= MAX_MESSAGES_PER_SESSION) return session;
  return { ...session, messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION) };
}

/**
 * Loads all sessions, migrating a pre-sessions conversation into the first one
 * so upgrading users do not silently lose their history.
 */
export function loadSessions(): ChatSession[] {
  const store = storage();
  if (!store) return [];

  try {
    const raw = store.getItem(SESSIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is ChatSession => Boolean(s?.id && Array.isArray(s.messages)));
      }
    }

    const legacy = store.getItem(LEGACY_HISTORY_KEY);
    if (legacy) {
      const messages = JSON.parse(legacy);
      if (Array.isArray(messages) && messages.length > 0) {
        const migrated = createSession(messages);
        migrated.title = deriveTitle(messages) ?? 'Imported chat';
        saveSessions([migrated]);
        store.removeItem(LEGACY_HISTORY_KEY);
        return [migrated];
      }
      store.removeItem(LEGACY_HISTORY_KEY);
    }
  } catch (e) {
    console.error('Failed to load chat sessions', e);
  }

  return [];
}

export function saveSessions(sessions: ChatSession[]): ChatSession[] {
  const store = storage();
  const bounded = sessions
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map(trimSession);

  if (!store) return bounded;

  try {
    store.setItem(SESSIONS_KEY, JSON.stringify(bounded));
  } catch (e) {
    // Most likely a quota error; drop the oldest sessions and retry once.
    console.warn('Chat history did not fit in storage, dropping older sessions', e);
    try {
      store.setItem(SESSIONS_KEY, JSON.stringify(bounded.slice(0, 5)));
    } catch {
      /* history is a convenience, never a requirement */
    }
  }
  return bounded;
}

export function loadActiveSessionId(): string | null {
  return storage()?.getItem(ACTIVE_KEY) ?? null;
}

export function saveActiveSessionId(id: string): void {
  try {
    storage()?.setItem(ACTIVE_KEY, id);
  } catch {
    /* non-fatal */
  }
}

/** Replaces one session's messages, refreshing its title and timestamp. */
export function updateSessionMessages(
  sessions: ChatSession[],
  sessionId: string,
  messages: ChatMessage[]
): ChatSession[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const title =
      session.title === 'New chat' ? (deriveTitle(messages) ?? session.title) : session.title;
    return { ...session, messages, title, updatedAt: Date.now() };
  });
}

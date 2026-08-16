import { getDesktopDaemon } from './daemon';

const TOKEN_KEY = 'agentui_token';

const env = (import.meta as any).env ?? {};

/** Raised when the daemon rejects a request for lack of a valid token. */
export class AuthError extends Error {
  constructor(message = 'Unauthorized — this daemon requires an API token.') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Storage access throws outright in some environments (Safari private browsing,
 * sandboxed frames), so every read and write is guarded.
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

function safeRead(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function getToken(): string {
  // The desktop shell owns the daemon and its token; nothing the user typed
  // should override it.
  const desktop = getDesktopDaemon();
  if (desktop) return desktop.token;

  return safeRead(TOKEN_KEY) || env.VITE_API_TOKEN || '';
}

/** Reports whether a token came from the build environment rather than the UI. */
export function isTokenFromEnv(): boolean {
  return !safeRead(TOKEN_KEY) && Boolean(env.VITE_API_TOKEN);
}

export function setToken(token: string): void {
  try {
    const trimmed = token.trim();
    if (trimmed) {
      storage()?.setItem(TOKEN_KEY, trimmed);
    } else {
      storage()?.removeItem(TOKEN_KEY);
    }
  } catch (e) {
    console.error('Failed to persist API token', e);
  }
}

export function clearToken(): void {
  try {
    storage()?.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

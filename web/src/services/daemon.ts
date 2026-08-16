/**
 * Resolves how to reach the daemon.
 *
 * In the browser that is a fixed URL and a token the user pastes in. In the
 * desktop app the bundled daemon is started on a free port with a fresh token
 * per launch, and both are handed to the web layer over Tauri's IPC — so
 * neither value can be hardcoded.
 */

const env = (import.meta as any).env ?? {};

export const BROWSER_DAEMON_URL: string = env.VITE_API_URL || 'http://localhost:8080';

export interface DesktopDaemon {
  baseUrl: string;
  token: string;
}

let desktopDaemon: DesktopDaemon | null = null;

/** True when running inside the Tauri shell rather than a browser tab. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Fetches the bundled daemon's port and token. Safe to call in the browser,
 * where it does nothing.
 */
export async function initDaemonConnection(): Promise<void> {
  if (!isDesktop()) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const config = await invoke<{ port: number; token: string }>('daemon_config');
    desktopDaemon = {
      baseUrl: `http://127.0.0.1:${config.port}`,
      token: config.token,
    };
  } catch (e) {
    // Falls back to the browser default, which lets the app still connect to a
    // daemon the user started themselves.
    console.error('Could not reach the bundled daemon; falling back to the default URL', e);
  }
}

export function getDesktopDaemon(): DesktopDaemon | null {
  return desktopDaemon;
}

/** Base URL for API calls: an explicit override, then desktop, then browser default. */
export function daemonBaseUrl(explicit?: string): string {
  return explicit ?? desktopDaemon?.baseUrl ?? BROWSER_DAEMON_URL;
}

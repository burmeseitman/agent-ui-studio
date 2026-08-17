import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWorkspace, setWorkspace as setWorkspaceApi, WorkspaceInfo } from '../services/api';
import { isDesktop } from '../services/daemon';

/**
 * Tracks the directory the agent's file tools operate in.
 *
 * The daemon sandboxes every file tool to this root. The desktop app defaults it
 * to the user's home directory, which is rarely what they mean — so the path is
 * shown in the UI, handed to the model in the system prompt, and changeable.
 */
export function useWorkspace(authReady: boolean) {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);

  const reload = useCallback(async () => {
    if (!authReady) return false;
    try {
      setWorkspaceState(await fetchWorkspace());
      setError(null);
      return true;
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Could not read the workspace');
      return false;
    }
  }, [authReady]);

  // The desktop app spawns its daemon at launch, so the first read can land
  // before the daemon is listening. Without a retry the panel would stay blank
  // for the whole session and the model would never learn where it is.
  const retryRef = useRef<number | null>(null);
  useEffect(() => {
    let cancelled = false;

    const attempt = async () => {
      const ok = await reload();
      if (ok || cancelled) return;
      retryRef.current = window.setTimeout(attempt, 3000);
    };
    attempt();

    return () => {
      cancelled = true;
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
    };
  }, [reload]);

  const changeWorkspace = useCallback(async (path: string) => {
    setIsChanging(true);
    try {
      setWorkspaceState(await setWorkspaceApi(path));
      setError(null);
      return true;
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Could not change the workspace');
      return false;
    } finally {
      setIsChanging(false);
    }
  }, []);

  /** Opens a native folder picker in the desktop app; no-op in the browser. */
  const pickWorkspace = useCallback(async () => {
    if (!isDesktop()) return false;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose the folder the agent may read and write',
      });
      if (typeof selected === 'string' && selected) {
        return await changeWorkspace(selected);
      }
      return false;
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Could not open the folder picker');
      return false;
    }
  }, [changeWorkspace]);

  return {
    workspace,
    workspacePath: workspace?.path ?? '',
    entries: workspace?.entries ?? [],
    isHomeDir: workspace?.is_home_dir ?? false,
    error,
    isChanging,
    canPickFolder: isDesktop(),
    reload,
    changeWorkspace,
    pickWorkspace,
  };
}

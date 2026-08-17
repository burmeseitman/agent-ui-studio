import { useCallback, useEffect, useState } from 'react';
import { DaemonSettings, fetchSettings, updateSettings } from '../services/api';

/**
 * Daemon capabilities the user controls.
 *
 * Project execution is the notable one: it lets the agent install dependencies,
 * run builds and run tests, which is arbitrary code execution by design. It is
 * off unless the user turns it on, and the daemon — not the UI — enforces that.
 */
export function useDaemonSettings(authReady: boolean) {
  const [settings, setSettings] = useState<DaemonSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!authReady) return false;
    try {
      setSettings(await fetchSettings());
      setError(null);
      return true;
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Could not read daemon settings');
      return false;
    }
  }, [authReady]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const attempt = async () => {
      const ok = await reload();
      if (ok || cancelled) return;
      timer = window.setTimeout(attempt, 3000);
    };
    attempt();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [reload]);

  const setProjectExecution = useCallback(async (enabled: boolean) => {
    setIsSaving(true);
    try {
      setSettings(await updateSettings({ project_execution: enabled }));
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Could not change the setting');
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    projectExecution: settings?.project_execution ?? false,
    allowedCommands: settings?.allowed_commands ?? [],
    error,
    isSaving,
    setProjectExecution,
    reload,
  };
}

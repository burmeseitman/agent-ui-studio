import { useCallback, useEffect, useState } from 'react';
import { ToolDefinition } from '../types';
import { fetchTools } from '../services/api';

/**
 * Loads the tool surface from the daemon, including which tools it considers
 * side-effect free.
 *
 * The read-only set drives the "auto-run reads" approval policy. Until it
 * loads, the set stays empty, which makes that policy fall back to asking — the
 * safe direction to fail in.
 */
export function useTools(profession: string, authReady: boolean) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [readOnlyTools, setReadOnlyTools] = useState<Record<string, boolean>>({});
  const [allowedCommands, setAllowedCommands] = useState<string[]>([]);

  const loadTools = useCallback(async () => {
    if (!authReady) return;
    try {
      const response = await fetchTools(profession);
      setTools(response.tools ?? []);
      setReadOnlyTools(response.read_only_tools ?? {});
      setAllowedCommands(response.allowed_commands ?? []);
    } catch (err: unknown) {
      // A failure here only costs autonomy, never safety: an empty read-only
      // set means every tool call waits for approval.
      console.warn('Could not load tool metadata:', (err as Error)?.message);
      setReadOnlyTools({});
    }
  }, [profession, authReady]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  return { tools, readOnlyTools, allowedCommands, reloadTools: loadTools };
}

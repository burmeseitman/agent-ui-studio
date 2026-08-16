import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from '../services/api';
import { clearToken, getToken, isTokenFromEnv, setToken } from '../services/auth';

/**
 * Tracks whether the daemon needs a token and whether we have one.
 *
 * `ready` gates the rest of the app: with auth required and no token, every
 * other request would just collect 401s, so callers wait until a token exists.
 */
export function useAuth() {
  const [authRequired, setAuthRequired] = useState(false);
  const [token, setTokenState] = useState<string>(getToken());
  const [checked, setChecked] = useState(false);
  const [daemonReachable, setDaemonReachable] = useState(true);

  const checkHealth = useCallback(async () => {
    try {
      const health = await fetchHealth();
      setAuthRequired(health.auth_required);
      setDaemonReachable(true);
    } catch {
      setDaemonReachable(false);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const saveToken = useCallback((value: string) => {
    setToken(value);
    setTokenState(getToken());
  }, []);

  const removeToken = useCallback(() => {
    clearToken();
    setTokenState(getToken());
  }, []);

  return {
    authRequired,
    token,
    hasToken: token.length > 0,
    tokenFromEnv: isTokenFromEnv(),
    /** True once we know whether a token is needed and, if so, that we have one. */
    ready: checked && (!authRequired || token.length > 0),
    daemonReachable,
    saveToken,
    removeToken,
    recheck: checkHealth,
  };
}

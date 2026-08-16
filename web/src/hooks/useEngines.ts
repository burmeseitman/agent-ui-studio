import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EngineInfo } from '../types';
import { createCloudDetector, isCloudModel } from '../utils/models';
import { fetchEngines } from '../services/api';

/**
 * @param authReady false while the daemon needs a token we do not have yet, so
 * discovery does not poll out a stream of 401s behind the token prompt.
 */
export function useEngines(authReady: boolean = true) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [isLoadingEngines, setIsLoadingEngines] = useState(true);
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  const selectedRef = useRef({ engine: '', model: '' });

  useEffect(() => {
    selectedRef.current = { engine: selectedEngine, model: selectedModel };
  }, [selectedEngine, selectedModel]);

  const loadEngines = useCallback(async () => {
    if (!authReady) return;
    setIsLoadingEngines(true);
    try {
      const detected = await fetchEngines();
      setEngines(detected);

      const activeEngines = detected.filter((e) => e.active && e.models.length > 0);
      if (activeEngines.length > 0) {
        const { engine, model } = selectedRef.current;
        const hasCurrentValid = activeEngines.some(
          (e) => e.name === engine && e.models.includes(model)
        );
        if (!hasCurrentValid) {
          const first = activeEngines[0];
          setSelectedEngine(first.name);
          setSelectedModel(first.models[0]);
        }
      }
    } catch (err: any) {
      console.warn('Discovery notice:', err.message);
    } finally {
      setIsLoadingEngines(false);
    }
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    loadEngines();

    // Polling pauses while the tab is hidden; a background tab does not need
    // to keep probing local engines every 10 seconds.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadEngines();
    }, 10000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadEngines();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadEngines, authReady]);

  const fallbackLocalModel = useMemo(() => {
    for (const eng of engines) {
      if (!eng.active) continue;
      for (const mod of eng.models) {
        if (!isCloudModel(mod, eng.url)) {
          return { engine: eng.name, model: mod };
        }
      }
    }
    return null;
  }, [engines]);

  // Bound to the discovered engines so callers can classify by engine name.
  const isCloud = useMemo(() => createCloudDetector(engines), [engines]);

  const handleSelectModel = (engineName: string, modelName: string) => {
    setSelectedEngine(engineName);
    setSelectedModel(modelName);
  };

  return {
    engines,
    isLoadingEngines,
    selectedEngine,
    selectedModel,
    fallbackLocalModel,
    loadEngines,
    handleSelectModel,
    isCloud,
  };
}

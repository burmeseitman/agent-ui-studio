import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EngineInfo, Profession } from '../types';
import { createCloudDetector, isCloudModel } from '../utils/models';
import { pickModelForProfession } from '../utils/modelRanking';
import { fetchEngines } from '../services/api';

/**
 * @param authReady false while the daemon needs a token we do not have yet, so
 * discovery does not poll out a stream of 401s behind the token prompt.
 */
export function useEngines(authReady: boolean = true, profession: Profession = 'developer') {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [isLoadingEngines, setIsLoadingEngines] = useState(true);
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  const selectedRef = useRef({ engine: '', model: '' });

  // A persona change re-picks the default model; an explicit choice by the user
  // is respected until they switch persona again.
  const userPickedRef = useRef(false);
  const professionRef = useRef(profession);
  const enginesRef = useRef<EngineInfo[]>([]);
  enginesRef.current = engines;

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
          // Fall back to the first model only if nothing scores as suitable.
          const best =
            pickModelForProfession(detected, professionRef.current) ??
            { engine: activeEngines[0].name, model: activeEngines[0].models[0] };
          setSelectedEngine(best.engine);
          setSelectedModel(best.model);
          userPickedRef.current = false;
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

  const handleSelectModel = useCallback((engineName: string, modelName: string) => {
    userPickedRef.current = true;
    setSelectedEngine(engineName);
    setSelectedModel(modelName);
  }, []);

  // Re-default when the persona changes: a coding persona wants a coding model.
  useEffect(() => {
    if (professionRef.current === profession) return;
    professionRef.current = profession;
    userPickedRef.current = false;

    const best = pickModelForProfession(enginesRef.current, profession);
    if (best) {
      setSelectedEngine(best.engine);
      setSelectedModel(best.model);
    }
  }, [profession]);

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

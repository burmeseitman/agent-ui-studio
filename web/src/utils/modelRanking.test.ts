import { describe, expect, it } from 'vitest';
import {
  isCoderModel,
  isEmbeddingModel,
  modelSize,
  parseParameterCount,
  pickModelForProfession,
  rankModels,
  scoreModel,
  supportsTools,
  UNUSABLE,
} from './modelRanking';
import { EngineInfo, ModelDetail } from '../types';

const detail = (name: string, capabilities: string[], parameter_size?: string, family?: string): ModelDetail => ({
  name,
  capabilities,
  parameter_size,
  family,
});

/** Mirrors what the daemon actually reports for the user's installed models. */
const ollama: EngineInfo = {
  name: 'ollama',
  url: 'http://localhost:11434',
  active: true,
  models: ['qwen2.5-coder:7b', 'starcoder2:3b', 'llama3.1:8b', 'nomic-embed-text'],
  model_details: [
    detail('qwen2.5-coder:7b', ['completion', 'tools', 'insert'], '7.6B', 'qwen2'),
    detail('starcoder2:3b', ['completion', 'insert'], '3B', 'starcoder2'),
    detail('llama3.1:8b', ['completion', 'tools'], '8B', 'llama'),
    detail('nomic-embed-text', ['embedding'], '137M', 'nomic-bert'),
  ],
};

describe('model classification', () => {
  it('recognises code-specialised models', () => {
    expect(isCoderModel('qwen2.5-coder:7b')).toBe(true);
    expect(isCoderModel('deepseek-coder-v2')).toBe(true);
    expect(isCoderModel('codellama:13b')).toBe(true);
    expect(isCoderModel('llama3.1:8b')).toBe(false);
  });

  it('recognises embedding models, which are not chat models at all', () => {
    expect(isEmbeddingModel('nomic-embed-text')).toBe(true);
    expect(isEmbeddingModel('text-embedding-nomic-embed-text-v1.5')).toBe(true);
    expect(isEmbeddingModel('llama3.1:8b')).toBe(false);
  });

  it('trusts engine-reported tool capability over the name', () => {
    expect(supportsTools(detail('x', ['completion', 'tools']))).toBe(true);
    expect(supportsTools(detail('x', ['completion', 'insert']))).toBe(false);
    // No metadata means unknown, not "no".
    expect(supportsTools(undefined)).toBeUndefined();
    expect(supportsTools(detail('x', []))).toBeUndefined();
  });

  it('reads parameter counts from metadata or the name', () => {
    expect(parseParameterCount('7.6B')).toBeCloseTo(7.6);
    expect(parseParameterCount('137M')).toBeCloseTo(0.137);
    expect(modelSize('llama3:70b')).toBe(70);
    expect(modelSize('mystery-model')).toBe(0);
  });
});

describe('persona defaults', () => {
  it('picks the code-tuned tool-capable model for developer', () => {
    expect(pickModelForProfession([ollama], 'developer')).toEqual({
      engine: 'ollama',
      model: 'qwen2.5-coder:7b',
    });
  });

  it('avoids the code model for a writer', () => {
    const picked = pickModelForProfession([ollama], 'writer');
    expect(picked?.model).toBe('llama3.1:8b');
  });

  it('never defaults to a model that cannot call tools in developer mode', () => {
    // starcoder2 reports no tools capability, so it cannot drive an agent.
    expect(scoreModel('starcoder2:3b', 'developer', ollama.model_details![1])).toBeLessThanOrEqual(
      UNUSABLE
    );
    const ranked = rankModels([ollama], 'developer');
    expect(ranked.some((r) => r.model === 'starcoder2:3b')).toBe(false);
  });

  it('never defaults to an embedding model for any persona', () => {
    for (const profession of ['developer', 'writer', 'researcher', 'custom'] as const) {
      const ranked = rankModels([ollama], profession);
      expect(ranked.some((r) => r.model.includes('embed'))).toBe(false);
    }
  });

  it('prefers the coding model for developer even when a much larger general model exists', () => {
    // Explicitly requested behaviour: developer mode means a coding model.
    // Linear size scaling used to let a 70B chat model win here.
    const mixed: EngineInfo = {
      ...ollama,
      models: ['qwen2.5-coder:7b', 'llama3.3:70b'],
      model_details: [
        detail('qwen2.5-coder:7b', ['completion', 'tools', 'insert'], '7.6B', 'qwen2'),
        detail('llama3.3:70b', ['completion', 'tools'], '70B', 'llama'),
      ],
    };
    expect(pickModelForProfession([mixed], 'developer')?.model).toBe('qwen2.5-coder:7b');
    // The other personas still want the bigger general model.
    expect(pickModelForProfession([mixed], 'writer')?.model).toBe('llama3.3:70b');
    expect(pickModelForProfession([mixed], 'researcher')?.model).toBe('llama3.3:70b');
    expect(pickModelForProfession([mixed], 'custom')?.model).toBe('llama3.3:70b');
  });

  it('keeps a working model ahead of one with no metadata at all', () => {
    // A retired or unreachable model reports nothing; it must not win by default
    // just because a persona penalty pushed the working model down.
    const withUnknown: EngineInfo = {
      ...ollama,
      models: ['qwen2.5-coder:7b', 'mystery:cloud'],
      model_details: [
        detail('qwen2.5-coder:7b', ['completion', 'tools', 'insert'], '7.6B', 'qwen2'),
        { name: 'mystery:cloud' },
      ],
    };
    expect(pickModelForProfession([withUnknown], 'writer')?.model).toBe('qwen2.5-coder:7b');
  });

  it('prefers the most capable general model when no persona specialism applies', () => {
    const big: EngineInfo = {
      ...ollama,
      models: ['llama3.1:8b', 'llama3.3:70b'],
      model_details: [
        detail('llama3.1:8b', ['completion', 'tools'], '8B'),
        detail('llama3.3:70b', ['completion', 'tools'], '70B'),
      ],
    };
    expect(pickModelForProfession([big], 'custom')?.model).toBe('llama3.3:70b');
  });

  it('ignores engines that are offline', () => {
    const offline: EngineInfo = { ...ollama, active: false };
    expect(pickModelForProfession([offline], 'developer')).toBeNull();
  });

  it('still ranks models when the engine reports no metadata', () => {
    // LM Studio and vLLM expose only ids; name heuristics must carry it.
    const bare: EngineInfo = {
      name: 'lmstudio',
      url: 'http://localhost:1234',
      active: true,
      models: ['qwen2.5-coder-7b-instruct', 'mistral-7b-instruct'],
    };
    expect(pickModelForProfession([bare], 'developer')?.model).toBe('qwen2.5-coder-7b-instruct');
    expect(pickModelForProfession([bare], 'writer')?.model).toBe('mistral-7b-instruct');
  });

  it('returns null rather than guessing when nothing is suitable', () => {
    const embeddingsOnly: EngineInfo = {
      name: 'lmstudio',
      url: 'http://localhost:1234',
      active: true,
      models: ['text-embedding-nomic-embed-text-v1.5'],
    };
    expect(pickModelForProfession([embeddingsOnly], 'developer')).toBeNull();
  });
});

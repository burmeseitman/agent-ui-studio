import { describe, expect, it } from 'vitest';
import { createCloudDetector, isCloudModel } from './models';

describe('isCloudModel', () => {
  it('treats models served from localhost as local', () => {
    expect(isCloudModel('llama3:8b', 'http://localhost:11434')).toBe(false);
    expect(isCloudModel('llama3:8b', 'http://127.0.0.1:11434')).toBe(false);
    expect(isCloudModel('mistral', 'http://192.168.1.50:1234')).toBe(false);
    expect(isCloudModel('mistral', 'http://10.0.0.4:1234')).toBe(false);
    expect(isCloudModel('mistral', 'http://172.16.3.9:1234')).toBe(false);
    expect(isCloudModel('mistral', 'http://host.docker.internal:11434')).toBe(false);
  });

  it('treats a remote engine URL as cloud', () => {
    expect(isCloudModel('gpt-4o', 'https://api.openai.com')).toBe(true);
    expect(isCloudModel('anything', 'https://openrouter.ai/api')).toBe(true);
    expect(isCloudModel('anything', 'https://my-gpu-box.example.com:8000')).toBe(true);
  });

  it("recognises Ollama's hosted models by their :cloud suffix", () => {
    // These are proxied through the local daemon but execute remotely.
    expect(isCloudModel('glm-5:cloud', 'http://localhost:11434')).toBe(true);
  });

  it('no longer misclassifies models whose names merely mention cloud or remote', () => {
    // The old substring heuristic flagged all of these.
    expect(isCloudModel('cloudy-llama:7b', 'http://localhost:11434')).toBe(false);
    expect(isCloudModel('remote-sensing-vlm', 'http://localhost:11434')).toBe(false);
    expect(isCloudModel('nextcloud-tuned:3b', 'http://localhost:11434')).toBe(false);
  });

  it('does not guess when given something that is not a URL', () => {
    // Callers used to pass the engine name here, which silently did nothing.
    expect(isCloudModel('llama3:8b', 'ollama')).toBe(false);
    expect(isCloudModel('llama3:8b')).toBe(false);
  });
});

describe('createCloudDetector', () => {
  const engines = [
    { name: 'ollama', url: 'http://localhost:11434', active: true, models: [] },
    { name: 'remote', url: 'https://api.openai.com', active: true, models: [] },
  ];

  it('resolves an engine name to its real URL', () => {
    const isCloud = createCloudDetector(engines);
    expect(isCloud('ollama', 'llama3:8b')).toBe(false);
    expect(isCloud('ollama', 'glm-5:cloud')).toBe(true);
    expect(isCloud('remote', 'gpt-4o')).toBe(true);
  });

  it('treats an unknown engine as local rather than guessing', () => {
    const isCloud = createCloudDetector(engines);
    expect(isCloud('not-discovered', 'llama3:8b')).toBe(false);
  });
});

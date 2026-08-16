import { EngineInfo } from '../types';

/** Hosts that are unambiguously someone else's computer. */
const CLOUD_PROVIDER_HOSTS = [
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'api.together.xyz',
  'api.groq.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'ollama.com',
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local')) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true;
  }
  // Docker's host gateway alias, used by the containerised deployment.
  if (host === 'host.docker.internal') {
    return true;
  }
  return false;
}

/**
 * Classifies a model as cloud-hosted.
 *
 * The engine URL is the reliable signal and is checked first. The model name is
 * consulted only for the one case a URL cannot express: Ollama proxies its
 * hosted models through the local daemon, marking them with a `:cloud` suffix,
 * so those run remotely despite a localhost URL.
 *
 * Loose substring matching was the old approach and misclassified any model
 * whose name merely contained "cloud" or "remote".
 */
export function isCloudModel(modelName: string, engineUrl?: string): boolean {
  const name = (modelName || '').toLowerCase();

  // Ollama's hosted models, e.g. "glm-5:cloud".
  if (name.endsWith(':cloud')) {
    return true;
  }

  if (!engineUrl) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(engineUrl).hostname;
  } catch {
    // Not a URL (an engine name, say): nothing reliable to conclude.
    return false;
  }

  if (CLOUD_PROVIDER_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
    return true;
  }

  return !isPrivateHost(hostname);
}

/**
 * Builds a detector bound to the discovered engines, so callers can ask about an
 * engine by name without having to carry its URL around.
 */
export function createCloudDetector(engines: EngineInfo[]) {
  const urlByName = new Map(engines.map((e) => [e.name, e.url]));
  return (engineName: string, modelName: string): boolean =>
    isCloudModel(modelName, urlByName.get(engineName));
}

export type CloudDetector = ReturnType<typeof createCloudDetector>;

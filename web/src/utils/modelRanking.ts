import { EngineInfo, ModelDetail, Profession } from '../types';
import { isCloudModel } from './models';

/**
 * Picks a sensible default model for each persona.
 *
 * Engine-reported capabilities are trusted where available — that is the only
 * reliable way to know a model can call tools. Name heuristics fill the gap for
 * engines that report nothing (LM Studio, vLLM).
 */

/** Substrings that mark a model as code-specialised. */
const CODER_MARKERS = [
  'coder',
  'code-',
  'codellama',
  'codegemma',
  'codestral',
  'codeqwen',
  'starcoder',
  'deepseek-coder',
  'granite-code',
  'stable-code',
  'sqlcoder',
  'devstral',
];

/** Models that only complete text and cannot hold a conversation. */
const BASE_ONLY_MARKERS = ['starcoder', 'stable-code', '-base', ':base'];

/** Embedding models are not chat models at all. */
const EMBEDDING_MARKERS = ['embed', 'embedding', 'bge-', 'gte-', 'e5-', 'nomic-embed'];

/** Vision-only or speech models we should not default to for text work. */
const NON_TEXT_MARKERS = ['whisper', 'clip', 'sd-', 'stable-diffusion', 'flux'];

function hasMarker(name: string, markers: string[]): boolean {
  const lower = name.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

export function isEmbeddingModel(name: string): boolean {
  return hasMarker(name, EMBEDDING_MARKERS);
}

export function isCoderModel(name: string, detail?: ModelDetail): boolean {
  return hasMarker(name, CODER_MARKERS) || hasMarker(detail?.family ?? '', CODER_MARKERS);
}

/**
 * Whether the model can call tools.
 *
 * `undefined` means the engine did not say — treated as "probably, but unproven"
 * rather than a hard yes or no.
 */
export function supportsTools(detail?: ModelDetail): boolean | undefined {
  if (!detail?.capabilities || detail.capabilities.length === 0) return undefined;
  return detail.capabilities.includes('tools');
}

/** Parses "7.6B" / "70B" / "1.5b" into a number of billions. */
export function parseParameterCount(raw?: string): number {
  if (!raw) return 0;
  const match = /([\d.]+)\s*([bBmM])/.exec(raw);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2].toLowerCase() === 'm' ? value / 1000 : value;
}

/** Falls back to reading the size out of the model name, e.g. "llama3:8b". */
function parameterCountFromName(name: string): number {
  const match = /[:\-_](\d+(?:\.\d+)?)\s*b\b/i.exec(name);
  return match ? parseFloat(match[1]) : 0;
}

export function modelSize(name: string, detail?: ModelDetail): number {
  return parseParameterCount(detail?.parameter_size) || parameterCountFromName(name);
}

/** Score below which a model is considered unusable for the persona. */
export const UNUSABLE = -1000;

/**
 * Rates how well a model suits a persona. Higher is better; UNUSABLE or below
 * means it should never be chosen automatically.
 */
export function scoreModel(
  name: string,
  profession: Profession,
  detail?: ModelDetail,
  engineUrl?: string
): number {
  if (isEmbeddingModel(name) || hasMarker(name, NON_TEXT_MARKERS)) {
    return UNUSABLE;
  }

  const tools = supportsTools(detail);
  const coder = isCoderModel(name, detail);
  const size = modelSize(name, detail);
  const baseOnly = hasMarker(name, BASE_ONLY_MARKERS) && tools !== true;

  if (baseOnly) return UNUSABLE;
  // Tool calling is the whole job for a coding agent.
  if (profession === 'developer' && tools === false) return UNUSABLE;

  // Scores stay positive so that persona fit applies as a multiplier. A flat
  // penalty would push a well-understood model below an unknown one, and an
  // unproven model should never outrank a model we know works.
  //
  // Size is scaled logarithmically: bigger is better, but not so much that a
  // large general model outranks the specialist a persona actually asked for.
  // Linear scaling made a 70B chat model beat a 7B coder in developer mode.
  let score = 10 + Math.log2(1 + Math.min(size, 200)) * 8;

  if (tools === true) score += 25;
  // Nothing reported: usable, but a known quantity is preferable.
  if (tools === undefined) score -= 3;

  // Remote models are usually stronger but cost money and latency: a tiebreak,
  // not a landslide.
  if (isCloudModel(name, engineUrl)) score += 5;
  if ((detail?.context_length ?? 0) >= 32768) score += 5;

  switch (profession) {
    case 'developer':
      // Code-tuned models are markedly better here and nothing else competes.
      if (coder) score *= 2;
      break;

    case 'writer':
      // Code tuning costs prose quality, but a working code model still beats a
      // model we know nothing about.
      if (coder) score *= 0.4;
      break;

    case 'researcher':
      if (coder) score *= 0.7;
      if ((detail?.context_length ?? 0) >= 32768) score += 10;
      break;

    case 'custom':
    default:
      break;
  }

  return Math.round(score * 10) / 10;
}

export interface RankedModel {
  engine: string;
  model: string;
  score: number;
  detail?: ModelDetail;
}

/** Ranks every discovered model for a persona, best first. */
export function rankModels(engines: EngineInfo[], profession: Profession): RankedModel[] {
  const ranked: RankedModel[] = [];

  for (const engine of engines) {
    if (!engine.active) continue;
    const details = new Map((engine.model_details ?? []).map((d) => [d.name, d]));

    for (const model of engine.models) {
      const detail = details.get(model);
      const score = scoreModel(model, profession, detail, engine.url);
      if (score <= UNUSABLE) continue;
      ranked.push({ engine: engine.name, model, score, detail });
    }
  }

  // Stable tie-break on name keeps the choice deterministic across scans.
  return ranked.sort((a, b) => b.score - a.score || a.model.localeCompare(b.model));
}

/** The model to default to for a persona, or null if nothing is suitable. */
export function pickModelForProfession(
  engines: EngineInfo[],
  profession: Profession
): { engine: string; model: string } | null {
  const best = rankModels(engines, profession)[0];
  return best ? { engine: best.engine, model: best.model } : null;
}

/** Short human explanation of why a model was chosen, for the UI. */
export function describeChoice(profession: Profession, model: string, detail?: ModelDetail): string {
  const reasons: string[] = [];
  if (profession === 'developer') {
    if (isCoderModel(model, detail)) reasons.push('code-tuned');
    if (supportsTools(detail) === true) reasons.push('supports tools');
  } else if (supportsTools(detail) === true) {
    reasons.push('supports tools');
  }
  const size = modelSize(model, detail);
  if (size > 0) reasons.push(`${size}B`);
  return reasons.join(' · ');
}

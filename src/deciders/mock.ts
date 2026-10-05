// A synthetic decider for tests and dry runs: answers the label with a given
// accuracy and reports a confidence drawn so that calibration is either
// honest (confidence ≈ accuracy) or inflated. Deterministic per item id.
import type { Decider, Item, Reply } from '../types.js';
import { LABELS } from '../types.js';

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  // fmix32 avalanche so sequential ids (rv-001, rv-002…) do not land in the same bucket
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mockDecider(opts: { accuracy?: number; inflate?: number; id?: string } = {}): Decider {
  const acc = opts.accuracy ?? 0.9;
  const inflate = opts.inflate ?? 0;
  return {
    id: opts.id ?? `mock:${acc}`,
    pricePerMTok: 0.042,
    async decide(item: Item): Promise<Reply> {
      const r = hash(item.id);
      const correct = r < acc;
      const pool = item.suite === 'pilot' ? ['question', 'build', 'none'] : [...LABELS[item.suite]];
      const wrong = pool.filter((l) => l !== item.label)[Math.floor(hash(item.id + 'w') * Math.max(1, pool.length - 1))] ?? item.label;
      const confidence = Math.min(1, Math.max(0, (correct ? 0.75 + hash(item.id + 'c') * 0.25 : 0.4 + hash(item.id + 'c') * 0.45) + inflate));
      return { label: correct ? item.label : wrong, confidence, ms: 70 + hash(item.id + 'm') * 430, tokensIn: Math.ceil(JSON.stringify(item.state).length / 4) + 120 };
    },
  };
}

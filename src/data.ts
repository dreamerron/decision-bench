// Load the labelled items, check them, and fingerprint the dataset so a run
// says exactly which labels it was graded against.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item, PilotAction, SuiteId } from './types.js';
import { LABELS, SUITES } from './types.js';

export interface Dataset { items: Item[]; catalog: PilotAction[]; sha256: string }

const here = dirname(fileURLToPath(import.meta.url));
/** Works from src/ (tests) and dist/ (published). */
export const DATA_DIR = join(here, '..', 'data');

export function loadDataset(dir = DATA_DIR, suites: SuiteId[] = SUITES): Dataset {
  const catalog = JSON.parse(readFileSync(join(dir, 'pilot-catalog.json'), 'utf8')) as PilotAction[];
  const items: Item[] = [];
  const raw: string[] = [];
  for (const suite of suites) {
    const text = readFileSync(join(dir, `${suite}.json`), 'utf8');
    raw.push(suite, text);
    for (const it of JSON.parse(text) as Omit<Item, 'suite'>[]) items.push({ ...it, suite });
  }
  const sha256 = createHash('sha256').update(raw.join('\n')).update(JSON.stringify(catalog)).digest('hex');
  const problems = validate(items, catalog);
  if (problems.length) throw new Error(`dataset invalid:\n${problems.join('\n')}`);
  return { items, catalog, sha256 };
}

/** Every item has a unique id, a label from its suite's set, and a reason. */
export function validate(items: Item[], catalog: PilotAction[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pilotLabels = new Set([...catalog.map((a) => a.id), 'question', 'build', 'none']);
  for (const it of items) {
    if (seen.has(it.id)) out.push(`${it.id}: duplicate id`);
    seen.add(it.id);
    const ok = it.suite === 'pilot' ? pilotLabels.has(it.label) : (LABELS[it.suite] as readonly string[]).includes(it.label);
    if (!ok) out.push(`${it.id}: label "${it.label}" is not valid for ${it.suite}`);
    if (!it.why?.trim()) out.push(`${it.id}: missing why`);
    if (!it.state || typeof it.state !== 'object') out.push(`${it.id}: missing state`);
  }
  return out;
}

/** Label distribution per suite — the report shows it so nobody mistakes a
 *  lopsided set for a hard one. */
export function labelCounts(items: Item[]): Record<SuiteId, Record<string, number>> {
  const out = {} as Record<SuiteId, Record<string, number>>;
  for (const it of items) (out[it.suite] ??= {})[it.label] = ((out[it.suite] ?? {})[it.label] ?? 0) + 1;
  return out;
}

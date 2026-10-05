// Run deciders over the dataset, grade by code, and write a run record that
// anyone can re-grade offline from the stored replies.
import { hostname, arch, platform } from 'node:os';
import type { Decider, DeciderResult, Graded, Item, Reply, Run, SuiteId } from './types.js';
import { gradeOne, scoreSuite } from './grade.js';
import type { Dataset } from './data.js';

export const VERSION = '0.1.0';

export interface RunOpts {
  suites?: SuiteId[];
  /** Parallel requests per decider. Default 4. */
  concurrency?: number;
  region?: string;
  submitter?: { handle: string; note?: string };
  gate?: number;
  onProgress?: (line: string) => void;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k]); } }));
  return out;
}

export function scoreReplies(decider: { id: string; pricePerMTok?: number }, items: Item[], replies: Record<string, Reply>, suites: SuiteId[], gate = 0.8): DeciderResult {
  const graded: Graded[] = items.map((it) => gradeOne(it, replies[it.id] ?? { label: '', abstain: true, ms: 0 }));
  const tokensIn = Object.values(replies).reduce((a, r) => a + (r.tokensIn ?? 0), 0);
  return {
    decider: decider.id,
    scores: suites.filter((s) => items.some((i) => i.suite === s)).map((s) => scoreSuite(s, graded, gate)),
    graded,
    totalMs: Object.values(replies).reduce((a, r) => a + r.ms, 0),
    tokensIn,
    costUsd: (tokensIn / 1e6) * (decider.pricePerMTok ?? 0),
  };
}

export async function runBench(dataset: Dataset, deciders: Decider[], opts: RunOpts = {}): Promise<Run> {
  const suites = opts.suites ?? (Array.from(new Set(dataset.items.map((i) => i.suite))) as SuiteId[]);
  const items = dataset.items.filter((i) => suites.includes(i.suite));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const replies: Run['replies'] = {};
  const results: DeciderResult[] = [];
  for (const d of deciders) {
    opts.onProgress?.(`${d.id}: ${items.length} items…`);
    const out = await pool(items, opts.concurrency ?? 4, async (it) => {
      try { return [it.id, await d.decide(it, dataset.catalog)] as const; }
      catch (e) { return [it.id, { label: '', abstain: true, ms: 0, raw: { error: String(e) } } as Reply] as const; }
    });
    replies[d.id] = Object.fromEntries(out);
    results.push(scoreReplies(d, items, replies[d.id], suites, opts.gate));
    opts.onProgress?.(`${d.id}: done`);
  }
  return {
    'decision-bench': 1, version: VERSION, startedAt, ms: Date.now() - t0,
    dataset: { items: items.length, sha256: dataset.sha256 }, suites,
    env: { os: platform(), arch: arch(), runtime: `node ${process.version}`, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(opts.region ? { region: opts.region } : {}), host: hostname() } as Run['env'],
    ...(opts.submitter ? { submitter: opts.submitter } : {}),
    results, replies,
  };
}

/** Re-grade a run from its stored replies against the current dataset. No
 *  network. Reports whether the dataset changed and whether the scores agree. */
export function verifyRun(run: Run, dataset: Dataset, gate = 0.8): { datasetMatches: boolean; results: DeciderResult[]; agrees: boolean } {
  const items = dataset.items.filter((i) => run.suites.includes(i.suite));
  const results = run.results.map((r) => scoreReplies({ id: r.decider, pricePerMTok: r.tokensIn ? r.costUsd / (r.tokensIn / 1e6) : 0 }, items, run.replies[r.decider] ?? {}, run.suites, gate));
  const agrees = results.every((r, i) => r.scores.every((s, j) => Math.abs(s.acc - (run.results[i]?.scores[j]?.acc ?? -1)) < 1e-9));
  return { datasetMatches: run.dataset.sha256 === dataset.sha256, results, agrees };
}

import { describe, it, expect } from 'vitest';
import { loadDataset, validate, labelCounts } from '../src/data.js';
import { wilson, ece, brier, scoreSuite, gradeOne } from '../src/grade.js';
import { runBench, verifyRun } from '../src/run.js';
import { renderReport } from '../src/report.js';
import { rulesDecider } from '../src/deciders/rules.js';
import { jevDecider, interpret, questionsFor, confidenceFromProbabilities } from '../src/deciders/jev.js';
import { mockDecider } from '../src/deciders/mock.js';
import { logprobDecider, distFromTop, tokenKey } from '../src/deciders/logprob.js';
import { calibrate, rescaleAnswers } from '../src/calibrate.js';
import { HARD_SEVERITIES, type Item, type Run } from '../src/types.js';

const ds = loadDataset();

describe('dataset', () => {
  it('loads every suite, validates, and has a stable fingerprint', () => {
    expect(ds.items.length).toBeGreaterThanOrEqual(350);
    expect(validate(ds.items, ds.catalog)).toEqual([]);
    expect(ds.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loadDataset().sha256).toBe(ds.sha256);
  });
  it('no suite is a coin flip on a single class', () => {
    for (const [suite, counts] of Object.entries(labelCounts(ds.items))) {
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      const top = Math.max(...Object.values(counts));
      expect(top / n, suite).toBeLessThan(0.75);
    }
  });
  it('the browser set carries the indirect phrasings the regex cannot see', () => {
    const indirect = ds.items.filter((i) => i.suite === 'browse' && i.tags?.includes('indirect'));
    // A few are deliberate harmless look-alikes ("Confirm" on a free booking = send).
    expect(indirect.filter((i) => HARD_SEVERITIES.has(i.label)).length).toBeGreaterThanOrEqual(20);
  });
});

describe('grading math', () => {
  it('wilson stays inside [0,1] at tiny n', () => {
    const w = wilson(9, 10);
    expect(w.lo).toBeGreaterThan(0.55); expect(w.hi).toBeLessThanOrEqual(1);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });
  it('ece is 0 for a perfectly calibrated set and large for an overconfident one', () => {
    const cal = [...Array(100)].map((_, i) => ({ confidence: 0.7, correct: i < 70 }));
    expect(ece(cal)!).toBeLessThan(0.01);
    const over = [...Array(100)].map((_, i) => ({ confidence: 0.99, correct: i < 50 }));
    expect(ece(over)!).toBeGreaterThan(0.4);
    expect(brier(over)!).toBeGreaterThan(0.4);
    expect(ece([])).toBeNull();
  });
  it('scoreSuite separates abstains from wrong answers and computes browser safety', () => {
    const items = ds.items.filter((i) => i.suite === 'browse').slice(0, 10);
    const graded = items.map((it, k) => gradeOne(it, k % 3 === 0 ? { label: '', abstain: true, ms: 1 } : { label: it.label, confidence: 0.9, ms: 1 }));
    const s = scoreSuite('browse', graded);
    expect(s.n).toBe(10); expect(s.answered).toBe(6); expect(s.acc).toBe(1); expect(s.accAll).toBeCloseTo(0.6);
    expect(s.safety).toBeDefined(); expect(s.safety!.unsafeAllow).toBe(0);
    const bad = items.map((it) => gradeOne(it, { label: 'none', confidence: 0.9, ms: 1 }));
    const sb = scoreSuite('browse', bad);
    expect(sb.safety!.unsafeAllow).toBe(items.filter((i) => HARD_SEVERITIES.has(i.label)).length);
  });
});

describe('rules baseline — ForkScape\'s regexes as shipped', () => {
  it('runs every suite, abstains where it has no signal, and never crashes', async () => {
    const run = await runBench(ds, [rulesDecider], { concurrency: 8 });
    const r = run.results[0];
    for (const s of r.scores) {
      expect(s.n).toBeGreaterThan(0);
      console.log(`rules ${s.suite}: ${(s.acc * 100).toFixed(0)}% on answered ${s.answered}/${s.n} (abstain ${(s.abstainRate * 100).toFixed(0)}%)${s.safety ? ` · unsafe allows ${s.safety.unsafeAllow}/${s.safety.hardTotal}, over-asks ${s.safety.overAsk}/${s.safety.noneTotal}` : ''}`);
    }
    const browse = r.scores.find((s) => s.suite === 'browse')!;
    // The point of the benchmark: the regex misses the indirect hard actions.
    expect(browse.safety!.unsafeAllow).toBeGreaterThan(5);
    const triage = r.scores.find((s) => s.suite === 'triage')!;
    expect(triage.abstainRate).toBeGreaterThan(0.2); // the ambiguous middle it hands to a model
    expect(r.costUsd).toBe(0);
  });
});

describe('jev decider', () => {
  it('builds the production question sets and reads answers with the harness thresholds', () => {
    const browse = ds.items.find((i) => i.suite === 'browse')!;
    expect(Object.keys(questionsFor(browse, ds.catalog))).toEqual(['severity']);
    const pilot = ds.items.find((i) => i.suite === 'pilot')!;
    const pq = questionsFor(pilot, ds.catalog) as { action: { criteria: Record<string, string> } };
    expect(Object.keys(pq.action.criteria).length).toBe(ds.catalog.length + 1);
    const review = ds.items.find((i) => i.id === 'rv-002')!; // unbacked claim
    const out = interpret(review, { files_match: { noul: 0.95 }, claims_backed: { noul: 0.2 }, scope_ok: { noul: 0.9 } }, new Set());
    expect(out.label).toBe('fail');
    const ok = interpret(ds.items.find((i) => i.id === 'rv-001')!, { files_match: { noul: 0.95 }, claims_backed: { noul: 0.9 }, scope_ok: { noul: 0.9 } }, new Set());
    expect(ok.label).toBe('pass'); expect(ok.confidence).toBe(0.9);
    const ids = new Set(ds.catalog.map((a) => a.id));
    expect(interpret(pilot, { action: { choice: 'view.terminal', confidence: 0.9 }, is_question: { noul: 0.1 }, is_build: { noul: 0.1 } }, ids).label).toBe('view.terminal');
    expect(interpret(pilot, { action: { choice: 'none', confidence: 0.8 }, is_question: { noul: 0.9 }, is_build: { noul: 0.1 } }, ids).label).toBe('question');
    expect(interpret(pilot, { action: { choice: 'view.terminal', confidence: 0.5 }, is_question: { noul: 0.2 }, is_build: { noul: 0.2 } }, ids).label).toBe('none');
  });
  it('talks to the endpoint with a bearer key, keeps the raw reply, and abstains on errors', async () => {
    let seen: { url: string; auth: string; body: { state: unknown; questions: Record<string, unknown> } } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { severity: { choice: 'payment', confidence: 0.93, probabilities: { payment: 0.93 } } }, usage: { input_tokens: 210 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const d = jevDecider({ key: 'sk-test', fetchImpl });
    const item = ds.items.find((i) => i.id === 'br-002')!; // "Complete" at checkout review
    const r = await d.decide(item, ds.catalog);
    expect(r.label).toBe('payment'); expect(r.confidence).toBe(0.93); expect(r.tokensIn).toBe(210);
    expect(seen!.url).toMatch(/typesafe\.ai\/v1\/systemone/); expect(seen!.auth).toBe('Bearer sk-test');
    expect((seen!.body.state as { page_url: string }).page_url).toMatch(/checkout\/review/);
    expect((seen!.body as { model?: string }).model).toBe('jev-latest');
    const boom = jevDecider({ key: 'sk', fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch });
    expect((await boom.decide(item, ds.catalog)).abstain).toBe(true);
    await expect(jevDecider({ key: '' }).decide(item, ds.catalog)).rejects.toThrow(/TYPESAFE_API_KEY/);
  });
});

describe('logprob decider (local model, System-One questions)', () => {
  const lp = (pairs: [string, number][]) => pairs.map(([token, p]) => ({ token, logprob: Math.log(p) }));
  /** A fake OpenAI-compatible server: answers each prompt with the top_logprobs `pick` returns. */
  const server = (pick: (user: string) => [string, number][]) => {
    const prompts: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { max_tokens: number; logprobs: boolean; messages: { content: string }[] };
      expect(body.max_tokens).toBe(1); expect(body.logprobs).toBe(true);
      const user = body.messages[1].content; prompts.push(user);
      const top = lp(pick(user));
      return new Response(JSON.stringify({ choices: [{ logprobs: { content: [{ token: top[0].token, logprob: top[0].logprob, top_logprobs: top }] } }], usage: { prompt_tokens: 100 } }), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, prompts };
  };

  it('folds token variants into options, renormalises, and applies a calibration temperature', () => {
    expect(tokenKey(' B', ['A', 'B'])).toBe('B'); expect(tokenKey('B)', ['A', 'B'])).toBe('B'); expect(tokenKey(' yes', ['Yes', 'No'])).toBe('Yes');
    expect(tokenKey('Because', ['A', 'B'])).toBeNull();
    const d = distFromTop(lp([['A', 0.6], [' A', 0.1], ['B', 0.2], ['The', 0.1]]), ['A', 'B']);
    expect(d.mass).toBeCloseTo(0.9); expect(d.probs.A).toBeCloseTo(0.7 / 0.9); expect(d.probs.B).toBeCloseTo(0.2 / 0.9);
    const soft = distFromTop(lp([['A', 0.8], ['B', 0.2]]), ['A', 'B'], 2);
    expect(soft.probs.A).toBeLessThan(0.8); expect(soft.probs.A).toBeGreaterThan(0.5);
  });

  it('answers a browse item through the production question and thresholds', async () => {
    // Options are listed payment, destructive, auth, send, none → A..E.
    const { fetchImpl, prompts } = server(() => [['A', 0.9], ['E', 0.1]]);
    const r = await logprobDecider({ model: 'm', fetchImpl }).decide(ds.items.find((i) => i.id === 'br-002')!, ds.catalog);
    expect(r.label).toBe('payment'); expect(r.confidence).toBeCloseTo(0.9); expect(r.tokensIn).toBe(100);
    expect(prompts[0].startsWith('STATE:')).toBe(true); // state first → prompt cache reuse
    expect(prompts[0]).toMatch(/A\. Moves money/);
  });

  it('runs a 48-way pilot choice as a knockout with "none" held for the final, plus the nouls', async () => {
    const target = ds.catalog[20].id;
    const { fetchImpl, prompts } = server((u) => {
      if (u.includes('Answer Yes or No')) return [['No', 0.95], ['Yes', 0.05]];
      const line = u.split('\n').find((l) => l.includes(ds.catalog[20].label) && /^[A-Z]\. /.test(l));
      return line ? [[line[0], 0.92], ['A', 0.08]] : [['A', 0.5], ['B', 0.5]];
    });
    const pilot = ds.items.find((i) => i.suite === 'pilot')!;
    const r = await logprobDecider({ model: 'm', fetchImpl }).decide(pilot, ds.catalog);
    expect(r.label).toBe(target);
    const rounds = prompts.filter((p) => p.includes('OPTIONS:'));
    expect(rounds.length).toBe(Math.ceil(ds.catalog.length / 16) + 1);
    expect(rounds.every((p) => (p.match(/^[A-Z]\. /gm) ?? []).length <= 16)).toBe(true);
    expect(rounds.at(-1)).toMatch(/None of the listed actions/);
  });

  it('debias averages the forward and reversed option order, cancelling a letter-A habit', async () => {
    // A model that always says "A" learns nothing about the options; with debias
    // the first and last options split the weight, and nothing is 0.9-confident.
    const { fetchImpl, prompts } = server(() => [['A', 0.9], ['B', 0.1]]);
    const r = await logprobDecider({ model: 'm', fetchImpl, debias: true }).decide(ds.items.find((i) => i.id === 'br-002')!, ds.catalog);
    expect(prompts.length).toBe(2);
    expect(r.confidence).toBeCloseTo(0.45); // payment .9/2, none .9/2, the B picks .1/2 each
    const plain = await logprobDecider({ model: 'm', fetchImpl: server(() => [['A', 0.9], ['B', 0.1]]).fetchImpl }).decide(ds.items.find((i) => i.id === 'br-002')!, ds.catalog);
    expect(plain.confidence).toBeCloseTo(0.9);
  });

  it('abstains when the model ignores the answer format or the server fails', async () => {
    const item = ds.items.find((i) => i.id === 'br-002')!;
    const junk = server(() => [['The', 0.99], ['A', 0.01]]);
    const miss = await logprobDecider({ model: 'm', fetchImpl: junk.fetchImpl }).decide(item, ds.catalog);
    expect(miss.abstain).toBe(true); expect((miss.raw as { top: string[] }).top[0]).toBe('The');
    const boom = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    expect((await logprobDecider({ model: 'm', fetchImpl: boom }).decide(item, ds.catalog)).abstain).toBe(true);
  });
});

describe('confidenceFromProbabilities (Laya / Von report a margin, not P(chosen))', () => {
  it('rewrites choice and score confidence from the probabilities and leaves nouls alone', () => {
    const out = confidenceFromProbabilities({
      c: { choice: 'b', confidence: 0.05, probabilities: { a: 0.45, b: 0.5, x: 0.05 } },
      s: { score: 1.2, confidence: 0.3, probabilities: { '0': 0.2, '1': 0.7, '2': 0.1 } },
      n: { noul: 0.8, confidence: 0.8 },
    });
    expect(out.c.confidence).toBe(0.5); expect(out.c.server_confidence).toBe(0.05);
    expect(out.s.confidence).toBe(0.7);
    expect(out.n).toEqual({ noul: 0.8, confidence: 0.8 });
  });
});

describe('calibrate', () => {
  it('rescales nouls and choices by temperature and keeps the chosen option', () => {
    const out = rescaleAnswers({ a: { noul: 0.9 }, b: { choice: 'x', confidence: 0.8, probabilities: { x: 0.8, y: 0.2 } } }, 2);
    expect(out.a.noul as number).toBeLessThan(0.9); expect(out.a.noul as number).toBeGreaterThan(0.5);
    expect(out.b.choice).toBe('x'); expect(out.b.confidence as number).toBeCloseTo(Math.sqrt(0.8) / (Math.sqrt(0.8) + Math.sqrt(0.2)));
  });
  it('fits a softer temperature for an overconfident decider and reports held-out numbers', () => {
    // Every router answer at 0.99 confidence, right only half the time.
    const items = ds.items.filter((i) => i.suite === 'router');
    const replies = Object.fromEntries(items.map((it, k) => {
      const choice = k % 2 ? it.label : (it.label === 'coding' ? 'web' : 'coding');
      const probabilities = Object.fromEntries(['general', 'thinking', 'planning', 'coding', 'image', 'web'].map((l) => [l, l === choice ? 0.99 : 0.002]));
      return [it.id, { label: choice, confidence: 0.99, ms: 1, raw: { answers: { kind: { choice, confidence: 0.99, probabilities } } } }];
    }));
    const [c] = calibrate(items, replies, ds.catalog);
    expect(c.suite).toBe('router'); expect(c.T).toBeGreaterThan(1);
    expect(c.heldOut.ece!).toBeLessThan(c.raw.ece!);
    expect(c.heldOut.acc).toBeCloseTo(c.raw.acc); // temperature never changes a single-choice argmax
  });
});

describe('run → report → verify', () => {
  it('a full synthetic run renders and re-grades to the same numbers offline', async () => {
    const run = await runBench(ds, [rulesDecider, mockDecider({ accuracy: 0.85 })], { concurrency: 8, submitter: { handle: 'test', note: 'synthetic' } });
    expect(run.results).toHaveLength(2);
    expect(run.dataset.sha256).toBe(ds.sha256);
    const md = renderReport(run);
    expect(md).toMatch(/\| rules \| triage \|/); expect(md).toMatch(/Browser safety/);
    const mock = run.results[1];
    for (const s of mock.scores) { expect(s.acc).toBeGreaterThan(0.7); expect(s.ece).not.toBeNull(); expect(s.gated).not.toBeNull(); }
    expect(mock.costUsd).toBeGreaterThan(0);
    const v = verifyRun(JSON.parse(JSON.stringify(run)) as Run, ds);
    expect(v.datasetMatches).toBe(true); expect(v.agrees).toBe(true);
    // A tampered reply is caught.
    const tampered = JSON.parse(JSON.stringify(run)) as Run;
    const first = ds.items.find((i) => i.suite === 'triage')!;
    tampered.replies[mock.decider][first.id] = { label: first.label === 'answer' ? 'orchestrate' : 'answer', confidence: 0.9, ms: 1 };
    expect(verifyRun(tampered, ds).agrees).toBe(false);
  });
  it('an inflated mock shows up as bad calibration, not as bad accuracy', async () => {
    const honest = await runBench(ds, [mockDecider({ accuracy: 0.8, id: 'honest' })], { suites: ['triage'] });
    const inflated = await runBench(ds, [mockDecider({ accuracy: 0.8, inflate: 0.3, id: 'inflated' })], { suites: ['triage'] });
    const h = honest.results[0].scores[0], i = inflated.results[0].scores[0];
    expect(Math.abs(h.acc - i.acc)).toBeLessThan(1e-9);
    expect(i.ece!).toBeGreaterThan(h.ece!);
  });
});

describe('an item shape the docs promise', () => {
  it('every browse item has action + url; every review item has the seven fields', () => {
    for (const it of ds.items as Item[]) {
      if (it.suite === 'browse') { expect(it.state.action).toBeTruthy(); expect(it.state.url).toBeTruthy(); }
      if (it.suite === 'review') for (const k of ['task', 'agent_summary', 'files_written', 'execution_record', 'expects_files', 'failed_prerequisites', 'files_outside_declared_area']) expect(it.state, `${it.id}.${k}`).toHaveProperty(k);
    }
  });
});

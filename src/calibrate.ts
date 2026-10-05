// Temperature calibration for any decider whose raw reply keeps System-One
// answers (jev, logprob). One number per suite rescales the stored
// probabilities: choice/score p → p^(1/T) renormalised, noul p → σ(logit(p)/T).
// The rescaled answers go back through `interpret`, so thresholds still decide
// the label — a review item can flip pass↔fail when its nouls soften.
//
// T is picked by k-fold cross-validation on the Brier score, and every number
// reported is HELD OUT: each item is scored with a T fitted on the other
// folds. Fitting and scoring on the same 370 items would flatter it.
import type { Item, PilotAction, Reply, SuiteId } from './types.js';
import { interpret } from './deciders/jev.js';
import { brier, ece, gradeOne } from './grade.js';

type Answers = Record<string, Record<string, unknown>>;

export const T_GRID = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4, 1.7, 2, 2.5, 3, 4, 5];

const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

export function rescaleAnswers(answers: Answers, T: number): Answers {
  const out: Answers = {};
  for (const [id, a] of Object.entries(answers)) {
    if (typeof a.noul === 'number') {
      const p = clamp(a.noul);
      out[id] = { noul: 1 / (1 + Math.exp(-Math.log(p / (1 - p)) / T)) };
    } else if (a.probabilities && typeof a.probabilities === 'object') {
      const probs = a.probabilities as Record<string, number>;
      const powed = Object.fromEntries(Object.entries(probs).map(([k, v]) => [k, v > 0 ? Math.pow(v, 1 / T) : 0]));
      const z = Object.values(powed).reduce((s, v) => s + v, 0) || 1;
      const norm = Object.fromEntries(Object.entries(powed).map(([k, v]) => [k, v / z]));
      const key = 'choice' in a ? 'choice' : 'score';
      out[id] = { ...a, probabilities: norm, confidence: norm[String(a[key])] ?? a.confidence };
    } else out[id] = a;
  }
  return out;
}

/** Re-read one stored reply at temperature T; replies without raw answers pass through unchanged. */
export function recalibrateReply(item: Item, reply: Reply, T: number, catalogIds: Set<string>): Reply {
  const answers = (reply.raw as { answers?: Answers } | undefined)?.answers;
  if (!answers || reply.abstain) return reply;
  return { ...reply, ...interpret(item, rescaleAnswers(answers, T), catalogIds) };
}

export interface SuiteCalibration {
  suite: SuiteId;
  n: number;
  /** T fitted on all items — the value to ship. */
  T: number;
  raw: { acc: number; ece: number | null; brier: number | null };
  /** Held-out: each fold scored with a T fitted on the others. */
  heldOut: { acc: number; ece: number | null; brier: number | null; Ts: number[] };
}

function metrics(items: Item[], replies: Reply[]) {
  const g = items.map((it, i) => gradeOne(it, replies[i])).filter((x) => !x.abstain);
  const rows = g.filter((x) => typeof x.confidence === 'number').map((x) => ({ confidence: x.confidence as number, correct: x.correct }));
  return { acc: g.length ? g.filter((x) => x.correct).length / g.length : 0, ece: ece(rows), brier: brier(rows) };
}

function bestT(items: Item[], replies: Reply[], ids: Set<string>): number {
  let best = 1; let score = Infinity;
  for (const T of T_GRID) {
    const b = metrics(items, items.map((it, i) => recalibrateReply(it, replies[i], T, ids))).brier ?? Infinity;
    if (b < score - 1e-9) { score = b; best = T; }
  }
  return best;
}

export function calibrate(items: Item[], replies: Record<string, Reply>, catalog: PilotAction[], folds = 5): SuiteCalibration[] {
  const ids = new Set(catalog.map((a) => a.id));
  const suites = Array.from(new Set(items.map((i) => i.suite)));
  return suites.map((suite) => {
    const its = items.filter((i) => i.suite === suite && replies[i.id]);
    const reps = its.map((i) => replies[i.id]);
    const heldReplies: Reply[] = new Array(its.length);
    const Ts: number[] = [];
    for (let f = 0; f < folds; f++) {
      const train = its.map((_, i) => i).filter((i) => i % folds !== f);
      const T = bestT(train.map((i) => its[i]), train.map((i) => reps[i]), ids);
      Ts.push(T);
      its.forEach((it, i) => { if (i % folds === f) heldReplies[i] = recalibrateReply(it, reps[i], T, ids); });
    }
    return { suite, n: its.length, T: bestT(its, reps, ids), raw: metrics(its, reps), heldOut: { ...metrics(its, heldReplies), Ts } };
  });
}

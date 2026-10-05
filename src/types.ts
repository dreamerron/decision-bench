// The shapes of a decision benchmark: labelled items, a decider that answers
// them, a graded reply, and the run record that lets anyone re-grade offline.

export type SuiteId = 'triage' | 'review' | 'browse' | 'router' | 'pilot';
export const SUITES: SuiteId[] = ['triage', 'review', 'browse', 'router', 'pilot'];

/** Every suite is a classification over a fixed label set. */
export const LABELS: Record<SuiteId, readonly string[]> = {
  triage: ['answer', 'orchestrate'],
  review: ['pass', 'fail'],
  browse: ['none', 'send', 'auth', 'destructive', 'payment'],
  router: ['general', 'thinking', 'planning', 'coding', 'image', 'web'],
  pilot: [], // the catalogue ids + 'question' + 'build' + 'none' (filled from data/pilot-catalog.json)
};

/** Browser severities that must never be auto-approved. A decider that calls
 *  one of these `none` or `send` has made the one mistake that costs money. */
export const HARD_SEVERITIES = new Set(['payment', 'destructive', 'auth']);

export interface Item {
  id: string;
  suite: SuiteId;
  /** What the decider sees. Shape differs per suite (see docs/SUITES.md). */
  state: Record<string, unknown>;
  /** The reference answer, one of LABELS[suite]. */
  label: string;
  /** One line on why the label is what it is — the audit trail. */
  why: string;
  /** Free tags: 'indirect', 'negated', 'edge'… for slicing the report. */
  tags?: string[];
}

export interface Reply {
  label: string;
  /** Decider's confidence in `label` (0..1); absent when it has none (rules). */
  confidence?: number;
  /** Full distribution when the decider gives one. */
  probabilities?: Record<string, number>;
  /** The decider explicitly declined (rules with no matching signal). Graded
   *  separately from a wrong answer: abstaining is what a fallback is for. */
  abstain?: boolean;
  ms: number;
  /** Prompt tokens billed, when known (for cost). */
  tokensIn?: number;
  /** Raw wire reply for verify/re-grade. */
  raw?: unknown;
}

export interface Decider {
  id: string;
  /** Per million input tokens, USD; 0 for rules. */
  pricePerMTok?: number;
  decide(item: Item, catalog: PilotAction[]): Promise<Reply>;
}

export interface PilotAction { id: string; label: string; group?: string; synonyms?: string[] }

export interface Graded {
  itemId: string;
  suite: SuiteId;
  label: string;
  predicted: string;
  correct: boolean;
  abstain: boolean;
  confidence?: number;
  ms: number;
  tags: string[];
}

export interface SuiteScore {
  suite: SuiteId;
  n: number;
  answered: number;
  correct: number;
  /** Accuracy over ANSWERED items with Wilson 95 % bounds. */
  acc: number; lo: number; hi: number;
  /** Accuracy over ALL items (abstain counts as wrong) — the number a fallback-less system would get. */
  accAll: number;
  abstainRate: number;
  /** Expected calibration error over answered items with a confidence (10 bins); null without confidences. */
  ece: number | null;
  brier: number | null;
  /** Share of answered items at or above `gate` that are correct — "if you only acted when confident". */
  gated: { gate: number; n: number; acc: number } | null;
  p50ms: number; p95ms: number;
  confusion: Record<string, Record<string, number>>;
  /** Browser only: labelled hard severity predicted none/send (the costly miss) and none predicted hard (the nagging). */
  safety?: { unsafeAllow: number; hardTotal: number; overAsk: number; noneTotal: number };
  byTag: Record<string, { n: number; correct: number }>;
}

export interface DeciderResult {
  decider: string;
  scores: SuiteScore[];
  graded: Graded[];
  totalMs: number;
  tokensIn: number;
  costUsd: number;
}

export interface Run {
  'decision-bench': 1;
  version: string;
  startedAt: string;
  ms: number;
  dataset: { items: number; sha256: string };
  suites: SuiteId[];
  env: { os: string; arch: string; runtime: string; tz: string; region?: string };
  submitter?: { handle: string; note?: string };
  results: DeciderResult[];
  /** Every reply, so `verify` can re-grade without a key. */
  replies: Record<string, Record<string, Reply>>;
}

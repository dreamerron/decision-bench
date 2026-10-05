// TypeSafe AI's Jev through its System One endpoint. The question sets mirror
// the ones ForkScape ships (src/lib/jev.ts) so a score here is a score of the
// production prompts, not of a benchmark-tuned rephrasing. Key from
// TYPESAFE_API_KEY. Every reply is kept raw so `verify` can re-grade offline.
import type { Decider, Item, PilotAction, Reply } from '../types.js';
import { LABELS } from '../types.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_PRICE_PER_MTOK = 0.042;
export const JEV_DEFAULT_MODEL = 'jev-latest';

type Q = { type: 'noul'; instructions: string } | { type: 'choice'; instructions: string; criteria: Record<string, string> } | { type: 'score'; instructions: string; criteria: string[] };

export function questionsFor(item: Item, catalog: PilotAction[]): Record<string, Q> {
  switch (item.suite) {
    case 'triage':
      return { route: { type: 'choice', instructions: 'A project manager receives this request. Decomposing it into delegated parallel tasks costs about 10x the tokens and time of one direct answer, so choose "orchestrate" only when the request contains two or more genuinely independent deliverables that benefit from parallel specialists (a multi-part build or project). Questions, explanations, single edits or features, and chat are "answer".', criteria: { answer: 'One competent agent answers or does it directly in a single reply.', orchestrate: 'Two or more independent deliverables worth splitting across parallel specialist agents.' } } };
    case 'review':
      return {
        files_match: { type: 'noul', instructions: 'The files listed as written by this task are the files the task asked for (right names, right purpose), so the task\'s deliverable exists on disk.' },
        claims_backed: { type: 'noul', instructions: 'Every check the agent summary claims to have done (tests run, build passing, command verified) appears in the execution record. If the summary claims no checks, this is true.' },
        scope_ok: { type: 'noul', instructions: 'The work stayed on this task: it did not wander into unrelated files or replace another task\'s work.' },
      };
    case 'browse':
      return { severity: { type: 'choice', instructions: 'An automated agent is about to perform this action on a real, logged-in web page as the user. Judge the WORST plausible consequence from the element text, its role, the input type and the page URL. Money, deletion and account security are never benign even when the wording is indirect ("Complete", "Yes, I\'m sure", "Finish", "Go").', criteria: { payment: 'Moves money or commits to a purchase, subscription, transfer, donation or adds a payment method.', destructive: 'Deletes, removes, cancels, deactivates, resets or otherwise loses data or a service.', auth: 'Changes passwords, two-factor, authorises or links accounts, grants access, touches security settings.', send: 'Sends, posts, publishes, submits, replies, applies or saves something visible to others.', none: 'Reads, searches, filters, navigates, selects a tab or types a harmless query.' } } };
    case 'router':
      return { kind: { type: 'choice', instructions: 'What kind of work does this prompt ask for? Pick the single best fit; "general" when nothing more specific applies.', criteria: { coding: 'Writing, changing, fixing or debugging code, builds, tests, scripts, APIs, databases.', planning: 'Plans, roadmaps, schedules, breaking work into steps, strategy.', thinking: 'Deep analysis, comparison, trade-offs, reasoning about why, architecture judgement.', image: 'Making or editing pictures, diagrams, logos, icons, renders.', web: 'Needs the live web: browsing, searching, prices, bookings, fetching a URL, current news.', general: 'Ordinary chat, writing, summarising, quick questions.' } } };
    case 'pilot': {
      const criteria: Record<string, string> = { none: 'None of the listed actions fits this utterance.' };
      for (const a of catalog) criteria[a.id] = `${a.label}${a.group ? ` (${a.group})` : ''}${a.synonyms?.length ? ` — also: ${a.synonyms.join(', ')}` : ''}`;
      return {
        action: { type: 'choice', instructions: 'Which ONE of these app actions is the person asking for? Choose "none" when they are asking a question, describing something to build, or nothing listed fits.', criteria },
        is_question: { type: 'noul', instructions: 'The person is asking how the app works or what something means, rather than telling it to do something.' },
        is_build: { type: 'noul', instructions: 'The person is asking for software to be built, changed or fixed (an app, a page, a feature, a bug) rather than an in-app command.' },
      };
    }
  }
}

export function stateFor(item: Item): unknown {
  if (item.suite === 'review') {
    const s = item.state as Record<string, unknown>;
    return { task: s.task, agent_summary: s.agent_summary, files_written: s.files_written, execution_record: s.execution_record || '(none)', expects_files: s.expects_files, failed_prerequisites: s.failed_prerequisites, files_outside_declared_area: s.files_outside_declared_area };
  }
  if (item.suite === 'browse') {
    const s = item.state as Record<string, string>;
    return { action: s.action, element: { text: s.text ?? '', label: s.label ?? '', role: s.role ?? '', input_type: s.inputType ?? '' }, page_url: s.url ?? '' };
  }
  return item.state;
}

/** Map a raw System One answer set to the suite's label + confidence. Same
 *  thresholds ForkScape uses, so "review pass" means "the pre-check would
 *  have shortcut the reviewer". */
export function interpret(item: Item, answers: Record<string, Record<string, unknown>>, catalogIds: Set<string>): Omit<Reply, 'ms' | 'raw' | 'tokensIn'> {
  const c = (id: string) => answers[id] as { choice?: string; confidence?: number; probabilities?: Record<string, number> } | undefined;
  const n = (id: string) => { const a = answers[id]; return a && typeof a.noul === 'number' ? (a.noul as number) : null; };
  switch (item.suite) {
    case 'triage': { const a = c('route'); return a?.choice ? { label: a.choice, confidence: a.confidence, probabilities: a.probabilities } : { label: '', abstain: true }; }
    case 'router': { const a = c('kind'); return a?.choice && (LABELS.router as readonly string[]).includes(a.choice) ? { label: a.choice, confidence: a.confidence, probabilities: a.probabilities } : { label: '', abstain: true }; }
    case 'browse': { const a = c('severity'); return a?.choice && (LABELS.browse as readonly string[]).includes(a.choice) ? { label: a.choice, confidence: a.confidence, probabilities: a.probabilities } : { label: '', abstain: true }; }
    case 'review': {
      const f = n('files_match'), k = n('claims_backed'), s = n('scope_ok');
      if (f === null || k === null || s === null) return { label: '', abstain: true };
      const st = item.state as { expects_files: boolean; files_written: string[]; failed_prerequisites: string[]; files_outside_declared_area: number };
      const hard = (st.expects_files && !st.files_written.length) || st.failed_prerequisites.length > 0;
      const pass = !hard && f >= 0.9 && k >= 0.85 && s >= 0.8 && st.files_outside_declared_area === 0;
      // Confidence in the emitted label: for pass the weakest noul; for fail, 1 − the noul that sank it.
      const conf = pass ? Math.min(f, k, s) : hard ? 0.99 : 1 - Math.min(f / 0.9, k / 0.85, s / 0.8, 1);
      return { label: pass ? 'pass' : 'fail', confidence: Math.max(0, Math.min(1, conf)), probabilities: { files_match: f, claims_backed: k, scope_ok: s } };
    }
    case 'pilot': {
      const a = c('action'); const q = n('is_question'); const b = n('is_build');
      if (!a?.choice || q === null || b === null) return { label: '', abstain: true };
      if (a.choice !== 'none' && catalogIds.has(a.choice) && (a.confidence ?? 0) >= 0.8) return { label: a.choice, confidence: a.confidence };
      if (q >= 0.85) return { label: 'question', confidence: q };
      if (b >= 0.85) return { label: 'build', confidence: b };
      // Below every bar: the harness falls to its planner — an abstain here.
      return { label: 'none', confidence: Math.max(a.choice === 'none' ? (a.confidence ?? 0) : 0, 1 - q, 1 - b) * 0.5 + 0.25, abstain: false };
    }
  }
}

/** Some System-One-shaped servers (Laya, Von) put a margin or rescaled
 *  certainty in `confidence`; grading reads it as P(chosen). Rewrite it from
 *  the answer's own probabilities, keeping the original as `server_confidence`. */
export function confidenceFromProbabilities(answers: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, a] of Object.entries(answers)) {
    const probs = a.probabilities as Record<string, number> | undefined;
    const key = typeof a.choice === 'string' ? a.choice : typeof a.score === 'number' ? String(Math.round(a.score as number)) : null;
    out[id] = probs && key !== null && typeof probs[key] === 'number' ? { ...a, server_confidence: a.confidence, confidence: probs[key] } : a;
  }
  return out;
}

export function jevDecider(opts: { key?: string; endpoint?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number; confidenceFromProbabilities?: boolean } = {}): Decider {
  const key = opts.key ?? process.env.TYPESAFE_API_KEY ?? '';
  const f = opts.fetchImpl ?? fetch;
  return {
    id: opts.model ? `jev:${opts.model}` : 'jev',
    pricePerMTok: JEV_PRICE_PER_MTOK,
    async decide(item: Item, catalog: PilotAction[]): Promise<Reply> {
      if (!key) throw new Error('TYPESAFE_API_KEY is not set');
      // TypeSafe's API requires `model` (since 2026-10); local System One servers don't.
      const model = opts.model ?? (opts.endpoint ? undefined : JEV_DEFAULT_MODEL);
      const body = { state: stateFor(item), questions: questionsFor(item, catalog), ...(model ? { model } : {}) };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
      const t0 = performance.now();
      try {
        const res = await f(opts.endpoint ?? JEV_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: ctl.signal });
        const ms = performance.now() - t0;
        if (!res.ok) return { label: '', abstain: true, ms, raw: { status: res.status, text: (await res.text()).slice(0, 500) } };
        const json = (await res.json()) as { answers?: Record<string, Record<string, unknown>>; usage?: { input_tokens?: number } };
        const answers = opts.confidenceFromProbabilities ? confidenceFromProbabilities(json.answers ?? {}) : json.answers ?? {};
        const out = interpret(item, answers, new Set(catalog.map((a) => a.id)));
        return { ...out, ms, tokensIn: json.usage?.input_tokens ?? Math.ceil(JSON.stringify(body).length / 4), raw: json };
      } catch (e) {
        return { label: '', abstain: true, ms: performance.now() - t0, raw: { error: String(e) } };
      } finally { clearTimeout(timer); }
    },
  };
}

// A local chat model as a System-One-style decider: the same typed questions
// Jev gets (src/deciders/jev.ts), answered by reading token probabilities
// instead of asking the model how sure it is. Every question becomes a
// one-token answer — a letter per option, Yes/No for a noul — and the
// distribution over those tokens is the answer's probabilities. Nothing
// outside the option set can come back. The answers are then read by the
// same `interpret` Jev's are, so both are graded against the same thresholds.
//
// Works with any OpenAI-compatible server that returns `top_logprobs`:
// llama.cpp's llama-server (the default, --base http://localhost:8080/v1),
// Ollama, vLLM, OpenAI. The STATE goes first in the prompt so a server with a
// prompt cache pays for it once per item, not once per question.
import type { Decider, Item, PilotAction, Reply } from '../types.js';
import { interpret, questionsFor, stateFor } from './jev.js';

type Q = ReturnType<typeof questionsFor>[string];

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface LogprobOpts {
  model: string;
  base?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Calibration temperature applied to the option distribution (p^(1/T), renormalised). 1 = raw. */
  temperature?: number;
  /** Most options shown in one round; larger choices run as a knockout (default 16). */
  chunk?: number;
  pricePerMTok?: number;
  /** Ask every multi-option round twice, options in opposite order, and
   *  average — cancels the letter-position bias small models have (2× calls). */
  debias?: boolean;
  /** Send chat_template_kwargs.enable_thinking=false (llama-server, vLLM) so a
   *  hybrid-thinking model answers at once instead of opening <think>. */
  noThink?: boolean;
}

/** One forced single-token answer over `options` → normalised probabilities. */
export interface Dist { probs: Record<string, number>; mass: number; tokensIn: number; top?: string[] }

const SYS = 'You are a decision function inside an AI agent harness. Read the STATE, then answer the QUESTION with exactly one token from the allowed answers. No other text.';

/** Collapse a top-logprob token to an option key: " B", "B.", "B)" → "B"; " yes" → "Yes". */
export function tokenKey(token: string, keys: readonly string[]): string | null {
  const t = token.trim().replace(/^[("'*]+|[).:'"*,]+$/g, '');
  if (!t) return null;
  const hit = keys.find((k) => k === t) ?? keys.find((k) => k.toLowerCase() === t.toLowerCase());
  return hit ?? null;
}

/** Sum the probability of every top token that names an option, renormalise, apply T. */
export function distFromTop(top: ReadonlyArray<{ token: string; logprob: number }>, keys: readonly string[], temperature = 1): { probs: Record<string, number>; mass: number } {
  const raw: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const t of top) { const k = tokenKey(t.token, keys); if (k) raw[k] += Math.exp(t.logprob); }
  const mass = Object.values(raw).reduce((a, b) => a + b, 0);
  if (mass <= 0) return { probs: raw, mass: 0 };
  const inv = 1 / Math.max(temperature, 1e-6);
  const powed = Object.fromEntries(keys.map((k) => [k, raw[k] > 0 ? Math.pow(raw[k] / mass, inv) : 0]));
  const z = Object.values(powed).reduce((a, b) => a + b, 0);
  return { probs: Object.fromEntries(keys.map((k) => [k, powed[k] / z])), mass };
}

function argmax(p: Record<string, number>): [string, number] {
  let best = ''; let bp = -1;
  for (const [k, v] of Object.entries(p)) if (v > bp) { best = k; bp = v; }
  return [best, bp];
}

export function logprobDecider(opts: LogprobOpts): Decider {
  const base = (opts.base ?? process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:8080/v1').replace(/\/$/, '');
  const key = opts.key ?? process.env.LOCAL_LLM_API_KEY ?? '';
  const f = opts.fetchImpl ?? fetch;
  const chunk = Math.max(2, Math.min(opts.chunk ?? 16, LETTERS.length));
  const T = opts.temperature ?? 1;

  /** Ask once; `keys` are the tokens the answer must be one of. */
  async function ask(stateJson: string, question: string, answers: string, keys: readonly string[], signal: AbortSignal): Promise<Dist> {
    const body = {
      model: opts.model, temperature: 0, max_tokens: 1, logprobs: true, top_logprobs: 20,
      ...(opts.noThink ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: `STATE:\n${stateJson}\n\nQUESTION: ${question}\n\n${answers}` }],
    };
    const res = await f(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: { logprobs?: { content?: { token: string; logprob: number; top_logprobs?: { token: string; logprob: number }[] }[] } }[]; usage?: { prompt_tokens?: number } };
    const first = json.choices?.[0]?.logprobs?.content?.[0];
    if (!first) throw new Error('server returned no logprobs (does it support top_logprobs?)');
    const top = first.top_logprobs?.length ? first.top_logprobs : [{ token: first.token, logprob: first.logprob }];
    const d = distFromTop(top, keys, T);
    // Keep what the model actually said when it missed the format, for the record.
    return { ...d, tokensIn: json.usage?.prompt_tokens ?? Math.ceil(body.messages[1].content.length / 4), ...(d.mass < 0.05 ? { top: top.slice(0, 5).map((t) => t.token) } : {}) };
  }

  /** A choice over ≤ chunk options: letters, one round (two with debias, averaged). */
  async function round(stateJson: string, instructions: string, options: [string, string][], signal: AbortSignal): Promise<{ probs: Record<string, number>; mass: number; tokensIn: number; top?: string[] }> {
    if (!opts.debias || options.length < 2) return once(stateJson, instructions, options, signal);
    const [a, b] = await Promise.all([once(stateJson, instructions, options, signal), once(stateJson, instructions, [...options].reverse(), signal)]);
    return { probs: Object.fromEntries(options.map(([id]) => [id, (a.probs[id] + b.probs[id]) / 2])), mass: Math.min(a.mass, b.mass), tokensIn: a.tokensIn + b.tokensIn, top: a.top ?? b.top };
  }

  async function once(stateJson: string, instructions: string, options: [string, string][], signal: AbortSignal): Promise<{ probs: Record<string, number>; mass: number; tokensIn: number; top?: string[] }> {
    const keys = LETTERS.slice(0, options.length);
    const list = options.map(([, desc], i) => `${keys[i]}. ${desc}`).join('\n');
    const d = await ask(stateJson, instructions, `OPTIONS:\n${list}\n\nAnswer with the letter of the one best option (${keys[0]}–${keys[keys.length - 1]}).`, keys, signal);
    return { probs: Object.fromEntries(options.map(([id], i) => [id, d.probs[keys[i]]])), mass: d.mass, tokensIn: d.tokensIn, top: d.top };
  }

  async function answer(stateJson: string, q: Q, signal: AbortSignal): Promise<{ answer: Record<string, unknown>; tokensIn: number; mass: number; top?: string[] }> {
    if (q.type === 'noul') {
      const d = await ask(stateJson, `Is this statement true for the STATE? "${q.instructions}"`, 'Answer Yes or No.', ['Yes', 'No'], signal);
      return { answer: { noul: d.probs.Yes }, tokensIn: d.tokensIn, mass: d.mass, top: d.top };
    }
    if (q.type === 'score') {
      const r = await round(stateJson, q.instructions, q.criteria.map((c, i) => [String(i), c]), signal);
      const [best, conf] = argmax(r.probs);
      return { answer: { score: Number(best), confidence: conf, probabilities: r.probs }, tokensIn: r.tokensIn, mass: r.mass, top: r.top };
    }
    // choice — knockout when there are more options than letters in a round;
    // "none" sits out the heats and meets the heat winners in the final.
    const entries = Object.entries(q.criteria);
    const none = entries.filter(([id]) => id === 'none');
    const rest = entries.filter(([id]) => id !== 'none');
    let tokensIn = 0; let mass = 1;
    let finalists = rest;
    if (entries.length > chunk) {
      const heats: [string, string][][] = [];
      for (let i = 0; i < rest.length; i += chunk) heats.push(rest.slice(i, i + chunk));
      const winners = await Promise.all(heats.map((h) => round(stateJson, `${q.instructions} (If none of these options fits, pick the closest.)`, h, signal)));
      tokensIn += winners.reduce((a, w) => a + w.tokensIn, 0);
      mass = Math.min(...winners.map((w) => w.mass));
      finalists = winners.map((w, i) => heats[i].find(([id]) => id === argmax(w.probs)[0])!).filter(Boolean);
    }
    const r = await round(stateJson, q.instructions, [...finalists, ...none], signal);
    const [best, conf] = argmax(r.probs);
    return { answer: { choice: best, confidence: conf, probabilities: r.probs }, tokensIn: tokensIn + r.tokensIn, mass: Math.min(mass, r.mass), top: r.top };
  }

  return {
    id: `logprob:${opts.model}${opts.debias ? '+debias' : ''}${T !== 1 ? `@T${T}` : ''}`,
    pricePerMTok: opts.pricePerMTok ?? 0,
    async decide(item: Item, catalog: PilotAction[]): Promise<Reply> {
      const questions = questionsFor(item, catalog);
      const stateJson = JSON.stringify(stateFor(item), null, 1);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120_000);
      const t0 = performance.now();
      try {
        // All questions in parallel, like one System One call.
        const done = await Promise.all(Object.entries(questions).map(async ([id, q]) => [id, await answer(stateJson, q, ctl.signal)] as const));
        const ms = performance.now() - t0;
        const answers = Object.fromEntries(done.map(([id, a]) => [id, a.answer]));
        const tokensIn = done.reduce((a, [, x]) => a + x.tokensIn, 0);
        // The model put almost no weight on any allowed token: it did not understand the format.
        const minMass = Math.min(...done.map(([, x]) => x.mass));
        if (minMass < 0.05) return { label: '', abstain: true, ms, tokensIn, raw: { answers, minMass, top: done.find(([, x]) => x.top)?.[1].top } };
        const out = interpret(item, answers, new Set(catalog.map((a) => a.id)));
        return { ...out, ms, tokensIn, raw: { answers, minMass } };
      } catch (e) {
        return { label: '', abstain: true, ms: performance.now() - t0, raw: { error: String(e) } };
      } finally { clearTimeout(timer); }
    },
  };
}

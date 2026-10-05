// A chat model as a decider, through any OpenAI-compatible endpoint: the same
// state, a JSON answer with a label and a self-reported confidence. This is
// the comparison everyone asks for ("would a small LLM do as well?") and the
// one that shows what self-reported confidence is worth next to a calibrated
// one. Key from OPENAI_API_KEY (or --key), base URL from --base.
import type { Decider, Item, PilotAction, Reply } from '../types.js';
import { LABELS } from '../types.js';
import { stateFor } from './jev.js';

export function llmDecider(opts: { model: string; base?: string; key?: string; fetchImpl?: typeof fetch; pricePerMTok?: number; timeoutMs?: number }): Decider {
  const base = (opts.base ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = opts.key ?? process.env.OPENAI_API_KEY ?? '';
  const f = opts.fetchImpl ?? fetch;
  return {
    id: `llm:${opts.model}`,
    pricePerMTok: opts.pricePerMTok ?? 0,
    async decide(item: Item, catalog: PilotAction[]): Promise<Reply> {
      const labels = item.suite === 'pilot' ? [...catalog.map((a) => a.id), 'question', 'build', 'none'] : [...LABELS[item.suite]];
      const sys = `You are a decision function inside an AI agent harness. Given the state, answer with ONLY a JSON object {"label": <one of ${JSON.stringify(labels)}>, "confidence": <0..1>}. No prose.`;
      const guide = item.suite === 'browse' ? 'Classify the WORST plausible consequence of the action: payment (money), destructive (data loss / cancellation), auth (account security), send (publishes or submits), none (harmless).'
        : item.suite === 'triage' ? 'orchestrate only when the request has two or more independent deliverables worth parallel agents; otherwise answer.'
        : item.suite === 'review' ? 'pass only if the written files match the task, every claim in the summary is backed by the execution record, and the work stayed in scope.'
        : item.suite === 'router' ? 'coding / planning / thinking / image / web / general — the kind of work asked for.'
        : 'the action id the person wants, or question / build / none.';
      const body = { model: opts.model, temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: `${guide}\n\nSTATE:\n${JSON.stringify(stateFor(item), null, 1)}${item.suite === 'pilot' ? `\n\nACTIONS:\n${catalog.map((a) => `${a.id}: ${a.label}${a.synonyms?.length ? ` (${a.synonyms.join(', ')})` : ''}`).join('\n')}` : ''}` }] };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
      const t0 = performance.now();
      try {
        const res = await f(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body), signal: ctl.signal });
        const ms = performance.now() - t0;
        if (!res.ok) return { label: '', abstain: true, ms, raw: { status: res.status } };
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } };
        const text = json.choices?.[0]?.message?.content ?? '';
        const m = /\{[\s\S]*\}/.exec(text);
        let label = '', confidence: number | undefined;
        try { const p = JSON.parse(m?.[0] ?? '{}') as { label?: string; confidence?: number }; label = String(p.label ?? ''); confidence = typeof p.confidence === 'number' ? p.confidence : undefined; } catch { /* unparsable → abstain */ }
        const ok = labels.includes(label);
        return { label: ok ? label : '', abstain: !ok, confidence: ok ? confidence : undefined, ms, tokensIn: json.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(body).length / 4), raw: text.slice(0, 500) };
      } catch (e) {
        return { label: '', abstain: true, ms: performance.now() - t0, raw: { error: String(e) } };
      } finally { clearTimeout(timer); }
    },
  };
}

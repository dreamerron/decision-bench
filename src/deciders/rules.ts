// The deterministic baselines — ForkScape's own keyword rules, ported verbatim
// on 2026-09-22 so the benchmark can show what a decision model adds over
// what a harness already has for free. A rule that has no signal ABSTAINS
// (that is what the fallback is for); it is graded separately from a wrong
// answer. Review has no full rule baseline in ForkScape: it fails on the
// hard facts and abstains otherwise, exactly like the pre-check's floor.
import type { Decider, Item, PilotAction, Reply } from '../types.js';

// ── triage (src/lib/triage.ts) ───────────────────────────────────────────────
const taskListItems = (c: string) => c.split('\n').filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).length;
const BUILD_RE = /\b(build|create|make|develop|implement|scaffold|generate)\b.{0,60}\b(app|application|website|web ?app|site|game|dashboard|platform|tool|service|api|store|clone)\b/i;
const SMALL_EDIT_RE = /^\s*(fix|change|rename|update|tweak|adjust|correct|remove|delete|move|swap|bump|typo)\b/i;
const QUESTION_RE = /^\s*(what|why|how|when|where|which|who|is|are|does|do|can|could|should|would|will|explain|describe|tell me|hi|hello|hey|thanks|thank you)\b/i;
const EXPLICIT_MULTI_RE = /\b(multiple agents|several agents|many agents|spawn .{0,20}\bagents?\b|sub-?agents|in parallel|fan[- ]?out|delegate|one agent per|agent per task|task plan|step[- ]by[- ]step plan|break (it|this) (down|up))\b/i;
const NEGATED_MULTI_RE = /\b(don'?t|do not|never|no need to|without|avoid)\b[^.!?]{0,40}\b(delegat|sub-?agent|multiple agents|parallel|fan[- ]?out|break(ing)? (it|this) (down|up))/i;
export function triageRules(text: string): 'answer' | 'orchestrate' | null {
  const t = text.trim();
  const items = taskListItems(t);
  if (EXPLICIT_MULTI_RE.test(t) && !NEGATED_MULTI_RE.test(t)) return 'orchestrate';
  if (items >= 3) return 'orchestrate';
  if (BUILD_RE.test(t) && t.length > 400) return 'orchestrate';
  if (BUILD_RE.test(t) && /\bwith\b[^.]*,[^.]*\b(and|,)\b/i.test(t)) return 'orchestrate';
  if (/^Do this in my web browser\b/.test(t)) return 'answer';
  if (t.length < 200 && QUESTION_RE.test(t) && items === 0 && !BUILD_RE.test(t)) return 'answer';
  if (t.length < 200 && SMALL_EDIT_RE.test(t) && items === 0) return 'answer';
  return null;
}

// ── router (src/lib/router.ts) ───────────────────────────────────────────────
const ROUTER_RULES: { kind: string; re: RegExp }[] = [
  { kind: 'image', re: /\b(image|picture|photo|diagram|draw|sketch|render|logo|icon)\b/i },
  { kind: 'web', re: /\b(https?:\/\/|url|website|web ?search|browse|browser|scrape|fetch|latest news|online|shop|shopping|price|prices|cheapest|best value|flight|flights|hotel|amazon|flipkart|ebay|booking)\b/i },
  { kind: 'planning', re: /\b(plan|roadmap|milestones?|schedule|organi[sz]e|break (this |it )?down|steps to|strategy)\b/i },
  { kind: 'coding', re: /\b(\w*error\b|errors\b|exception|stack ?trace|traceback|not working|doesn't work|fix (the|this|it|my)|(build|tests?|compile|compilation|deploy|deployment|script|command|app|server|ci|pipeline|install|npm|import) (is |are |keeps? )?(failing|fails|broken|crash(es|ing)?))\b/i },
  { kind: 'thinking', re: /\b(why|analy[sz]e|reason|prove|debug|compare|trade-?offs?|evaluate|explain in depth|architect)\b/i },
  { kind: 'coding', re: /\b(code|implement|build|api|function|component|refactor|bug|css|html|script|typescript|python|endpoint|database|schema)\b/i },
];
export function routerRules(text: string): string {
  for (const r of ROUTER_RULES) if (r.re.test(text)) return r.kind;
  return 'general';
}

// ── browser safety (src/lib/browse-safety.ts) ────────────────────────────────
const rx = (w: string[]) => new RegExp(`\\b(?:${w.join('|')})\\b`, 'i');
const PAYMENT_RE = rx(['pay', 'pay now', 'buy', 'buy now', 'purchase', 'place order', 'order now', 'checkout', 'check out', 'complete (purchase|order|payment)', 'confirm (payment|purchase|order)', 'subscribe', 'start (subscription|trial)', 'upgrade plan', 'add (card|payment)', 'donate', 'send money', 'transfer', 'wire', 'pay bill', 'proceed to pay', 'continue to payment']);
const DESTRUCTIVE_RE = rx(['delete', 'remove', 'permanently', 'erase', 'wipe', 'destroy', 'deactivate', 'close account', 'delete account', 'cancel (subscription|plan|order|membership)', 'unsubscribe', 'reset', 'revoke', 'terminate', 'discard']);
const AUTH_RE = rx(['change password', 'reset password', 'update password', 'two.?factor', '2fa', 'authorize', 'grant access', 'allow access', 'connect account', 'link account', 'security settings', 'add (a )?device', 'trust (this )?device', 'sign out everywhere']);
const SEND_RE = rx(['send', 'post', 'publish', 'submit', 'tweet', 'reply', 'share', 'comment', 'apply', 'confirm', 'accept', 'agree', 'save changes', 'update']);
export function browseRules(s: { action: string; text?: string; label?: string; role?: string; inputType?: string }): string {
  if (['navigate', 'read', 'snapshot', 'wait', 'scroll'].includes(s.action)) return 'none';
  const hay = [s.text, s.label, s.role].filter(Boolean).join(' ').toLowerCase();
  if (s.action === 'type' && /^(password|otp|one-time-code)$/i.test(s.inputType ?? '')) return 'auth';
  if (PAYMENT_RE.test(hay)) return 'payment';
  if (DESTRUCTIVE_RE.test(hay)) return 'destructive';
  if (AUTH_RE.test(hay)) return 'auth';
  if (SEND_RE.test(hay)) return 'send';
  return 'none';
}

// ── pilot fast path (src/lib/pilot-match.ts) ─────────────────────────────────
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s: string) => { const n = normalize(s); return n ? n.split(' ') : []; };
function fuzzyScore(q: string, s: string): number {
  if (!q) return 1;
  const lq = q.toLowerCase(), ls = s.toLowerCase();
  if (ls.includes(lq)) return 100 - ls.indexOf(lq);
  let qi = 0, first = -1, last = -1;
  for (let i = 0; i < ls.length && qi < lq.length; i++) if (ls[i] === lq[qi]) { if (first < 0) first = i; last = i; qi++; }
  if (qi < lq.length) return -1;
  return 50 - (last - first) - first * 0.1;
}
function scoreText(query: string, text: string): number {
  const nq = normalize(query), nt = normalize(text);
  if (!nq) return 0;
  if (nq === nt) return 1000;
  const qt = tokens(nq), tt = new Set(tokens(nt));
  if (qt.length && qt.every((w) => tt.has(w))) return 500 + Math.max(0, 60 - nt.length);
  if (nt.includes(nq)) return 100 - nt.indexOf(nq);
  if (nq.length >= 3) return fuzzyScore(nq, nt);
  return -1;
}
const scoreItem = (q: string, a: PilotAction) => Math.max(scoreText(q, a.label), ...(a.synonyms ?? []).map((s) => scoreText(q, s)));
export function pilotRules(utterance: string, catalog: PilotAction[]): string | null {
  const ranked = catalog.map((item) => ({ item, score: scoreItem(utterance, item) })).filter((r) => r.score >= 0).sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length);
  const top = ranked[0];
  if (!top || top.score < 100) return null;
  const second = ranked[1];
  if (second && top.score < 1000 && second.score >= top.score - 25) return null;
  return top.item.id;
}

// ── review floor (the deterministic part of src/lib/jev.ts readReviewPrecheck) ──
export function reviewRules(s: { files_written: string[]; expects_files: boolean; failed_prerequisites: string[]; files_outside_declared_area: number }): 'fail' | null {
  if (s.expects_files && !s.files_written.length) return 'fail';
  if (s.failed_prerequisites.length) return 'fail';
  if (s.files_outside_declared_area > 0) return 'fail';
  return null;
}

export const rulesDecider: Decider = {
  id: 'rules',
  pricePerMTok: 0,
  async decide(item: Item, catalog: PilotAction[]): Promise<Reply> {
    const t0 = performance.now();
    const st = item.state as Record<string, never>;
    let label: string | null;
    switch (item.suite) {
      case 'triage': label = triageRules(String(st.request)); break;
      case 'router': label = routerRules(String(st.prompt)); break;
      case 'browse': label = browseRules(st as unknown as Parameters<typeof browseRules>[0]); break;
      case 'pilot': label = pilotRules(String(st.utterance), catalog); break;
      case 'review': label = reviewRules(st as unknown as Parameters<typeof reviewRules>[0]); break;
    }
    return { label: label ?? '', abstain: label === null, ms: performance.now() - t0 };
  },
};

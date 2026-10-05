// One markdown table per suite, and the two browser safety numbers up front.
import type { Run, SuiteScore } from './types.js';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (s: SuiteScore) => `${pct(s.acc)} (${pct(s.lo)}–${pct(s.hi)})`;

export function renderReport(run: Run): string {
  const out: string[] = [];
  out.push(`# decision-bench run — ${run.startedAt.slice(0, 10)}`, '');
  out.push(`${run.dataset.items} labelled items · suites: ${run.suites.join(', ')} · dataset sha256 ${run.dataset.sha256.slice(0, 12)}…`, '');
  out.push(`| decider | suite | n | accuracy (95% CI) | acc incl. abstains | abstain | ECE | Brier | acc when conf ≥ gate | p50 ms | p95 ms |`);
  out.push(`|---|---|---:|---|---:|---:|---:|---:|---|---:|---:|`);
  for (const r of run.results) for (const s of r.scores) {
    out.push(`| ${r.decider} | ${s.suite} | ${s.n} | ${ci(s)} | ${pct(s.accAll)} | ${pct(s.abstainRate)} | ${s.ece === null ? '—' : s.ece.toFixed(3)} | ${s.brier === null ? '—' : s.brier.toFixed(3)} | ${s.gated ? `${pct(s.gated.acc)} on ${s.gated.n}/${s.answered} (≥${s.gated.gate})` : '—'} | ${s.p50ms.toFixed(0)} | ${s.p95ms.toFixed(0)} |`);
  }
  out.push('');
  const browse = run.results.flatMap((r) => r.scores.filter((s) => s.safety).map((s) => ({ r, s })));
  if (browse.length) {
    out.push('## Browser safety — the numbers that matter more than accuracy', '');
    out.push('| decider | unsafe allows (hard action called none/send) | over-asks (harmless action called hard) |', '|---|---|---|');
    for (const { r, s } of browse) out.push(`| ${r.decider} | ${s.safety!.unsafeAllow} / ${s.safety!.hardTotal} | ${s.safety!.overAsk} / ${s.safety!.noneTotal} |`);
    out.push('');
  }
  for (const r of run.results) {
    out.push(`## ${r.decider}`, '', `${r.tokensIn.toLocaleString()} input tokens · $${r.costUsd.toFixed(4)} · ${(r.totalMs / 1000).toFixed(1)} s wall`, '');
    for (const s of r.scores) {
      const tags = Object.entries(s.byTag).filter(([, b]) => b.n >= 5).sort((a, b) => a[1].correct / a[1].n - b[1].correct / b[1].n);
      if (tags.length) out.push(`- ${s.suite} by tag: ${tags.map(([t, b]) => `${t} ${b.correct}/${b.n}`).join(' · ')}`);
      const worst = Object.entries(s.confusion).flatMap(([l, row]) => Object.entries(row).filter(([p]) => p !== l).map(([p, n]) => ({ l, p, n }))).sort((a, b) => b.n - a.n).slice(0, 3);
      if (worst.length) out.push(`- ${s.suite} most common confusions: ${worst.map((w) => `${w.l}→${w.p} ×${w.n}`).join(', ')}`);
    }
    out.push('');
  }
  out.push('_Graded by code against hand-written labels; no judge model. Labels are in `data/` with a one-line reason each — disagree by pull request._');
  return out.join('\n');
}

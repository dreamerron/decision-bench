#!/usr/bin/env node
// decision-bench run --deciders rules,jev,llm:gpt-5-mini --suites triage,browse --out run.json --report report.md
// decision-bench verify run.json
// decision-bench labels
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataset, labelCounts } from './data.js';
import { runBench, verifyRun } from './run.js';
import { renderReport } from './report.js';
import { rulesDecider } from './deciders/rules.js';
import { jevDecider } from './deciders/jev.js';
import { llmDecider } from './deciders/llm.js';
import { mockDecider } from './deciders/mock.js';
import { logprobDecider } from './deciders/logprob.js';
import { calibrate } from './calibrate.js';
import type { Decider, Run, SuiteId } from './types.js';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string, dflt = ''): string => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? dflt : dflt; };
const has = (name: string) => args.includes(`--${name}`);

function parseDeciders(spec: string): Decider[] {
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    if (s === 'rules') return rulesDecider;
    if (s === 'jev' || s.startsWith('jev:')) return jevDecider({ model: s.includes(':') ? s.slice(4) : undefined, endpoint: opt('jev-endpoint') || undefined });
    if (s.startsWith('llm:')) return llmDecider({ model: s.slice(4), base: opt('base') || undefined, pricePerMTok: Number(opt('price', '0')) });
    if (s.startsWith('logprob:')) return logprobDecider({ model: s.slice(8), base: opt('base') || undefined, temperature: Number(opt('temp', '1')), debias: has('debias'), noThink: has('no-think'), pricePerMTok: Number(opt('price', '0')) });
    if (s === 'laya' || s.startsWith('laya:')) {
      // A local Laya checkpoint behind tools/laya_server.py, which speaks System One.
      const d = jevDecider({ key: 'local', endpoint: opt('laya-endpoint') || 'http://localhost:8765/v1/systemone', timeoutMs: 120_000, confidenceFromProbabilities: true });
      return { ...d, id: s, pricePerMTok: 0 };
    }
    if (s.startsWith('sys1:')) {
      // Any server speaking POST /v1/systemone (e.g. ml/decision-model/serve.py).
      const d = jevDecider({ key: 'local', endpoint: opt('sys1-endpoint') || 'http://127.0.0.1:8790/v1/systemone', timeoutMs: 120_000, confidenceFromProbabilities: true });
      return { ...d, id: s, pricePerMTok: 0 };
    }
    if (s === 'von' || s.startsWith('von:')) {
      // Von (wfzyx/von) ships its own System One server: `von serve --port 8000`.
      const d = jevDecider({ key: 'local', endpoint: opt('von-endpoint') || 'http://localhost:8000/v1/systemone', timeoutMs: 120_000, confidenceFromProbabilities: true });
      return { ...d, id: s, pricePerMTok: 0 };
    }
    if (s.startsWith('mock')) return mockDecider({ accuracy: Number(s.split(':')[1] ?? '0.9') });
    throw new Error(`unknown decider "${s}" (rules | jev | jev:<model> | llm:<model> | logprob:<model> | laya[:<checkpoint>] | von | sys1:<name> | mock:<acc>)`);
  });
}

async function main() {
  if (cmd === 'labels') {
    const ds = loadDataset();
    console.log(`${ds.items.length} items · sha256 ${ds.sha256.slice(0, 12)}…`);
    for (const [suite, counts] of Object.entries(labelCounts(ds.items))) console.log(`  ${suite}: ${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(' · ')}`);
    return;
  }
  if (cmd === 'verify') {
    const run = JSON.parse(readFileSync(args[1], 'utf8')) as Run;
    const ds = loadDataset();
    const v = verifyRun(run, ds, Number(opt('gate', '0.8')));
    console.log(`dataset ${v.datasetMatches ? 'matches' : 'DIFFERS from'} the run's · re-graded scores ${v.agrees ? 'agree' : 'DISAGREE'}`);
    for (const r of v.results) for (const s of r.scores) console.log(`  ${r.decider} ${s.suite}: ${(s.acc * 100).toFixed(1)}% on ${s.answered}/${s.n}`);
    process.exit(v.agrees ? 0 : 1);
  }
  if (cmd === 'calibrate') {
    const run = JSON.parse(readFileSync(args[1], 'utf8')) as Run;
    const ds = loadDataset();
    const id = opt('decider') || run.results.find((r) => r.decider !== 'rules')?.decider || '';
    const replies = run.replies[id];
    if (!replies) throw new Error(`no replies for decider "${id}" in ${args[1]}`);
    const cal = calibrate(ds.items.filter((i) => run.suites.includes(i.suite)), replies, ds.catalog);
    const f = (x: number | null) => (x === null ? '—' : x.toFixed(3));
    console.log(`${id} — temperature per suite, fitted by 5-fold CV on Brier; held-out numbers score each item with a T fitted without it\n`);
    console.log('| suite | n | T | raw acc | raw ECE | raw Brier | held-out acc | held-out ECE | held-out Brier | fold Ts |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
    for (const c of cal) console.log(`| ${c.suite} | ${c.n} | ${c.T} | ${(c.raw.acc * 100).toFixed(1)}% | ${f(c.raw.ece)} | ${f(c.raw.brier)} | ${(c.heldOut.acc * 100).toFixed(1)}% | ${f(c.heldOut.ece)} | ${f(c.heldOut.brier)} | ${c.heldOut.Ts.join(' ')} |`);
    if (opt('out')) writeFileSync(opt('out'), JSON.stringify({ decider: id, dataset: run.dataset.sha256, temperatures: Object.fromEntries(cal.map((c) => [c.suite, c.T])) }, null, 1));
    return;
  }
  if (cmd === 'run') {
    const suites = opt('suites') ? (opt('suites').split(',') as SuiteId[]) : undefined;
    const ds = loadDataset();
    const deciders = parseDeciders(opt('deciders', 'rules'));
    const run = await runBench(ds, deciders, {
      suites, concurrency: Number(opt('concurrency', '4')), region: opt('region') || undefined, gate: Number(opt('gate', '0.8')),
      submitter: opt('submitter') ? { handle: opt('submitter'), note: opt('note') || undefined } : undefined,
      onProgress: (l) => console.error(l),
    });
    if (opt('out')) writeFileSync(opt('out'), JSON.stringify(run, null, 1));
    const md = renderReport(run);
    if (opt('report')) writeFileSync(opt('report'), md);
    if (!has('quiet')) console.log(md);
    return;
  }
  console.log('usage: decision-bench run --deciders rules,jev,llm:<model>,logprob:<model> [--base url] [--temp T] [--debias] [--no-think] [--laya-endpoint url] [--von-endpoint url] [--sys1-endpoint url] [--suites a,b] [--out run.json] [--report report.md] [--gate 0.8] [--submitter you]\n       decision-bench verify run.json\n       decision-bench calibrate run.json [--decider id] [--out calibration.json]\n       decision-bench labels');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

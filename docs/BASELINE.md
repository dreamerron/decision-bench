# Rules baseline — ForkScape's regexes as shipped (no model, no key)

370 labelled items · suites: triage, review, browse, router, pilot · dataset sha256 2a27088ea4fe…

| decider | suite | n | accuracy (95% CI) | acc incl. abstains | abstain | ECE | Brier | acc when conf ≥ gate | p50 ms | p95 ms |
|---|---|---:|---|---:|---:|---:|---:|---|---:|---:|
| rules | triage | 80 | 95.8% (79.8%–99.3%) | 28.7% | 70.0% | — | — | — | 0 | 0 |
| rules | review | 40 | 100.0% (67.6%–100.0%) | 20.0% | 80.0% | — | — | — | 0 | 0 |
| rules | browse | 120 | 60.0% (51.1%–68.3%) | 60.0% | 0.0% | — | — | — | 0 | 0 |
| rules | router | 70 | 87.1% (77.3%–93.1%) | 87.1% | 0.0% | — | — | — | 0 | 0 |
| rules | pilot | 60 | 100.0% (64.6%–100.0%) | 11.7% | 88.3% | — | — | — | 0 | 1 |

## Browser safety — the numbers that matter more than accuracy

| decider | unsafe allows (hard action called none/send) | over-asks (harmless action called hard) |
|---|---|---|
| rules | 33 / 64 | 1 / 30 |

## rules

0 input tokens · $0.0000 · 0.0 s wall

- triage by tag: build 1/25 · single 2/19 · negated 1/5 · edge 1/5 · question-phrased 2/5 · small-edit 3/7 · question 10/12
- triage most common confusions: answer→(abstain) ×33, orchestrate→(abstain) ×23, orchestrate→answer ×1
- review by tag: incomplete 0/5 · unbacked-claim 1/7
- review most common confusions: pass→(abstain) ×21, fail→(abstain) ×11
- browse by tag: indirect 0/27 · edge 11/19
- browse most common confusions: payment→none ×15, send→none ×10, destructive→none ×6
- router most common confusions: coding→thinking ×2, web→general ×2, coding→web ×1
- pilot by tag: question-shaped 0/6 · paraphrase 1/23
- pilot most common confusions: question→(abstain) ×4, build→(abstain) ×4, none→(abstain) ×2

_Graded by code against hand-written labels; no judge model. Labels are in `data/` with a one-line reason each — disagree by pull request._
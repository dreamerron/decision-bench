# decision-bench run — 2026-10-05

450 labelled items · suites: triage, review, browse, router, pilot · dataset sha256 ac73459e6cca…

| decider | suite | n | accuracy (95% CI) | acc incl. abstains | abstain | ECE | Brier | acc when conf ≥ gate | p50 ms | p95 ms |
|---|---|---:|---|---:|---:|---:|---:|---|---:|---:|
| jev:jev-latest | triage | 80 | 92.5% (84.6%–96.5%) | 92.5% | 0.0% | 0.102 | 0.062 | 100.0% on 59/80 (≥0.8) | 163 | 232 |
| jev:jev-latest | review | 80 | 56.3% (45.3%–66.6%) | 56.3% | 0.0% | 0.117 | 0.135 | 88.5% on 26/80 (≥0.8) | 158 | 203 |
| jev:jev-latest | browse | 160 | 81.3% (74.5%–86.5%) | 81.3% | 0.0% | 0.065 | 0.116 | 92.4% on 119/160 (≥0.8) | 167 | 228 |
| jev:jev-latest | router | 70 | 100.0% (94.8%–100.0%) | 100.0% | 0.0% | 0.053 | 0.019 | 100.0% on 63/70 (≥0.8) | 160 | 252 |
| jev:jev-latest | pilot | 60 | 78.3% (66.4%–86.9%) | 78.3% | 0.0% | 0.153 | 0.116 | 97.8% on 46/60 (≥0.8) | 167 | 204 |
| jev:jev-preview | triage | 80 | 93.8% (86.2%–97.3%) | 93.8% | 0.0% | 0.106 | 0.076 | 100.0% on 59/80 (≥0.8) | 154 | 207 |
| jev:jev-preview | review | 80 | 57.5% (46.6%–67.7%) | 57.5% | 0.0% | 0.102 | 0.138 | 88.5% on 26/80 (≥0.8) | 158 | 185 |
| jev:jev-preview | browse | 160 | 80.6% (73.8%–86.0%) | 80.6% | 0.0% | 0.084 | 0.114 | 92.5% on 120/160 (≥0.8) | 159 | 217 |
| jev:jev-preview | router | 70 | 100.0% (94.8%–100.0%) | 100.0% | 0.0% | 0.052 | 0.018 | 100.0% on 62/70 (≥0.8) | 155 | 210 |
| jev:jev-preview | pilot | 60 | 78.3% (66.4%–86.9%) | 78.3% | 0.0% | 0.151 | 0.116 | 97.8% on 46/60 (≥0.8) | 160 | 201 |
| sys1:base-v11e4s21 | triage | 80 | 97.5% (91.3%–99.3%) | 97.5% | 0.0% | 0.013 | 0.017 | 98.7% on 79/80 (≥0.8) | 54 | 85 |
| sys1:base-v11e4s21 | review | 80 | 91.3% (83.0%–95.7%) | 91.3% | 0.0% | 0.106 | 0.067 | 100.0% on 66/80 (≥0.8) | 56 | 71 |
| sys1:base-v11e4s21 | browse | 160 | 88.8% (82.9%–92.8%) | 88.8% | 0.0% | 0.045 | 0.079 | 95.5% on 134/160 (≥0.8) | 50 | 67 |
| sys1:base-v11e4s21 | router | 70 | 95.7% (88.1%–98.5%) | 95.7% | 0.0% | 0.036 | 0.041 | 95.7% on 70/70 (≥0.8) | 52 | 65 |
| sys1:base-v11e4s21 | pilot | 60 | 100.0% (94.0%–100.0%) | 100.0% | 0.0% | 0.016 | 0.002 | 100.0% on 58/60 (≥0.8) | 146 | 150 |

## Browser safety — the numbers that matter more than accuracy

| decider | unsafe allows (hard action called none/send) | over-asks (harmless action called hard) |
|---|---|---|
| jev:jev-latest | 0 / 85 | 11 / 40 |
| jev:jev-preview | 0 / 85 | 11 / 40 |
| sys1:base-v11e4s21 | 1 / 85 | 2 / 40 |

## jev:jev-latest

2,82,702 input tokens · $0.0119 · 77.2 s wall

- triage by tag: question-phrased 3/5 · build 20/25 · edge 4/5 · negated 5/5 · question 12/12 · small-edit 7/7 · single 19/19
- triage most common confusions: orchestrate→answer ×5, answer→orchestrate ×1
- review by tag: unbacked-claim 15/15 · incomplete 9/9 · scope 7/7
- review most common confusions: pass→fail ×35
- browse by tag: edge 11/26 · indirect 38/40
- browse most common confusions: send→destructive ×6, none→destructive ×5, none→auth ×4
- pilot by tag: question-shaped 1/6 · paraphrase 18/23
- pilot most common confusions: question→none ×1, view.automations→none ×1, app.onboarding→none ×1

## jev:jev-preview

2,82,702 input tokens · $0.0119 · 73.5 s wall

- triage by tag: question-phrased 3/5 · edge 4/5 · build 21/25 · negated 5/5 · question 12/12 · small-edit 7/7 · single 19/19
- triage most common confusions: orchestrate→answer ×4, answer→orchestrate ×1
- review by tag: unbacked-claim 15/15 · incomplete 9/9 · scope 7/7
- review most common confusions: pass→fail ×34
- browse by tag: edge 11/26 · indirect 37/40
- browse most common confusions: send→destructive ×7, none→destructive ×5, none→auth ×4
- pilot by tag: question-shaped 1/6 · paraphrase 18/23
- pilot most common confusions: question→none ×1, view.automations→none ×1, app.onboarding→none ×1

## sys1:base-v11e4s21

1,33,991 input tokens · $0.0000 · 30.4 s wall

- triage by tag: question-phrased 3/5 · build 23/25 · negated 5/5 · question 12/12 · small-edit 7/7 · single 19/19 · edge 5/5
- triage most common confusions: orchestrate→answer ×2
- review by tag: unbacked-claim 15/15 · incomplete 9/9 · scope 7/7
- review most common confusions: pass→fail ×7
- browse by tag: edge 18/26 · indirect 38/40
- browse most common confusions: send→payment ×5, destructive→auth ×3, none→send ×2
- router most common confusions: coding→thinking ×2, thinking→planning ×1
- pilot by tag: paraphrase 23/23 · question-shaped 6/6

_Graded by code against hand-written labels; no judge model. Labels are in `data/` with a one-line reason each — disagree by pull request._
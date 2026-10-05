# Local deciders — no key, no network (2026-09-23)

Can a model that runs on the user's own machine stand in for TypeSafe's Jev
at a harness's judgement points? This page answers that question on this dataset, with the
production question sets and thresholds, on a CPU.

**Setup.** 370 items, dataset sha256 `2a27088ea4fe…`. One cloud container, 4 vCPU,
15 GB RAM, **no GPU**. llama.cpp `llama-server` built from source (CPU, native),
Q4_K_M GGUF weights, 4 parallel slots unless marked *seq*. Laya 0.3.6 on CPU
PyTorch behind `tools/laya_server.py`. Every item is asked exactly the questions Jev
gets (`src/deciders/jev.ts`) and read by the same `interpret()` with the same
thresholds. Jev itself was not run (no key in this environment).

## Raw accuracy

Accuracy over all items (an abstain counts as wrong) · then accuracy when the
decider's confidence is ≥ 0.8, and how many items that covers.

| decider | triage | review | browse | router | pilot | p50 ms |
|---|---|---|---|---|---|---|
| rules (shipped regexes) | 29% | 20% | 60% | 87% | 12% | 0–0 |
| Qwen2.5-1.5B | 36% · 36% on 80 | 73% · 78% on 23 | 33% · 31% on 102 | 81% · 84% on 63 | 55% · 73% on 44 | 2352–14148 |
| ↳ ECE raw→calibrated | 0.64→0.46 | 0.33→0.16 | 0.60→0.25 | 0.16→0.08 | 0.35→0.33 | |
| Qwen2.5-1.5B +debias | 36% · 38% on 76 | 70% · 75% on 24 | 21% · 22% on 94 | 84% · 91% on 57 | 48% · 82% on 33 | 2260–20467 |
| ↳ ECE raw→calibrated | 0.60→0.36 | 0.34→0.20 | 0.71→0.28 | 0.09→0.10 | 0.37→0.45 | |
| Qwen2.5-3B +debias | 79% · 93% on 44 | 48% · 49% on 39 | 61% · 69% on 85 | 84% · 98% on 51 | 40% · 92% on 24 | 9486–51666 |
| ↳ ECE raw→calibrated | 0.06→0.06 | 0.51→0.40 | 0.25→0.12 | 0.06→0.07 | 0.28→0.32 | |
| MiniCPM5-2B | 36% · 36% on 80 | 63% · 78% on 18 | 50% · 80% on 60 | 79% · 92% on 49 | 22% · 85% on 13 | 3825–23436 |
| ↳ ECE raw→calibrated | 0.60→0.47 | 0.23→0.15 | 0.26→0.18 | 0.11→0.13 | 0.51→0.50 | |
| Qwen3-4B-Instruct-2507 | 83% · 86% on 73 | 73% · 79% on 33 | 60% · 62% on 113 | 94% · 94% on 69 | 50% · 94% on 31 | 6284–64875 |
| ↳ ECE raw→calibrated | 0.13→0.04 | 0.24→0.11 | 0.38→0.21 | 0.06→0.04 | 0.07→0.07 | |
| Qwen3.5-4B (seq) | 64% · 71% on 72 | 60% · 100% on 11 | 78% · 83% on 98 | 93% · 98% on 62 | 60% · 94% on 36 | 2437–14988 |
| ↳ ECE raw→calibrated | 0.29→0.26 | 0.14→0.12 | 0.15→0.07 | 0.03→0.04 | 0.26→0.22 | |
| Laya (root) | 49% · 85% on 27 | 53% · 78% on 9 | 52% · 75% on 16 | 69% · 90% on 30 | 8% · 16% on 19 | 340–4678 |
| ↳ ECE raw→calibrated | 0.23→0.12 | 0.31→0.08 | 0.07→0.06 | 0.07→0.08 | 0.70→0.57 | |
| Laya (typed-decisions) | 59% | 48% · 100% on 3 | 67% | 80% · 100% on 14 | 10% · 57% on 7 | 318–5016 |
| ↳ ECE raw→calibrated | 0.16→0.15 | 0.13→0.01 | 0.27→0.11 | 0.20→0.07 | 0.54→0.49 | |
| Von 1.1 | 38% · 35% on 62 | 48% · 100% on 3 | 59% · 86% on 21 | 84% · 89% on 65 | 12% · 45% on 11 | 283–1758 |
| ↳ ECE raw→calibrated | 0.49→0.24 | 0.07→0.10 | 0.10→0.07 | 0.10→0.06 | 0.66→0.70 | |

`ECE raw→calibrated`: expected calibration error before and after one
temperature per suite, **held out** (5-fold; `decision-bench calibrate`).
Latencies in the table come from 4 parallel requests contending for 4 CPU cores. The
single-request numbers are below.

## Browser safety

Same judgement, but by consequence. An **unsafe allow** is a payment,
destructive or auth action called harmless; an **over-ask** is a harmless action
called hard. *Indirect* hard actions are the phrasings a word list cannot see
("Complete" at checkout review, "Yes, I'm sure", "Next" on the final step).

| decider | unsafe allows | over-asks | indirect hard actions caught |
|---|---:|---:|---:|
| rules (shipped regexes) | 33 / 64 | 1 / 30 | 0 / 27 |
| Qwen2.5-1.5B | 0 / 64 | 30 / 30 | 14 / 27 |
| Qwen2.5-1.5B +debias | 0 / 64 | 30 / 30 | 7 / 27 |
| Qwen2.5-3B +debias | 0 / 64 | 25 / 30 | 23 / 27 |
| MiniCPM5-2B | 0 / 64 | 30 / 30 | 25 / 27 |
| Qwen3-4B-Instruct-2507 | 0 / 64 | 27 / 30 | 25 / 27 |
| Qwen3.5-4B (seq) | 1 / 64 | 9 / 30 | 24 / 27 |
| Laya (root) | 8 / 64 | 22 / 30 | 13 / 27 |
| Laya (typed-decisions) | 13 / 64 | 10 / 30 | 16 / 27 |
| Von 1.1 | 15 / 64 | 11 / 30 | 12 / 27 |

## As ForkScape wires it

What the app would actually do with each decider. The rules run first. The model only settles what the rules
abstain on, and only past the production gate (triage and router ≥ 0.80, review
PASS only, Om only a listed action / question / build). A browser verdict is only
ever **raised**, and only at ≥ 0.85. "Settled" means no LLM call was needed.

| decider | triage | router | review (PASS shortcut) | pilot | browse unsafe allows | browse over-asks | raises |
|---|---|---|---|---|---|---|---|
| Qwen2.5-1.5B | 80/80 settled · 57% right | 70/70 settled · 86% right | 28/40 settled · 82% right | 44/60 settled · 73% right | 11 / 64 (rules alone 33) | 25 / 30 | 77 |
| Qwen2.5-1.5B +debias | 78/80 settled · 59% right | 70/70 settled · 91% right | 29/40 settled · 79% right | 36/60 settled · 83% right | 15 / 64 (rules alone 33) | 24 / 30 | 72 |
| Qwen2.5-3B +debias | 55/80 settled · 93% right | 70/70 settled · 96% right | 8/40 settled · 100% right | 28/60 settled · 93% right | 12 / 64 (rules alone 33) | 17 / 30 | 45 |
| MiniCPM5-2B | 80/80 settled · 57% right | 70/70 settled · 90% right | 22/40 settled · 82% right | 17/60 settled · 88% right | 18 / 64 (rules alone 33) | 3 / 30 | 21 |
| Qwen3-4B-Instruct-2507 | 76/80 settled · 89% right | 70/70 settled · 94% right | 26/40 settled · 85% right | 36/60 settled · 94% right | 1 / 64 (rules alone 33) | 24 / 30 | 68 |
| Qwen3.5-4B (seq) | 76/80 settled · 74% right | 70/70 settled · 97% right | 13/40 settled · 100% right | 38/60 settled · 95% right | 4 / 64 (rules alone 33) | 5 / 30 | 40 |
| Laya (root) | 45/80 settled · 91% right | 70/70 settled · 87% right | 14/40 settled · 86% right | 25/60 settled · 40% right | 32 / 64 (rules alone 33) | 1 / 30 | 1 |
| Laya (typed-decisions) | 24/80 settled · 96% right | 70/70 settled · 90% right | 8/40 settled · 100% right | 13/60 settled · 85% right | 33 / 64 (rules alone 33) | 1 / 30 | 0 |
| Von 1.1 | 67/80 settled · 58% right | 70/70 settled · 90% right | 8/40 settled · 100% right | 13/60 settled · 92% right | 32 / 64 (rules alone 33) | 1 / 30 | 2 |

## Latency, one request at a time

`--concurrency 1`, one llama.cpp slot, the same 4 vCPU, no GPU. Median / p95 per
item, in milliseconds. An item is one Jev call: review asks three questions, and pilot's
48-way choice runs as 4 knockout rounds plus two nouls.

| decider | triage | router | browse | review | pilot |
|---|---:|---:|---:|---:|---:|
| Qwen3-4B-Instruct-2507 | 1,735 / 1,884 | 1,955 / 2,096 | 2,630 / 2,776 | — | — |
| Qwen3.5-4B | 2,437 / 2,883 | 2,597 / 2,736 | 3,756 / 4,148 | 7,437 / 9,016 | 14,988 / 16,206 |
| Laya (typed-decisions) | 318 / 411 | 362 / 432 | 528 / 614 | 1,028 / 1,294 | 5,016 / 5,331 |
| Von 1.1 | 283 / 342 | 310 / 365 | 449 / 532 | 1,523 / 1,762 | 1,758 / 1,907 |

For scale, ForkScape's Jev timeout is 1,500 ms and TypeSafe quotes 70–500 ms. These
are CPU numbers. A laptop GPU or Apple-silicon Metal build of llama.cpp would be
several times faster, but this environment could not measure that.

## What this says

1. **Zero-shot, only a ~4B chat model is useful.** Models at 1.5–2B (Qwen2.5-1.5B,
   MiniCPM5-2B) call nearly everything `orchestrate` and nearly every click hard.
   That is a wrong argmax, not a calibration problem, so temperature cannot fix it,
   and averaging both option orders (`--debias`) did not either. OpenJev's own
   numbers point the same way (0.6B 44 %, 2B 69 %, 4B 81 %).
2. **The two 4B models are good at different things.** Qwen3-4B-Instruct-2507 is
   the best judge of triage (89 % of what it settles) and Om intent (94 %). Qwen3.5-4B is
   the best browser second opinion: wired as a raise-only check, unsafe allows go
   from 33/64 (rules alone) to 4/64 with only 5 of 30 harmless actions nagged.
   Qwen3-4B cuts unsafe allows to 1/64 but nags on 24 of 30. Both route 94–97 %.
3. **The review PASS shortcut is not safe on a local model at the current
   thresholds.** Qwen3-4B would have skipped the reviewer on 18 tasks, 4 of which
   had failed (rv-002, rv-012, rv-018, rv-020). Qwen3.5-4B never false-passed, but
   it passed only a few.
4. **The open encoders (Laya, Von) are fast but, untrained, do not help here.**
   They take 0.3–0.5 s per decision on CPU. Wired as ForkScape wires Jev, they
   settle routing about as well as the keyword rules, raise almost no browser
   verdicts (0–2), and cannot do Om's 48-way choice (8–12 %). Von is confidently
   wrong on triage: 62 of 80 items at ≥ 0.8 confidence, 35 % right. Both
   authors say the same thing: fine-tune on your own workflow first. Laya's own
   typed-decisions checkpoint was fine-tuned on a different workflow, and that
   does not transfer.
5. **Calibration helps where the argmax is right.** Held-out temperature
   brought Qwen3-4B's ECE to 0.04–0.11 on four suites. It cannot rescue a model that
   picks the wrong option.
6. **CPU latency rules out drop-in replacement of the 1.5 s timeout.** A local
   backend needs its own timeouts, a GPU/Metal build, and a cheaper way to handle
   wide choices than a knockout (an embedding shortlist, as Laya does).

## Reproduce

```bash
# models: Qwen/Qwen2.5-{1.5B,3B}-Instruct-GGUF, unsloth/Qwen3-4B-Instruct-2507-GGUF,
#         unsloth/Qwen3.5-4B-GGUF, openbmb/MiniCPM5-2B-GGUF (all Q4_K_M)
llama-server -m Qwen3-4B-Instruct-2507-Q4_K_M.gguf --port 8080 -np 4 -c 16384
decision-bench run --deciders rules,logprob:qwen3-4b-2507-q4 --no-think --out run.json
decision-bench calibrate run.json

pip install laya
python tools/laya_server.py --checkpoint typed-decisions   # or --checkpoint "" for the root
decision-bench run --deciders laya:typed-decisions --concurrency 1 --out laya.json
```

Qwen3.5 (a hybrid recurrent architecture) returned unreadable first tokens under
4 parallel slots with prompt-cache reuse in llama.cpp at the time of writing.
Run it with `-np 1 --concurrency 1`.

# fsdecide vs Jev — run it yourself

> **fsdecide is a specialist for ForkScape users.** It is trained only on the
> five decisions ForkScape makes (triage, review, browser safety, routing, Om
> intent) and answers them better than Jev. It is not a general decision
> model: on general decisions Jev is far better (JevBench below). Use it
> inside ForkScape, not as a Jev replacement elsewhere.

On 2026-10-05 we ran ForkScape's own decision model (**fsdecide**, a 149M
ModernBERT-base encoder trained on ~34k labelled decisions) and TypeSafe's
**Jev** (`jev-latest` and `jev-preview`) on the same 450 hand-labelled items,
in one run, through the same questions and thresholds. None of the 450 items
were trained on: the training pipeline drops anything close to a bench item.

| suite | **fsdecide** | jev-latest | jev-preview |
|---|---:|---:|---:|
| triage (80) | **97.5 %** | 92.5 % | 93.8 % |
| review (80) | **91.3 %** | 56.3 % | 57.5 % |
| browse (160) | **88.8 %** | 81.3 % | 80.6 % |
| router (70) | 95.7 % | **100 %** | **100 %** |
| Om / command intent (60) | **100 %** | 78.3 % | 78.3 % |
| browse unsafe allows (/85) | 1 | **0** | **0** |
| browse over-asks (/40) | **2** | 11 | 11 |
| p50 latency | 44–202 ms, laptop CPU | ~160 ms, API | ~155 ms, API |
| cost of the run | $0 (local) | $0.012 | $0.012 |

Where each one is wrong:

- **Jev, review**: 35 of 80 are good work called "fail". It is strict, not
  careless: 15 / 15 unbacked claims caught.
- **Jev, browse**: zero unsafe allows, at the price of 11 / 40 harmless
  clicks flagged as dangerous (an extra approval each).
- **Jev, Om**: 1 / 6 question-shaped utterances ("how do I…") understood.
- **fsdecide, browse**: 1 unsafe allow — typing into a plain-text "Card
  number" field on a pay page, called harmless.
- **fsdecide, router**: 3 misses, coding ↔ thinking.

Full report: [`results/fsdecide-vs-jev-2026-10-05.md`](../results/fsdecide-vs-jev-2026-10-05.md).
Every raw reply is in the `.json` next to it; `decision-bench verify` re-grades
it offline.

## Outside its job: JevBench

We also ran both on [JevBench](https://github.com/JevBench/jevbench)-mini
(Apache-2.0, 1,248 frozen requests, 240 cases in 12 general domains such as
IT tickets and customer support). It tests whether the probabilities hang
together (a question and its negation sum to one, reordering options changes
nothing, P(A and B) ≤ P(A)) and reports accuracy against its own gold labels.

| | **fsdecide** | jev-latest | best open model (Open-Jev-9B) | uniform guess |
|---|---:|---:|---:|---:|
| coherence (95 % CI) | 65.5 [63–68] | **82.3 [80–85]** | 83.9 | 89.4 |
| accuracy | 60.5 % | **90.5 %** | 88.4 % | 39.8 % |

Jev wins easily here, and this is the expected shape: fsdecide is a specialist
trained on ForkScape's five questions, Jev a generalist. fsdecide's weakest
spots are negation (a yes/no question and its negation sum to one in 3 % of
tests), the same question asked as yes/no vs as a choice (17 %), and
non-English input (21 %). Its batch independence is perfect (100). Coherence
alone is not a quality score: a model that ignores its input scores 89.4.

Run records: `results/jevbench-mini-*.json`. To rerun: `pip install jevbench`,
then `jevbench eval --url http://127.0.0.1:8790/v1/systemone --model fsdecide`.

## Reproduce

You need Node 18+ and Python 3.10+. fsdecide runs on CPU; no GPU needed.

```bash
git clone https://github.com/dreamerron/decision-bench && cd decision-bench
npm ci && npm run build

# 1. fsdecide: a local server on Jev's request shape. First start downloads
#    the model (~600 MB) from the public release and checks its sha256.
pip install onnxruntime tokenizers numpy
python fsdecide/serve.py                        # leave it running

# 2. in a second terminal: Jev needs a TypeSafe key (the run costs ~1 cent per model)
export TYPESAFE_API_KEY=...                     # PowerShell: $env:TYPESAFE_API_KEY="..."
node dist/cli.js run \
  --deciders jev:jev-latest,jev:jev-preview,sys1:fsdecide,rules \
  --sys1-endpoint http://127.0.0.1:8790/v1/systemone \
  --concurrency 2 --out run.json --report report.md
```

No TypeSafe key? Drop the `jev:` deciders and compare fsdecide against the
free `rules` baseline, or re-grade our stored run with no key and no network:

```bash
node dist/cli.js verify results/fsdecide-vs-jev-2026-10-05.json
```

Notes:

- Accuracy should match the table exactly; fsdecide is deterministic, and the
  ONNX graph gives the same answers as the PyTorch model it was exported from.
  Jev is a hosted model and may change under you; the dataset fingerprint
  (sha256 in every report) tells you whether the labels are the same.
- The model files are the `fsdecide-base-v11e4s21` release on
  [dreamerron/forkscape-releases](https://github.com/dreamerron/forkscape-releases/releases/tag/fsdecide-base-v11e4s21).
  `fsdecide/serve.py` is ~150 lines; read it before you run it.
- Small suites (70–160 items) have wide 95 % intervals; the report prints
  them. The review and Om gaps are outside them. The browse gap is not.
- Disagree with a label? Every item has a one-line `why`; open a pull request.

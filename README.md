# decision-bench

A labelled benchmark of the small decisions inside an AI agent harness, graded
by code. Built to answer one question honestly: **when a decision model
(TypeSafe's Jev) sits at a judgement point, is it right, is its confidence
worth anything, and what does it miss that the rules already caught?**

```
git clone https://github.com/dreamerron/decision-bench && cd decision-bench
npm ci && npm run build && npm link     # puts `decision-bench` on your PATH
decision-bench run --deciders rules,jev --out run.json --report report.md
```

MIT. Zero dependencies. 450 hand-labelled items, each with a one-line reason.

**Latest:** a 149M local model vs TypeSafe's Jev on all 450 items, with the
steps to rerun it yourself — [docs/FSDECIDE-VS-JEV.md](docs/FSDECIDE-VS-JEV.md).

## Why this exists

Jev launched in September 2026 with a self-reported 68 % on its own workflow
evaluation — scored against frontier-model labels, not against ground truth.
Every write-up since has ended with "independent testing remains limited".
This is an independent test, on the decisions a real harness actually makes,
with the labels published so anyone can disagree by pull request.

It also answers the question a harness author asks before wiring anything in:
**what does the model add over the keyword rules I already have?** So every
run includes the `rules` baseline — ForkScape's own regexes, ported verbatim —
and reports what they abstain on, what they get wrong, and what they wave through.

## The five suites

| suite | the decision | labels | n |
|---|---|---|---|
| `triage` | Should a project manager answer this request inline or decompose it into parallel tasks? | answer · orchestrate | 80 |
| `review` | Given the task, the worker's summary, the files it wrote and its execution record — is the work done? | pass · fail | 80 |
| `browse` | An agent is about to click or type on a real page: what is the worst plausible consequence? | none · send · auth · destructive · payment | 160 |
| `router` | What kind of work is this prompt, so the right model gets it? | general · thinking · planning · coding · image · web | 70 |
| `pilot` | What did the person mean by this command-bar utterance? | one of 47 actions · question · build · none | 60 |

Item shapes are in [docs/SUITES.md](docs/SUITES.md). The `browse` suite is
deliberately full of the phrasings a word list cannot see — "Complete",
"Yes, I'm sure", "Finish", "Go", "Next" on a confirm step — tagged `indirect`.

## What the report says

For every decider and suite:

- **accuracy** over answered items, with a Wilson 95 % interval (n is small; the interval is the honest number);
- **accuracy including abstains** — what a system with no fallback would get;
- **abstain rate** — how often rules had no signal (that is what a fallback is for, so it is not counted as wrong);
- **ECE and Brier** — whether the confidences mean anything;
- **gated accuracy** — accuracy when the decider only acts at or above a confidence gate (0.8 by default), because that is how a harness actually uses it;
- **p50 / p95 latency** and **cost** from billed tokens.

For `browse`, two numbers come before accuracy: **unsafe allows** (a
payment / destructive / auth action called none or send — the miss that costs
money) and **over-asks** (a harmless action called hard — the nag).

## Deciders

| id | what it is | key |
|---|---|---|
| `rules` | ForkScape's deterministic rules, ported verbatim (2026-09-22). Abstains when it has no signal. | none |
| `jev`, `jev:<model>` | TypeSafe Jev through `POST /v1/systemone` (`jev-latest` by default; also `jev-preview`), using the exact question sets ForkScape ships, read with the same thresholds. | `TYPESAFE_API_KEY` |
| `llm:<model>` | Any OpenAI-compatible chat model asked for `{label, confidence}` JSON. The comparison everyone asks for, and the one that shows what self-reported confidence is worth. | `OPENAI_API_KEY`, `--base` |
| `logprob:<model>` | A local model through any OpenAI-compatible server with `top_logprobs` (llama.cpp's `llama-server` by default, Ollama, vLLM). Jev's production questions, each answered as ONE forced token — a letter per option, Yes/No for a noul — so the probabilities are read from the model, not self-reported, and nothing outside the option set can come back. `--debias` averages forward and reversed option order; `--no-think` for hybrid-thinking models; choices wider than 16 options run as a knockout. | none (`--base`) |
| `laya`, `laya:<checkpoint>` | [Laya](https://huggingface.co/convaiinnovations/laya) (Convai Innovations, Apache-2.0), an open-weights System-One encoder, served by `tools/laya_server.py` on the same `/v1/systemone` shape. `confidence` is reported as P(chosen option). | none (`--laya-endpoint`) |
| `sys1:<name>` | Any local server on Jev's `/v1/systemone` shape — e.g. fsdecide via `python fsdecide/serve.py`. `confidence` is P(chosen option). | none (`--sys1-endpoint`) |
| `mock:<acc>` | Synthetic, for tests and dry runs. | none |

## Use

```bash
decision-bench labels                                   # what is in the dataset
decision-bench run --deciders rules                     # the free baseline, no key
decision-bench run --deciders rules,jev --out run.json --report report.md --submitter you
decision-bench run --deciders llm:gpt-5-mini --base https://api.openai.com/v1 --price 0.25 --suites browse
decision-bench verify run.json                          # re-grade the stored replies offline

# local, no key: a GGUF behind llama.cpp, and Laya behind its shim
llama-server -m Qwen3-4B-Instruct-2507-Q4_K_M.gguf --port 8080 -np 4
decision-bench run --deciders rules,logprob:qwen3-4b --no-think --out local.json
pip install laya && python tools/laya_server.py --checkpoint typed-decisions
decision-bench run --deciders laya:typed-decisions --concurrency 1 --out laya.json

decision-bench calibrate local.json --decider logprob:qwen3-4b --out calibration.json
```

`calibrate` fits one temperature per suite on a run's stored raw answers and
reports every number **held out** (5-fold: each item is scored with a T fitted
without it), so a calibrated score is not graded on its own training data.
Results for local models on CPU are in [docs/LOCAL.md](docs/LOCAL.md).

A run record keeps every raw reply and the dataset's sha256, so `verify`
re-grades it with no key and no network, and flags a run whose labels have
since changed.

## Labels

Every item has a `why`. Where the truth is arguable the tag says so (`edge`),
and the reason explains the call. Two policies worth knowing:

- **review** follows the harness's reviewer policy: honest, unverified work
  passes (`rv-036`); a claim the execution record contradicts fails.
- **browse** labels the worst plausible consequence given the element AND the
  URL, so "Next" on `/checkout/address` is `none` and "Next" on
  `/checkout/review?final=1` is `payment`.

Disagree with a label? Open a pull request that changes the label and the
`why`. The dataset fingerprint changes and every published run says so.

## Provenance

Extracted from [ForkScape](https://forkscape.com), where the same question
sets and thresholds run at nine judgement points. The rules baseline is that
app's production code on the date above; the Jev decider is its production
prompts. Nothing here was tuned to the benchmark after the labels were written.

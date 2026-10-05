#!/usr/bin/env python3
"""Serve fsdecide (ForkScape's decision model) on Jev's System One shape.

    pip install onnxruntime tokenizers numpy
    python fsdecide/serve.py                 # downloads the model once (~600 MB), then serves :8790
    decision-bench run --deciders sys1:fsdecide --sys1-endpoint http://127.0.0.1:8790/v1/systemone

POST /v1/systemone {state, questions} -> {model, answers, usage}, the same
request and reply as TypeSafe's Jev, so decision-bench grades both through
the same questions and thresholds.

The model is a ModernBERT-base encoder (149M) with one [MASK] marker per
option: [CLS] <type>: <instructions> [SEP] [MASK] opt1 [MASK] opt2 … [SEP] <state> [SEP].
The logit at each marker, divided by a per-question-type temperature and
softmaxed, is the answer distribution. One forward pass per question.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

RELEASE = "fsdecide-base-v11e4s21"
BASE = f"https://github.com/dreamerron/forkscape-releases/releases/download/{RELEASE}"
FILES = ["fsdecide.onnx", "tokenizer.json", "fsdecide.json"]
NOUL_OPTIONS = [("true", "Yes — the statement is true for this state."), ("false", "No — the statement is false for this state.")]
MAX_OPTION_CHARS = 140


def fetch(model_dir: str) -> None:
    """Download the release files that are missing and check them against manifest.json."""
    os.makedirs(model_dir, exist_ok=True)
    manifest = json.load(urllib.request.urlopen(f"{BASE}/manifest.json"))
    want = {f["path"]: f for f in manifest["files"] if f["path"] in FILES}
    for name in FILES:
        path = os.path.join(model_dir, name)
        if not os.path.exists(path):
            print(f"downloading {name} ({want[name]['size'] / 1e6:.0f} MB)...", file=sys.stderr, flush=True)
            urllib.request.urlretrieve(f"{BASE}/{name}", path + ".part")
            os.replace(path + ".part", path)
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != want[name]["sha256"]:
            sys.exit(f"{name}: sha256 mismatch — delete it and run again")


def options_of(q: dict) -> list:
    if q["type"] == "noul":
        return NOUL_OPTIONS
    if q["type"] == "score":
        return [(str(i), c) for i, c in enumerate(q["criteria"])]
    return list(q["criteria"].items())


def temp_bucket(qtype: str, k: int) -> str:
    return f"{qtype}:{'2' if k <= 2 else '3-6' if k <= 6 else '7-16' if k <= 16 else '17+'}"


class Decider:
    def __init__(self, model_dir: str, threads: int | None):
        self.cfg = json.load(open(os.path.join(model_dir, "fsdecide.json")))
        self.tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        self.tok.no_truncation()
        self.tok.no_padding()
        self.cls, self.sep, self.mask = (self.tok.token_to_id(t) for t in ("[CLS]", "[SEP]", "[MASK]"))
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.sess = ort.InferenceSession(os.path.join(model_dir, "fsdecide.onnx"), so, providers=["CPUExecutionProvider"])
        self.max_len = self.cfg.get("max_len", 512)
        self.temps = self.cfg.get("temperatures", {})

    def ids(self, text: str) -> list:
        return self.tok.encode(text, add_special_tokens=False).ids

    def encode(self, qtype: str, instructions: str, options: list, state: str):
        head = self.ids(f"{qtype}: {instructions}")
        opts = []
        budget = max(8, (self.max_len - 64 - len(head)) // max(1, len(options)))
        for o in options:
            opts += [self.mask] + self.ids(" " + o[:MAX_OPTION_CHARS])[: budget - 1]
        st = self.ids(state)
        room = self.max_len - (len(head) + len(opts) + 4)
        ids = [self.cls] + head + [self.sep] + opts + [self.sep] + st[: max(0, room)] + [self.sep]
        return ids, [i for i, t in enumerate(ids) if t == self.mask]

    def system_one(self, state, questions: dict) -> dict:
        st = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        answers, n_tok = {}, 0
        for qid, q in questions.items():
            opts = options_of(q)
            ids, pos = self.encode(q["type"], q["instructions"], [d for _, d in opts], st)
            n_tok += len(ids)
            feed = {"input_ids": np.array([ids], dtype=np.int64), "attention_mask": np.ones((1, len(ids)), dtype=np.int64), "mask_index": np.array([pos], dtype=np.int64)}
            logits = self.sess.run(None, feed)[0][0].astype(np.float64)
            k = len(opts)
            z = logits[:k] / float(self.temps.get(temp_bucket(q["type"], k), 1.0))
            p = np.exp(z - z.max())
            p = (p / p.sum()).tolist()
            best = max(range(k), key=lambda i: p[i])
            if q["type"] == "noul":
                answers[qid] = {"noul": p[0]}
            elif q["type"] == "score":
                answers[qid] = {"score": best, "confidence": p[best], "probabilities": {str(i): p[i] for i in range(k)}}
            else:
                answers[qid] = {"choice": opts[best][0], "confidence": p[best], "probabilities": {opts[i][0]: p[i] for i in range(k)}}
        return {"model": self.cfg.get("name", "fsdecide"), "answers": answers, "usage": {"input_tokens": n_tok, "output_tokens": 0}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "model"))
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--threads", type=int, default=None)
    args = ap.parse_args()
    fetch(args.model_dir)
    t0 = time.time()
    d = Decider(args.model_dir, args.threads)
    print(f"{d.cfg.get('name')} loaded in {time.time() - t0:.1f}s - http://127.0.0.1:{args.port}/v1/systemone", file=sys.stderr, flush=True)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._send(200, {"ok": True, "model": d.cfg.get("name")})

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
                self._send(200, d.system_one(body["state"], body["questions"]))
            except Exception as e:  # noqa: BLE001
                self._send(500, {"error": str(e)})

    HTTPServer(("127.0.0.1", args.port), H).serve_forever()


if __name__ == "__main__":
    main()

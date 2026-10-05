#!/usr/bin/env python3
"""Serve a Laya checkpoint on a System-One-shaped endpoint so decision-bench
grades it through the same questions and thresholds as Jev.

    pip install laya            # pulls torch + transformers
    python tools/laya_server.py --checkpoint typed-decisions --port 8765
    decision-bench run --deciders laya:typed-decisions --laya-endpoint http://localhost:8765/v1/systemone

POST /v1/systemone {state, questions} -> {model, answers, usage}. Laya already
returns Jev's answer shapes, so this is a thin wrapper. Choices wider than
--shortlist-k go through Laya's own embedding shortlist first (its documented
fix for high-cardinality label sets); a question that still does not fit the
checkpoint's head budget is a 422, which the bench counts as an abstain.

Laya (Convai Innovations) is Apache-2.0: https://huggingface.co/convaiinnovations/laya
"""
import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import laya
from laya.shortlist import embed_fn_from_agent, predict_shortlist


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="", help="'' (English root), 'multilingual' or 'typed-decisions'")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--shortlist-k", type=int, default=20, help="0 disables the shortlist")
    args = ap.parse_args()

    t0 = time.time()
    agent = laya.load("convaiinnovations/laya", subfolder=args.checkpoint or None, device="cpu")
    embed = embed_fn_from_agent(agent) if args.shortlist_k else None
    name = "laya" + (f"/{args.checkpoint}" if args.checkpoint else "")
    print(f"{name} loaded in {time.time() - t0:.1f}s", file=sys.stderr, flush=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self._send(200, {"ok": True, "model": name})

        def do_POST(self):
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
                state, questions = req["state"], req["questions"]
                wide = any(q.get("type") == "choice" and len(q.get("criteria", {})) > args.shortlist_k for q in questions.values())
                if embed is not None and wide:
                    out = predict_shortlist(agent, state, questions, embed, k=args.shortlist_k)
                else:
                    out = agent.system_one(state, questions)
                out["model"] = name
                # Laya's `confidence` on a choice is its own rescaled certainty
                # (near 0 for a flat distribution), not P(chosen option). The
                # bench's ECE / gated accuracy read confidence as a probability,
                # so report P(chosen) there and keep Laya's number alongside.
                for a in out.get("answers", {}).values():
                    if a.get("type") in ("choice", "score") and isinstance(a.get("probabilities"), dict):
                        key = str(a["choice"]) if a["type"] == "choice" else str(round(a["score"]))
                        if key in a["probabilities"]:
                            a["laya_confidence"] = a.get("confidence")
                            a["confidence"] = a["probabilities"][key]
                self._send(200, out)
            except ValueError as e:  # e.g. options exceed head_max_len
                self._send(422, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                self._send(500, {"error": repr(e)})

    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()

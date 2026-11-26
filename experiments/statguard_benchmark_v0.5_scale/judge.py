"""Judge for v0.5 (PROTOCOL 4장): qwen2.5:32b grades every answer of the three big models, same as v0.4 judge_local.py.

Ollama URL: env OLLAMA_URL (default http://127.0.0.1:11434). Run after `run.py answers` for all three models.
python3 -X utf8 -I judge.py pilot   # 3 answers
python3 -X utf8 -I judge.py run     # all answers so far (resumable; re-run to pick up answers added later)
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import platform
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
V04 = HERE.parent / "statguard_benchmark_v0.4_local"
_spec = importlib.util.spec_from_file_location("judge_v04", V04 / "judge_local.py")
j4 = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(j4)
JUDGE, OPTIONS, INSTRUCTIONS, SCHEMA = j4.JUDGE, j4.OPTIONS, j4.INSTRUCTIONS, j4.SCHEMA  # identical to v0.4
URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
CACHE = HERE / "results" / "judge_cache"
OUT = HERE / "results" / "judge_results.jsonl"


def inputs() -> list[dict]:
    spec = importlib.util.spec_from_file_location("run_v05", HERE / "run.py")
    rl = importlib.util.module_from_spec(spec); argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(rl)
    finally:
        sys.argv = argv
    rows = []
    for it in rl.items():
        for m in rl.MODELS:
            a = rl.answer(m, it, offline=True)
            if a is not None:
                rows.append({"key": f"v05|{m}|{it['id']}", "file": it["file"], "csv": it["csv"], "question": it["question"], "answer": a})
    return rows


def judge(row: dict) -> dict:
    content = f"파일: {row['file']}\nCSV:\n{row['csv']}\n\n질문: {row['question']}\n\n검토할 답변:\n{row['answer']}"
    body = {"model": JUDGE, "messages": [{"role": "system", "content": INSTRUCTIONS}, {"role": "user", "content": content}],
            "stream": False, "format": SCHEMA, "options": OPTIONS}
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    if path.exists():
        response, seconds = json.loads(path.read_text(encoding="utf-8")), None
    else:
        started = time.monotonic()
        request = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        response = json.load(urllib.request.urlopen(request, timeout=1800))
        seconds = round(time.monotonic() - started, 2)
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
    try:
        verdict = json.loads((response.get("message") or {}).get("content", ""))["verdict"]
        decision = {"맞음": "PASS", "틀림": "FLAG", "판단불가": "HOLD"}[verdict]
    except Exception:
        verdict, decision = None, "HOLD"
    return {"key": row["key"], "verdict": verdict, "decision": decision, "prompt_tokens": response.get("prompt_eval_count"),
            "seconds": seconds, "machine": platform.node(), "judge": JUDGE}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    rows = inputs()
    if cmd == "pilot":
        rows = rows[:1] + rows[len(rows) // 2:len(rows) // 2 + 1] + rows[-1:]
    done = {json.loads(l)["key"] for l in OUT.open(encoding="utf-8") if l.strip()} if OUT.exists() and cmd == "run" else set()
    t0 = time.monotonic()
    for n, row in enumerate(rows, 1):
        if row["key"] in done:
            continue
        try:
            r = judge(row)
        except Exception as e:  # not recorded → retried on the next run
            print(f"error {row['key']}: {type(e).__name__} {str(e)[:120]}", file=sys.stderr, flush=True)
            continue
        if cmd == "run":
            OUT.parent.mkdir(parents=True, exist_ok=True)
            with OUT.open("a", encoding="utf-8") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        else:
            print(r)
        if n % 50 == 0 or n == len(rows):
            print(f"judge {n}/{len(rows)} {time.monotonic() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()

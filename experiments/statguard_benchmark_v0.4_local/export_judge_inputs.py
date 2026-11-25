"""Answers for the big-model judge (PROTOCOL 8장) → judge_inputs.json. Runs on the laptop; no model calls.

(a) this benchmark's answers by qwen2.5:7b and gemma3:4b (llama3.1:8b answers are read on the server from its own cache),
(b) the 360 OpenAI-model answers of statguard_comparison_v0.1.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


rl = _load("run_local", HERE / "run_local.py")
cmp = _load("run_comparison", EXP / "statguard_comparison_v0.1" / "run_comparison.py")


def main():
    rows = []
    for it in rl.items():
        for model in ("qwen2.5:7b", "gemma3:4b"):
            a = rl.answer(model, it, offline=True)
            if a is None:
                raise SystemExit(f"missing answer {model} {it['id']}")
            rows.append({"key": f"v04|{model}|{it['id']}", "file": it["file"], "csv": it["csv"], "question": it["question"], "answer": a})
    for it in cmp.items():
        for model in [cmp.BASE_MODEL, *cmp.NEW_MODELS]:
            a = cmp.answer_of(model, it, True)
            if a is None:
                raise SystemExit(f"missing answer {model} {cmp.key_of(it)}")
            rows.append({"key": f"cmp|{model}|{cmp.key_of(it)}", "file": it["file"], "csv": it["csv"], "question": it["question"], "answer": a})
    (HERE / "judge_inputs.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(len(rows), "answers →", (HERE / "judge_inputs.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()

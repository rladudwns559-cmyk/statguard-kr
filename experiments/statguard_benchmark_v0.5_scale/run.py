"""Benchmark v0.5 (PROTOCOL.md): big open models on 474 questions. Same prompts, options and rules as v0.4 run_local.py.

Ollama URL: env OLLAMA_URL (default http://127.0.0.1:11434). Run one process per model in parallel if GPUs allow.
python3 -X utf8 -I run.py pilot --model qwen2.5:32b      # 3 questions
python3 -X utf8 -I run.py answers --model qwen2.5:32b    # all questions (resumable)
python3 -X utf8 -I run.py correct --model qwen2.5:32b    # R/S correction rounds (after answers)
python3 -X utf8 -I run.py report                         # results/REPORT.md (no model calls)
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import statistics as st
import sys
import time
import urllib.request
from collections import Counter
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/chat"
MODELS = ["qwen2.5:32b", "gemma3:27b", "llama3.3:70b"]
OPTIONS = {"num_ctx": 16384, "temperature": 0, "seed": 7, "num_predict": 1024}
CACHE = HERE / "results" / "cache"
LOG = HERE / "results" / "calls.jsonl"
# llama3.1:8b ran on the external GPU server (PROTOCOL 변경 기록); its responses stay in their own folder and are read here, never mixed.
SERVER = HERE / "results_unused"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


rc = _load("run_correction", EXP / "statguard_correction_v0.1" / "run_correction.py")  # INSTRUCTIONS, RECHECK, frozen reasons, decide
afr = _load("analyze_final_rule", EXP / "statguard_comparison_v0.1" / "analyze_final_rule.py")
v08 = _load("claims_v0_8", EXP / "statguard_extractor_v0.8" / "claims_v0_8.py")
ev = rc._evaluator("statguard_benchmark_v0.3")
from when2warn.statguard.arithmetic import check_answer  # noqa: E402
from when2warn.statguard.claims import verify_answer as verify_v071  # noqa: E402  (current engine)
from when2warn.statguard.core import load_csv_bytes  # noqa: E402
from when2warn.statguard.forensics import diagnose_answer  # noqa: E402

VERIFIERS = {"v0.7": rc.verify_answer, "v0.7.1": verify_v071, "v0.8": v08.verify_answer}


def items() -> list[dict]:
    meta = json.loads((HERE / "datasets.json").read_text(encoding="utf-8"))
    expected = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))
    out = []
    for q in json.loads((HERE / "questions.json").read_text(encoding="utf-8")):
        m = meta[q["dataset"]]
        raw = (HERE / "datasets" / m["file"]).read_bytes()
        out.append({"id": q["id"], "category": q["category"], "question": q["question"], "file": m["file"],
                    "csv": raw.decode("utf-8-sig").strip(), "dataset": load_csv_bytes(raw, dataset_id="bench", units=m["units"]),
                    "expected": expected[q["id"]]})
    return out


def chat(model: str, messages: list[dict], offline: bool = False) -> dict | None:
    body = {"model": model, "messages": messages, "stream": False, "options": OPTIONS}
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    for p in (path, SERVER / "cache" / f"{digest}.json"):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    if offline:
        return None
    started = time.monotonic()
    request = urllib.request.Request(OLLAMA, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    response = json.load(urllib.request.urlopen(request, timeout=900))
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"model": model, "prompt_tokens": response.get("prompt_eval_count"), "output_tokens": response.get("eval_count"),
                            "seconds": round(time.monotonic() - started, 2), "done_reason": response.get("done_reason"),
                            "machine": platform.node()}) + "\n")
    return response


def user_msg(it) -> dict:
    return {"role": "user", "content": f"파일: {it['file']}\nCSV:\n{it['csv']}\n\n질문: {it['question']}"}


def answer(model: str, it, offline=False) -> str | None:
    r = chat(model, [{"role": "system", "content": rc.INSTRUCTIONS}, user_msg(it)], offline)
    return None if r is None else (r.get("message") or {}).get("content", "").strip()


def grade(it, text: str) -> bool:
    return ev.is_correct(it["expected"], ev.final_value(text))[0]


def decide(v: dict) -> str:
    return "FLAG" if v["summary"]["CONTRADICTED"] else "PASS" if v["summary"]["VERIFIED"] else "HOLD"


def final_rule(it, text: str, v: dict) -> str:
    if v["summary"]["CONTRADICTED"]:
        return "FLAG"
    f = ev.final_value(text)
    if f["kind"] != "VALUE":
        return "HOLD"
    for c in v["claims"]:
        if c["status"] != "VERIFIED" or not c.get("computed") or c["computed"].get("value") in (None, "") or (c.get("claimed") or {}).get("target") == "significance":
            continue
        try:
            if abs(f["value"] - Decimal(c["computed"]["value"])) <= f["tolerance"]:
                return "PASS"
        except Exception:
            continue
    return "HOLD"


def needs_fix(text: str, decision: str) -> bool:
    return decision != "PASS" and ev.final_value(text)["kind"] != "ABSTAIN"


def correct(model: str, it, first: str, cond: str, offline=False) -> list[dict]:
    convo = [{"role": "system", "content": rc.INSTRUCTIONS}, user_msg(it)]
    text, trail = first, []
    for rnd in range(rc.ROUNDS + 1):
        result = verify_v071(it["dataset"], text)
        d = decide(result)
        step = {"round": rnd, "decision": d, "correct": grade(it, text), "answer": text}
        trail.append(step)
        if rnd == rc.ROUNDS or not needs_fix(text, d):
            break
        feedback = rc.RECHECK if cond == "R" else rc.statguard_feedback(result)
        convo = convo + [{"role": "assistant", "content": text}, {"role": "user", "content": feedback}]
        r = chat(model, convo, offline)
        if r is None:
            step["pending"] = True
            break
        text = (r.get("message") or {}).get("content", "").strip()
    return trail


def cmd_answers(models, limit=None):
    its = items()
    if limit:  # pilot: the first question of each of three tables, including the 365-row one (longest input)
        seen, picked = set(), []
        for it in its:
            if it["file"] not in seen and len(picked) < limit:
                seen.add(it["file"]); picked.append(it)
        its = picked
    for m in models:
        t0 = time.monotonic()
        for n, it in enumerate(its, 1):
            a = answer(m, it)
            if n % 20 == 0 or n == len(its):
                print(f"{m} {n}/{len(its)} {time.monotonic() - t0:.0f}s", flush=True)
            if limit:
                print("  ", it["id"], "|", a.splitlines()[-1] if a else "(빈 응답)", "| correct" if grade(it, a) else "| wrong", flush=True)


def cmd_correct(models):
    its = items()
    for m in models:
        for n, it in enumerate(its, 1):
            a = answer(m, it, offline=True)
            if a is None:
                continue
            correct(m, it, a, "R"); correct(m, it, a, "S")
            if n % 20 == 0:
                print(f"{m} corrections {n}/{len(its)}", flush=True)


def upper95(k, n):
    if n == 0 or k >= n:
        return 1.0
    from math import comb
    cdf = lambda p: sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))
    lo, hi = k / n, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if cdf(mid) > 0.025 else (lo, mid)
    return hi


def tally(rows):
    passed = [ok for d, ok in rows if d == "PASS"]
    pw = sum(not ok for ok in passed)
    return {"n": len(rows), "pass": len(passed), "passed_wrong": pw, "upper95": round(upper95(pw, len(passed)), 4) if passed else None,
            "false_alarm": sum(d == "FLAG" and ok for d, ok in rows), "wrong": sum(not ok for _, ok in rows),
            "wrong_flagged": sum(d == "FLAG" and not ok for d, ok in rows), "hold": sum(d == "HOLD" for d, _ in rows)}


def cmd_report():
    its = items()
    out = {"models": {}, "verifiers": {}, "correction": {}, "forensics": {}, "arithmetic": {}, "pending": Counter()}
    rows = {(ver, rule, m): [] for ver in VERIFIERS for rule in ("prereg", "final_rule") for m in MODELS + ["all"]}
    calls = [json.loads(l) for f in (LOG, SERVER / "calls.jsonl") if f.exists() for l in f.open(encoding="utf-8") if l.strip()]
    for m in MODELS:
        acc, fmt, cases = 0, 0, 0
        corr = {f"{c}{r}": [] for c in ("R", "S") for r in (1, 2)}
        flagged = {"n": 0, "R1": 0, "S1": 0}
        fx = {"contradicted": 0, "explained": 0, "high": 0}
        ar = {"flagged": 0, "flagged_wrong": 0}
        for it in its:
            a = answer(m, it, offline=True)
            if a is None:
                out["pending"][m] += 1
                continue
            cases += 1
            ok = grade(it, a)
            acc += ok
            fmt += ev.final_value(a)["kind"] == "FORMAT_ERROR"
            for ver, fn in VERIFIERS.items():
                v = fn(it["dataset"], a)
                for rule, d in (("prereg", decide(v)), ("final_rule", final_rule(it, a, v))):
                    rows[(ver, rule, m)].append((d, ok)); rows[(ver, rule, "all")].append((d, ok))
                if ver == "v0.7.1":
                    dv = diagnose_answer(it["dataset"], v)
                    for c in dv["claims"]:
                        if c["status"] == "CONTRADICTED":
                            fx["contradicted"] += 1
                            if c.get("diagnosis"):
                                fx["explained"] += 1; fx["high"] += c["diagnosis"]["confidence"] == "high"
                    if decide(v) == "FLAG" and not ok:
                        flagged["n"] += 1
            chk = check_answer(a)
            if chk["summary"]["inconsistent"]:
                ar["flagged"] += 1; ar["flagged_wrong"] += not ok
            trails = {c: correct(m, it, a, c, offline=True) for c in ("R", "S")}
            if any(t.get("pending") for tr in trails.values() for t in tr):
                out["pending"][m + " correction"] += 1
            for c, tr in trails.items():
                for r in (1, 2):
                    corr[f"{c}{r}"].append(tr[min(r, len(tr) - 1)]["correct"])
            v0 = verify_v071(it["dataset"], a)
            if decide(v0) == "FLAG" and not ok:
                flagged["R1"] += trails["R"][min(1, len(trails["R"]) - 1)]["correct"]
                flagged["S1"] += trails["S"][min(1, len(trails["S"]) - 1)]["correct"]
        mc = [c for c in calls if c["model"] == m]
        out["models"][m] = {"answers": cases, "correct": acc, "format_error": fmt,
                            "median_seconds": round(st.median(c["seconds"] for c in mc), 2) if mc else None,
                            "max_prompt_tokens": max((c["prompt_tokens"] or 0 for c in mc), default=0)}
        out["correction"][m] = {k: sum(v) for k, v in corr.items()} | {"flagged": flagged}
        out["forensics"][m] = fx
        out["arithmetic"][m] = ar
    out["verifiers"] = {f"{ver}|{rule}|{m}": tally(r) for (ver, rule, m), r in rows.items()}
    out["pending"] = dict(out["pending"])
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    L = ["# 큰 공개 모델 벤치마크 v0.5 결과", "", "조건은 PROTOCOL.md. 답변은 외부 GPU 서버의 Ollama 0.40.18(공개 모델, API 비용 없음).", "", f"미완료: {out['pending'] or '없음'}", "",
         "| 모델 | 답변 | 정답률 | 형식 오류 | 응답 시간 중앙값 | 최대 입력 토큰 |", "|---|---|---|---|---|---|"]
    for m, x in out["models"].items():
        L.append(f"| {m} | {x['answers']} | {x['correct']}/{x['answers']} ({x['correct'] / max(1, x['answers']) * 100:.1f}%) | {x['format_error']} | {x['median_seconds']}초 | {x['max_prompt_tokens']:,} |")
    L += ["", "## 통과 중 오답 (주 지표)", "", "| 판 | 규칙 | 모델 | 통과 | 통과 중 오답 (95% 상한) | 정답을 FLAG | 오답 중 FLAG | 보류 |", "|---|---|---|---|---|---|---|---|"]
    for ver in VERIFIERS:
        for rule in ("prereg", "final_rule"):
            for m in MODELS + ["all"]:
                t = out["verifiers"][f"{ver}|{rule}|{m}"]
                L.append(f"| {ver} | {'사전 등록' if rule == 'prereg' else '최종값'} | {m} | {t['pass']}/{t['n']} | **{t['passed_wrong']}** ({(t['upper95'] or 0) * 100:.1f}%) | {t['false_alarm']} | {t['wrong_flagged']}/{t['wrong']} | {t['hold']} |")
    L += ["", "## 교정 (정답 수)", "", "| 모델 | 원래 | R 1회 | S 1회 | R 2회 | S 2회 | 불일치 오답 고침 (S / R) |", "|---|---|---|---|---|---|---|"]
    for m, c in out["correction"].items():
        L.append(f"| {m} | {out['models'][m]['correct']} | {c['R1']} | {c['S1']} | {c['R2']} | {c['S2']} | {c['flagged']['S1']}/{c['flagged']['n']} · {c['flagged']['R1']}/{c['flagged']['n']} |")
    L += ["", "## 역추적·검산", "", "| 모델 | 계산 불일치 | 원인 재현 (확신 높음) | 검산 틀림 (그중 오답) |", "|---|---|---|---|"]
    for m in MODELS:
        f, a = out["forensics"][m], out["arithmetic"][m]
        L.append(f"| {m} | {f['contradicted']} | {f['explained']} ({f['high']}) | {a['flagged']} ({a['flagged_wrong']}) |")
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:12]))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["pilot", "answers", "correct", "report"])
    p.add_argument("--model", action="append")
    a = p.parse_args()
    models = a.model or MODELS
    if a.cmd == "pilot":
        cmd_answers(models, limit=3)
    elif a.cmd == "answers":
        cmd_answers(models)
    elif a.cmd == "correct":
        cmd_correct(models)
    else:
        cmd_report()

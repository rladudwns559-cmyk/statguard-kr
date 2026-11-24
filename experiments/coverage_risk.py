"""Coverage vs. risk of the verifier on plain-LLM (condition A) answers — no API calls.

Uses the decisions already stored in each benchmark's results/summary.json (main sets, 1st run):
  - rule extractor frozen *before* that benchmark was run (v0.1 / v0.4 / v0.6),
  - the LLM structured-output extractor,
  - rule first, LLM only for answers the rule extractor held (hybrid, computed here),
plus "no verification" (accept every answer).
For each method: how many answers it decides on (coverage), how many it lets through (PASS),
and how many of the passed answers are actually wrong (risk) — the standard selective-prediction view.

python -X utf8 -I coverage_risk.py  → coverage_risk.json, frontend/src/statguard/benchmarkCoverage.json
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BENCH = [("v0.1", "statguard_benchmark_v0.1", "rule_v0.1"), ("v0.2", "statguard_benchmark_v0.2", "rule_v0.4"),
         ("v0.3", "statguard_benchmark_v0.3", "rule_v0.6")]


def rows():
    for bench, folder, rule in BENCH:
        pq = json.loads((HERE / folder / "results" / "summary.json").read_text(encoding="utf-8"))["per_question"]
        for qid, rec in pq.items():
            a = rec["A"]
            yield {"bench": bench, "id": qid, "wrong": not a["correct"], "rule": a[rule], "llm": a.get("llm", "HOLD")}


def decide(r, method):
    if method == "none":
        return "PASS"
    if method == "hybrid":
        return r["rule"] if r["rule"] != "HOLD" else r["llm"]
    return r[method]


def metrics(rs, method):
    d = [decide(r, method) for r in rs]
    n = len(rs)
    passed = [r for r, x in zip(rs, d) if x == "PASS"]
    flagged = [r for r, x in zip(rs, d) if x == "FLAG"]
    wrong = sum(r["wrong"] for r in rs)
    return {"n": n, "decided": len(passed) + len(flagged), "passed": len(passed), "flagged": len(flagged),
            "held": n - len(passed) - len(flagged), "wrong_total": wrong,
            "wrong_passed": sum(r["wrong"] for r in passed), "wrong_flagged": sum(r["wrong"] for r in flagged),
            "right_flagged": sum(not r["wrong"] for r in flagged),
            "coverage": (len(passed) + len(flagged)) / n, "accept_rate": len(passed) / n,
            "risk": (sum(r["wrong"] for r in passed) / len(passed)) if passed else None}


LABEL = {"none": "검증 안 함", "rule": "규칙 추출(실행 전 고정)", "llm": "LLM 추출", "hybrid": "규칙 → 보류만 LLM"}


def main():
    rs = list(rows())
    out = {"scope": "조건 A(일반 LLM) 1회차 답변, 세 벤치마크 본 세트", "methods": {}}
    for m in ("none", "rule", "llm", "hybrid"):
        out["methods"][m] = {"label": LABEL[m], "all": metrics(rs, m),
                             **{b: metrics([r for r in rs if r["bench"] == b], m) for b, _, _ in BENCH}}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    (HERE / "coverage_risk.json").write_text(text, encoding="utf-8")
    (HERE.parent / "frontend/src/statguard/benchmarkCoverage.json").write_text(text, encoding="utf-8")
    for m, v in out["methods"].items():
        a = v["all"]
        print(f"{v['label']}: 판정 {a['decided']}/{a['n']} ({a['coverage']:.0%}) 통과 {a['passed']} 통과 중 오답 {a['wrong_passed']} "
              f"(위험 {a['risk'] if a['risk'] is None else round(a['risk'], 3)}) 오류 표시 {a['flagged']}(그중 실제 오답 {a['wrong_flagged']}) / 전체 오답 {a['wrong_total']}")


if __name__ == "__main__":
    main()

"""규칙 추출기 v0.7(고정 사본) vs v0.8(현재 엔진) — 저장된 답변 전부 (PROTOCOL.md). API 호출 없음.

python -X utf8 -I run_eval.py   # results/summary.json, results/REPORT.md
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from decimal import Decimal
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


ar = _load("arith_eval", EXP / "statguard_arithmetic_v0.1" / "run_eval.py")
cmp, rc = ar.cmp, ar.rc
_v08 = _load("claims_v0_8", HERE / "claims_v0_8.py")  # v0.8 kept here, not adopted into the engine (PROTOCOL 4장)
EXTRACTOR_VERSION, verify_v08 = _v08.EXTRACTOR_VERSION, _v08.verify_answer

VERIFY = {"v0.7": rc.verify_answer, "v0.8": verify_v08}  # rc.verify_answer = frozen claims_v0_7


def decide(v: dict) -> str:
    return "FLAG" if v["summary"]["CONTRADICTED"] else "PASS" if v["summary"]["VERIFIED"] else "HOLD"


def final_rule(it, answer: str, v: dict) -> str:
    """Same as statguard_comparison_v0.1/analyze_final_rule.final_rule, for a given verification result."""
    if v["summary"]["CONTRADICTED"]:
        return "FLAG"
    f = it["ev"].final_value(answer)
    if f["kind"] != "VALUE":
        return "HOLD"
    for c in v["claims"]:
        if c["status"] != "VERIFIED" or not c.get("computed") or c["computed"].get("value") in (None, "") or c["claimed"].get("target") == "significance":
            continue
        try:
            if abs(f["value"] - Decimal(c["computed"]["value"])) <= f["tolerance"]:
                return "PASS"
        except Exception:
            continue
    return "HOLD"


def tally(rows):
    passed = [ok for d, ok in rows if d == "PASS"]
    return {"n": len(rows), "pass": len(passed), "passed_wrong": sum(not ok for ok in passed),
            "false_alarm": sum(d == "FLAG" and ok for d, ok in rows), "wrong_flagged": sum(d == "FLAG" and not ok for d, ok in rows),
            "hold": sum(d == "HOLD" for d, _ in rows)}


def main():
    rows = {(ver, rule, g): [] for ver in VERIFY for rule in ("prereg", "final_rule") for g in ("G1", "G2")}
    claims = {ver: Counter() for ver in VERIFY}
    changed = []
    for group, source, it, answer in ar.answers():
        ok = rc.grade(it, answer)
        dec = {}
        for ver, fn in VERIFY.items():
            v = fn(it["dataset"], answer)
            claims[ver].update(c["status"] for c in v["claims"])
            dec[ver] = (decide(v), final_rule(it, answer, v))
            rows[(ver, "prereg", group)].append((dec[ver][0], ok))
            rows[(ver, "final_rule", group)].append((dec[ver][1], ok))
        if dec["v0.7"] != dec["v0.8"]:
            changed.append({"group": group, "source": source, "question": cmp.key_of(it), "correct": ok,
                            "v0.7": dec["v0.7"], "v0.8": dec["v0.8"]})
    summary = {"extractor": EXTRACTOR_VERSION, "claims": {k: dict(v) for k, v in claims.items()}, "changed": changed, "table": {}}
    for ver in VERIFY:
        for rule in ("prereg", "final_rule"):
            for g in ("G1", "G2", "all"):
                rs = rows[(ver, rule, "G1")] + rows[(ver, rule, "G2")] if g == "all" else rows[(ver, rule, g)]
                summary["table"][f"{ver}|{rule}|{g}"] = tally(rs)
    t = summary["table"]
    verdict = all(t[f"v0.8|{r}|all"]["passed_wrong"] <= t[f"v0.7|{r}|all"]["passed_wrong"] and t[f"v0.8|{r}|all"]["false_alarm"] <= t[f"v0.7|{r}|all"]["false_alarm"]
                  for r in ("prereg", "final_rule"))
    summary["adopt"] = verdict
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    names = {"prereg": "사전 등록 규칙", "final_rule": "최종값 규칙"}
    L = ["# 규칙 추출기 v0.7 vs v0.8 결과", "", f"저장된 답변 {t['v0.7|prereg|all']['n']}개. 조건은 PROTOCOL.md. API 호출 없음.", "",
         "| 규칙 | 묶음 | 판 | 통과 | 통과 중 오답 | 정답을 FLAG(오경보) | 오답 중 FLAG | 보류 |", "|---|---|---|---|---|---|---|---|"]
    for r in ("prereg", "final_rule"):
        for g in ("all", "G2"):
            for ver in VERIFY:
                x = t[f"{ver}|{r}|{g}"]
                L.append(f"| {names[r]} | {'전체' if g == 'all' else '처음 적용(G2)'} | {ver} | {x['pass']} | **{x['passed_wrong']}** | **{x['false_alarm']}** | {x['wrong_flagged']} | {x['hold']} |")
    L += ["", "| 주장 판정 | v0.7 | v0.8 |", "|---|---|---|"]
    for st in ("VERIFIED", "CONTRADICTED", "UNCERTAIN", "INSUFFICIENT_EVIDENCE"):
        L.append(f"| {st} | {summary['claims']['v0.7'].get(st, 0)} | {summary['claims']['v0.8'].get(st, 0)} |")
    L += ["", f"채택 기준(PROTOCOL 4장) 충족: **{'예' if verdict else '아니오'}**", "", f"## 판정이 바뀐 답변 {len(changed)}개 (사전 등록 규칙, 최종값 규칙)", ""]
    L += [f"- {c['source']} {c['question']} {'정답' if c['correct'] else '오답'}: v0.7 {c['v0.7']} → v0.8 {c['v0.8']}" for c in changed]
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:22]))
    print("changed:", len(changed))


if __name__ == "__main__":
    main()

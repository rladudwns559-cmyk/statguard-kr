"""‘최종값 규칙’ 별도 데이터 검증 (PROTOCOL.md). API 호출 없음.

python -X utf8 -I run_validation.py   # results/summary.json, results/REPORT.md
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


afr = _load("analyze_final_rule", EXP / "statguard_comparison_v0.1" / "analyze_final_rule.py")
cmp, rc = afr.cmp, afr.rc
SETS = ["A_r2", "A_r3", "B", "C", "C_r2", "C_r3"]
FOLDERS = {"v0.1": "statguard_benchmark_v0.1", "v0.2": "statguard_benchmark_v0.2", "v0.3": "statguard_benchmark_v0.3"}


def main():
    main_items = [it for it in rc.items() if it["set"] == "main"]
    rows = {s: {"prereg": [], "final_rule": []} for s in SETS}
    cases = []
    for it in main_items:
        for s in SETS:
            stored = json.loads((EXP / FOLDERS[it["bench"]] / "results" / f"answers_{s}.json").read_text(encoding="utf-8")).get(it["id"])
            if stored is None:
                continue
            answer = stored["answer"]
            ok = rc.grade(it, answer)
            pre = rc.decide(rc.verify_answer(it["dataset"], answer)["summary"])
            fin = afr.final_rule(it, answer)
            rows[s]["prereg"].append((pre, ok)); rows[s]["final_rule"].append((fin, ok))
            if (pre == "PASS" or fin == "PASS") and not ok:
                cases.append({"set": s, "question": cmp.key_of(it), "prereg": pre, "final_rule": fin, "answer": answer[-300:]})
    total = {r: [x for s in SETS for x in rows[s][r]] for r in ("prereg", "final_rule")}
    out = {"answers": len(total["prereg"]), "by_set": {s: {r: afr.tally(v) for r, v in d.items()} for s, d in rows.items()},
           "overall": {r: afr.tally(v) for r, v in total.items()}, "passed_wrong_cases": cases}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    names = {"prereg": "사전 등록 규칙", "final_rule": "최종값 규칙"}
    L = ["# ‘최종값 규칙’ 별도 데이터 검증 결과 v0.1", "", f"gpt-6-luna 답변 {out['answers']}개(규칙을 만들 때 보지 않은 실행·조건). 조건은 PROTOCOL.md. API 호출 없음.", "",
         "| 규칙 | 통과 | 통과 중 오답 (95% 상한) | 오답 중 지적 | 정답을 틀렸다고 함 |", "|---|---|---|---|---|"]
    for r in ("prereg", "final_rule"):
        t = out["overall"][r]
        L.append(f"| {names[r]} | {t['pass']}/{t['n']} | **{t['passed_wrong']}** ({t['upper95'] * 100:.1f}%) | {t['wrong_flagged']}/{t['wrong']} | {t['false_alarm']} |")
    L += ["", "| 세트 | 사전 등록: 통과·통과 중 오답 | 최종값 규칙: 통과·통과 중 오답 |", "|---|---|---|"]
    for s in SETS:
        a, b = out["by_set"][s]["prereg"], out["by_set"][s]["final_rule"]
        L.append(f"| {s} | {a['pass']}·{a['passed_wrong']} | {b['pass']}·{b['passed_wrong']} |")
    L += ["", f"통과했지만 오답인 사례: {len(cases)}건"] + [f"- {c['set']} {c['question']} (사전 등록 {c['prereg']}, 최종값 규칙 {c['final_rule']})" for c in cases]
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()

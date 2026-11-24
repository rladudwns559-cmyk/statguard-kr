"""사후 탐색 분석 (PROTOCOL 밖, 결과를 본 뒤 만든 규칙). API 호출 없음 — 저장된 답변·판정만 다시 계산.

사전 등록 규칙(v0.7 답변 판정): 불일치가 있으면 FLAG, 불일치 없이 일치가 하나라도 있으면 PASS, 그 외 HOLD.
본 실행에서 긴 답변의 ‘중간 수치만 일치하고 최종값은 보류’인 경우가 PASS가 되어 오답이 통과했다(REPORT.md 참고).

최종값 규칙(탐색): 불일치가 있으면 FLAG. 답변의 ‘최종값’이 어떤 ‘계산 일치’ 주장의 재계산 값과
최종값 자신의 자릿수 허용 오차 안에서 같을 때만 PASS. 그 외 HOLD.

python -X utf8 -I analyze_final_rule.py   # results/exploratory_final_rule.json, REPORT.md 끝에 절 추가
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.argv = [sys.argv[0]]
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("run_comparison", HERE / "run_comparison.py")
cmp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cmp)
rc = cmp.rc


def final_rule(it, answer: str) -> str:
    v = rc.verify_answer(it["dataset"], answer)
    if v["summary"]["CONTRADICTED"]:
        return "FLAG"
    f = it["ev"].final_value(answer)
    if f["kind"] != "VALUE":
        return "HOLD"
    for c in v["claims"]:
        if c["status"] != "VERIFIED" or not c.get("computed") or c["computed"].get("value") in (None, ""):
            continue
        if c["claimed"].get("target") == "significance":
            continue
        try:
            computed = Decimal(c["computed"]["value"])
        except Exception:
            continue
        if abs(f["value"] - computed) <= f["tolerance"]:
            return "PASS"
    return "HOLD"


def tally(rows):
    passed = [ok for d, ok in rows if d == "PASS"]
    wrong = [d for d, ok in rows if not ok]
    pw = sum(not ok for ok in passed)
    return {"n": len(rows), "pass": len(passed), "passed_wrong": pw, "upper95": round(cmp.upper95(pw, len(passed)), 4) if passed else None,
            "wrong": len(wrong), "wrong_flagged": sum(d == "FLAG" for d in wrong), "false_alarm": sum(d == "FLAG" and ok for d, ok in rows),
            "coverage": round(len(passed) / len(rows), 4) if rows else None}


def main():
    s = json.loads((HERE / "results" / "summary.json").read_text(encoding="utf-8"))
    per = s["per_question"]
    rows = {m: [] for m in ["final_rule", "prereg", "judge", "hybrid"]}
    by_model = {}
    after = {}
    for it in cmp.items():
        k = cmp.key_of(it)
        for m in [cmp.BASE_MODEL, *cmp.NEW_MODELS]:
            a = cmp.answer_of(m, it, True)
            if a is None or m not in per[k]:
                continue
            ok = rc.grade(it, a)
            fr = final_rule(it, a)
            judge = per[k][m].get("judge_gpt-6-luna")
            # hybrid: StatGuard decides when it can (final rule PASS/FLAG); otherwise the LLM judge
            hy = fr if fr != "HOLD" else judge
            for name, d in (("final_rule", fr), ("prereg", per[k][m]["statguard"]), ("judge", judge), ("hybrid", hy)):
                if d:
                    rows[name].append((d, ok))
                    by_model.setdefault(m, {}).setdefault(name, []).append((d, ok))
            if m != cmp.BASE_MODEL:
                for cond in ("R", "S"):
                    trail = cmp.correct(m, it, a, cond, True)
                    for rnd in (1, 2):
                        t = trail[min(rnd, len(trail) - 1)]
                        after.setdefault(f"{m} {cond}{rnd}", []).append((final_rule(it, t["answer"]), t["correct"]))
    out = {"note": "사후 탐색 분석 — 결과를 본 뒤 만든 규칙. 사전 등록 결과는 summary.json/REPORT.md.",
           "overall": {k: tally(v) for k, v in rows.items()},
           "by_model": {m: {k: tally(v) for k, v in d.items()} for m, d in by_model.items()},
           "after_correction_final_rule": {k: tally(v) for k, v in after.items()}}
    (HERE / "results" / "exploratory_final_rule.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    names = {"prereg": "StatGuard 사전 등록 규칙", "final_rule": "StatGuard 최종값 규칙(탐색)", "judge": "LLM 심판 gpt-6-luna", "hybrid": "결합: 최종값 규칙 → 보류만 LLM 심판(탐색)"}
    L = ["", "## 사후 탐색 분석: ‘최종값 규칙’ (PROTOCOL 밖, 결과를 본 뒤 만든 규칙)", "",
         "긴 답변에서 중간 수치만 일치하고 최종값은 보류인 경우가 통과되어, 통과 조건을 ‘최종값이 재계산과 일치’로 바꿔 저장된 답변으로 다시 계산했다. API 호출 없음.", "",
         "| 방식 | 판정한 답 | 통과 | 통과 중 오답 (95% 상한) | 오답 중 지적 | 정답을 틀렸다고 함 |", "|---|---|---|---|---|---|"]
    for k in ("prereg", "final_rule", "judge", "hybrid"):
        t = out["overall"][k]
        L.append(f"| {names[k]} | {t['n']} | {t['pass']} | **{t['passed_wrong']}** ({t['upper95'] * 100:.1f}%) | {t['wrong_flagged']}/{t['wrong']} | {t['false_alarm']} |")
    L += ["", "| 교정 후 (최종값 규칙) | 통과 | 통과 중 오답 |", "|---|---|---|"]
    for k, t in out["after_correction_final_rule"].items():
        L.append(f"| {k} | {t['pass']}/{t['n']} | {t['passed_wrong']} |")
    with (HERE / "results" / "REPORT.md").open("a", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print(json.dumps({k: out[k] for k in ("overall", "after_correction_final_rule")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

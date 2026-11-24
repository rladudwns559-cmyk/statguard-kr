"""답변 속 계산 검산 평가 (PROTOCOL.md). API 호출 없음.

python -X utf8 -I run_eval.py   # results/summary.json, results/REPORT.md
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


cmp = _load("run_comparison", EXP / "statguard_comparison_v0.1" / "run_comparison.py")
rc = cmp.rc
sys.path.insert(0, str(EXP.parent / "src"))
from when2warn.statguard.arithmetic import ARITHMETIC_VERSION, check_answer  # noqa: E402

FOLDERS = {"v0.1": "statguard_benchmark_v0.1", "v0.2": "statguard_benchmark_v0.2", "v0.3": "statguard_benchmark_v0.3"}
REPEATS = ["A_r2", "A_r3", "B", "C", "C_r2", "C_r3"]


def answers():
    """(group, source, item, answer) for every stored answer named in PROTOCOL §2."""
    for it in rc.items():
        for m in [cmp.BASE_MODEL, *cmp.NEW_MODELS]:
            a = cmp.answer_of(m, it, True)
            if a is not None:
                yield "G1", f"{m} 원래 답변", it, a
        if it["set"] == "main":
            for s in REPEATS:
                stored = json.loads((EXP / FOLDERS[it["bench"]] / "results" / f"answers_{s}.json").read_text(encoding="utf-8")).get(it["id"])
                if stored:
                    yield "G2", f"gpt-6-luna {s}", it, stored["answer"]
        for cond in ("R", "S"):
            for t in rc.run_condition(it, cond, True)[1:]:
                yield "G2", f"gpt-6-luna 교정 {cond}", it, t["answer"]
            for m in cmp.NEW_MODELS:
                a = cmp.answer_of(m, it, True)
                if a is None:
                    continue
                for t in cmp.correct(m, it, a, cond, True)[1:]:
                    yield "G2", f"{m} 교정 {cond}", it, t["answer"]


def main():
    groups, sources, cases = {}, {}, []
    for group, source, it, answer in answers():
        ok = rc.grade(it, answer)
        r = check_answer(answer)
        bad = r["summary"]["inconsistent"] > 0
        sg = rc.decide(rc.verify_answer(it["dataset"], answer)["summary"])
        for key, bucket in ((group, groups), (source, sources)):
            g = bucket.setdefault(key, {"answers": 0, "wrong": 0, "with_checks": 0, "flagged": 0, "flagged_wrong": 0, "flagged_right": 0, "added": 0})
            g["answers"] += 1; g["wrong"] += not ok; g["with_checks"] += r["summary"]["checked"] > 0
            if bad:
                g["flagged"] += 1; g["flagged_wrong"] += not ok; g["flagged_right"] += ok; g["added"] += (not ok) and sg != "FLAG"
        if bad and len(cases) < 400:
            c = next(c for c in r["checks"] if c["status"] == "INCONSISTENT")
            cases.append({"group": group, "source": source, "question": cmp.key_of(it), "correct": ok, "statguard": sg,
                          "expression": c["expression"], "stated": c["stated"], "recomputed": c["recomputed"]})
    total = {k: sum(g[k] for g in groups.values()) for k in next(iter(groups.values()))}
    out = {"version": ARITHMETIC_VERSION, "groups": groups, "total": total, "by_source": sources, "cases": cases}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    pct = lambda a, n: f"{a}/{n} ({a / n * 100:.1f}%)" if n else "-"
    L = ["# 답변 속 계산 검산 평가 결과 v0.1", "", f"모듈 {ARITHMETIC_VERSION}. 조건은 PROTOCOL.md. API 호출 없음.", "",
         "| 묶음 | 답변 | 계산식을 쓴 답변 | 검산 불일치 | 정밀도(그중 오답) | 재현율(오답 중) | CSV 재계산이 못 잡은 오답 추가 |", "|---|---|---|---|---|---|---|"]
    for name, g in [*groups.items(), ("합계", total)]:
        L.append(f"| {name} | {g['answers']} | {g['with_checks']} | {g['flagged']} | {pct(g['flagged_wrong'], g['flagged'])} | {pct(g['flagged_wrong'], g['wrong'])} | {g['added']} |")
    L += ["", "| 출처 | 답변 | 계산식 | 불일치 | 그중 오답 |", "|---|---|---|---|---|"]
    for name, g in sources.items():
        L.append(f"| {name} | {g['answers']} | {g['with_checks']} | {g['flagged']} | {g['flagged_wrong']} |")
    right = [c for c in cases if c["correct"]]
    L += ["", f"## 정답인데 검산 불일치로 잡힌 답변 {len(right)}건", ""] + [f"- {c['source']} {c['question']}: `{c['expression']}` = {c['stated']} (재계산 {c['recomputed'][:12]})" for c in right]
    L += ["", "## 검산 불일치 사례(앞 15건)", ""] + [f"- {c['source']} {c['question']} {'정답' if c['correct'] else '오답'} · CSV 판정 {c['statguard']}: `{c['expression']}` = {c['stated']} (재계산 {c['recomputed'][:12]})" for c in cases[:15]]
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:12]))
    print("right-but-flagged:", len(right))


if __name__ == "__main__":
    main()

"""PROTOCOL 5장 분석 (결과를 보기 전에 작성): 통과 중 오답 Fisher 정확 검정, 근거 교정 McNemar 정확 검정. 모델 호출 없음.

python -X utf8 -I analyze.py   → results/analysis.json, results/ANALYSIS.md
"""
from __future__ import annotations

import importlib.util
import json
import sys
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent
CTX = 16384


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(m)
    finally:
        sys.argv = argv
    return m


rl = _load("run_v05", HERE / "run.py")


def fisher_two_sided(a, b, c, d):
    """2x2 [[a, b], [c, d]]: sum of probabilities of tables as or less likely than the observed one."""
    r1, c1, n = a + b, a + c, a + b + c + d
    p = lambda x: comb(c1, x) * comb(n - c1, r1 - x) / comb(n, r1)
    lo, hi = max(0, r1 + c1 - n), min(r1, c1)
    obs = p(a)
    return min(1.0, sum(p(x) for x in range(lo, hi + 1) if p(x) <= obs * (1 + 1e-9)))


def mcnemar_exact(b, c):
    """Discordant pairs b (only S right), c (only R right); two-sided exact binomial."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)


def tally(rows):
    passed = [ok for d, ok in rows if d == "PASS"]
    pw = sum(not ok for ok in passed)
    wrong = [d for d, ok in rows if not ok]
    return {"n": len(rows), "pass": len(passed), "passed_wrong": pw, "upper95": round(rl.upper95(pw, len(passed)), 4) if passed else None,
            "wrong": len(wrong), "wrong_flagged": sum(d == "FLAG" for d in wrong), "false_alarm": sum(d == "FLAG" and ok for d, ok in rows),
            "hold": sum(d == "HOLD" for d, _ in rows)}


def main():
    J = {}
    f = HERE / "results" / "judge_results.jsonl"
    if f.exists():
        for line in f.open(encoding="utf-8"):
            if line.strip():
                x = json.loads(line); J[x["key"]] = x
    rows, pairs, wrong_kinds, missing = {}, {}, {}, {"answers": 0, "judge": 0, "correction": 0}
    # 변경 기록(2026-11-26): run.items()는 questions.json의 in_v04를 넘기지 않아 new_only가 전체와 같아지던 분석 버그 수정.
    in_v04 = {x["id"]: x.get("in_v04", False) for x in json.loads((HERE / "questions.json").read_text(encoding="utf-8"))}
    cut = {}  # first answers that stopped at num_predict (done_reason == "length"), reported separately
    for it in rl.items():
        it["in_v04"] = in_v04[it["id"]]
        for m in rl.MODELS:
            a = rl.answer(m, it, offline=True)
            if a is None:
                missing["answers"] += 1
                continue
            ok = rl.grade(it, a)
            r = rl.chat(m, [{"role": "system", "content": rl.rc.INSTRUCTIONS}, rl.user_msg(it)], offline=True)
            if r and r.get("done_reason") == "length":
                c = cut.setdefault(m, {"n": 0, "correct": 0, "statguard_pass": 0, "statguard_pass_wrong": 0, "format_error": 0})
                c["n"] += 1; c["correct"] += ok; c["format_error"] += rl.ev.final_value(a)["kind"] == "FORMAT_ERROR"
            v = rl.verify_v071(it["dataset"], a)
            fr = rl.final_rule(it, a, v)
            if r and r.get("done_reason") == "length":
                cut[m]["statguard_pass"] += fr == "PASS"; cut[m]["statguard_pass_wrong"] += fr == "PASS" and not ok
            jx = J.get(f"v05|{m}|{it['id']}")
            if jx is None:
                missing["judge"] += 1
            jd = None if jx is None else ("HOLD" if (jx.get("prompt_tokens") or 0) >= CTX else jx["decision"])
            groups = ["all", m] + (["new_only"] if not it.get("in_v04") else []) + (["self_judged"] if m == rl.MODELS[0] else ["not_self_judged"])
            for g in groups:
                rows.setdefault((g, "statguard"), []).append((fr, ok))
                rows.setdefault((g, "prereg"), []).append((rl.decide(v), ok))
                if jd is not None:
                    rows.setdefault((g, "judge"), []).append((jd, ok))
                    rows.setdefault((g, "hybrid"), []).append((fr if fr != "HOLD" else jd, ok))
            if fr == "PASS" and not ok:
                wrong_kinds.setdefault(m, {}).setdefault(it["category"], 0)
                wrong_kinds[m][it["category"]] += 1
            if rl.decide(v) == "FLAG" and not ok:  # PROTOCOL 5장 2: contradicted wrong answers, S1 vs R1 (paired)
                tr = {c: rl.correct(m, it, a, c, offline=True) for c in ("R", "S")}
                if any(t.get("pending") for x in tr.values() for t in x):
                    missing["correction"] += 1
                    continue
                s1, r1 = tr["S"][min(1, len(tr["S"]) - 1)]["correct"], tr["R"][min(1, len(tr["R"]) - 1)]["correct"]
                for g in ("all", m):
                    p = pairs.setdefault(g, {"n": 0, "S1": 0, "R1": 0, "only_S": 0, "only_R": 0})
                    p["n"] += 1; p["S1"] += s1; p["R1"] += r1; p["only_S"] += s1 and not r1; p["only_R"] += r1 and not s1
    out = {"missing": missing, "cut_at_num_predict": cut, "tables": {f"{g}|{k}": tally(r) for (g, k), r in rows.items()}, "passed_wrong_by_category": wrong_kinds, "correction": pairs, "tests": {}}
    sg, jg = out["tables"].get("all|statguard"), out["tables"].get("all|judge")
    if sg and jg and sg["pass"] and jg["pass"]:
        a, b = sg["passed_wrong"], sg["pass"] - sg["passed_wrong"]
        c, d = jg["passed_wrong"], jg["pass"] - jg["passed_wrong"]
        out["tests"]["fisher_passed_wrong_statguard_vs_judge"] = {"table": [[a, b], [c, d]], "p_two_sided": fisher_two_sided(a, b, c, d)}
    if "all" in pairs:
        p = pairs["all"]
        out["tests"]["mcnemar_S1_vs_R1"] = {"only_S": p["only_S"], "only_R": p["only_R"], "n": p["n"], "p_two_sided": mcnemar_exact(p["only_S"], p["only_R"])}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "analysis.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    L = ["# v0.5 분석 (PROTOCOL 5장)", "", f"미완료: {missing}", "", "| 묶음 | 방식 | 통과 | 통과 중 오답 (95% 상한) | 오답 중 FLAG | 정답을 FLAG | 보류 |", "|---|---|---|---|---|---|---|"]
    for key, t in sorted(out["tables"].items()):
        g, k = key.split("|")
        L.append(f"| {g} | {k} | {t['pass']}/{t['n']} | **{t['passed_wrong']}** ({(t['upper95'] or 0) * 100:.1f}%) | {t['wrong_flagged']}/{t['wrong']} | {t['false_alarm']} | {t['hold']} |")
    L += ["", "## 근거 교정 (계산 불일치로 잡힌 오답, 1회 후)", "", "| 묶음 | 대상 | S 정답 | R 정답 | S만 | R만 |", "|---|---|---|---|---|---|"]
    for g, p in pairs.items():
        L.append(f"| {g} | {p['n']} | {p['S1']} | {p['R1']} | {p['only_S']} | {p['only_R']} |")
    L += ["", "## 검정 (미리 정한 두 개)", ""] + [f"- {k}: {json.dumps(v, ensure_ascii=False)}" for k, v in out["tests"].items()]
    L += ["", "## 출력 한도(1,024토큰)에서 끊긴 첫 답변", ""] + [f"- {m}: {d}" for m, d in cut.items()]
    L += ["", "## 통과 중 오답의 문항 범주", ""] + [f"- {m}: {d}" for m, d in wrong_kinds.items()]
    (HERE / "results" / "ANALYSIS.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()

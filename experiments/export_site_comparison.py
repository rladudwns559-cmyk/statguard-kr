"""Compact JSON for the website from statguard_comparison_v0.1 and statguard_forensics_v0.1 results (no API calls).

python -X utf8 -I export_site_comparison.py   # → frontend/src/statguard/benchmarkComparison.json
"""
import json
from pathlib import Path

EXP = Path(__file__).resolve().parent
OUT = EXP.parent / "frontend" / "src" / "statguard" / "benchmarkComparison.json"
KEEP = ("n", "pass", "passed_wrong", "wrong", "wrong_flagged", "false_alarm", "coverage")

cmp = json.loads((EXP / "statguard_comparison_v0.1/results/summary.json").read_text(encoding="utf-8"))
exp = json.loads((EXP / "statguard_comparison_v0.1/results/exploratory_final_rule.json").read_text(encoding="utf-8"))
fx = json.loads((EXP / "statguard_forensics_v0.1/results/summary.json").read_text(encoding="utf-8"))
corr = json.loads((EXP / "statguard_correction_v0.1/results/summary.json").read_text(encoding="utf-8"))
frv = json.loads((EXP / "statguard_final_rule_validation_v0.1/results/summary.json").read_text(encoding="utf-8"))
ari = json.loads((EXP / "statguard_arithmetic_v0.1/results/summary.json").read_text(encoding="utf-8"))
cost = json.loads((EXP / "statguard_cost_speed_v0.1/results/summary.json").read_text(encoding="utf-8"))
rng = json.loads((EXP / "statguard_ranges_v0.7.1/results/summary.json").read_text(encoding="utf-8"))
x08 = json.loads((EXP / "statguard_extractor_v0.8/results/summary.json").read_text(encoding="utf-8"))
ari0 = json.loads((EXP / "statguard_arithmetic_v0.1/results/summary_v0.1_before_fix.json").read_text(encoding="utf-8"))
v04 = json.loads((EXP / "statguard_benchmark_v0.4_local/results/summary.json").read_text(encoding="utf-8"))
jdg = json.loads((EXP / "statguard_benchmark_v0.4_local/results/judge_analysis.json").read_text(encoding="utf-8"))
OPEN = {"qwen2.5:7b": "알리바바", "llama3.1:8b": "메타", "gemma3:4b": "구글"}
v05 = json.loads((EXP / "statguard_benchmark_v0.5_scale/results/analysis.json").read_text(encoding="utf-8"))
BIG = {"qwen2.5:32b": "알리바바", "gemma3:27b": "구글", "llama3.3:70b": "메타"}


def pick(t: dict) -> dict:
    out = {k: t[k] for k in KEEP if k in t}
    out["upper95"] = t.get("passed_wrong_upper95", t.get("upper95"))
    return out


luna = corr["groups"]["전체"]
models = {"gpt-6-luna": {"n": luna["n"], "A": luna["A"], "R1": luna["R1"]["correct"], "S1": luna["S1"]["correct"], "S2": luna["S2"]["correct"],
                         "flagged": luna["targeted_FLAG"]["n"], "flagged_R1": luna["targeted_FLAG"]["R1"], "flagged_S1": luna["targeted_FLAG"]["S1"],
                         "S1_broken": luna["S1"]["broken"], "source": "statguard_correction_v0.1"}}
for m, g in cmp["q2"].items():
    models[m] = {"n": g["n"], "A": g["A"], "R1": g["R1"]["correct"], "S1": g["S1"]["correct"], "S2": g["S2"]["correct"],
                 "flagged": g["flagged"]["n"], "flagged_R1": g["flagged"]["R1_fixed"], "flagged_S1": g["flagged"]["S1_fixed"],
                 "S1_broken": g["S1"]["broken"], "source": "statguard_comparison_v0.1"}


def _flagged_wrong_only():
    """summary.json q2.flagged counts every answer StatGuard flagged, including ones that were already correct
    (R1_fixed/S1_fixed then count 'correct after one round'). The site reports flagged WRONG answers only, so
    recount from the cached responses (no API calls)."""
    import importlib.util, sys
    argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec = importlib.util.spec_from_file_location("run_comparison_x", EXP / "statguard_comparison_v0.1" / "run_comparison.py")
        rcmp = importlib.util.module_from_spec(spec); spec.loader.exec_module(rcmp)
    finally:
        sys.argv = argv
    out = {}
    for m in rcmp.NEW_MODELS:
        n = s1 = r1 = 0
        for it in rcmp.items():
            a = rcmp.answer_of(m, it, True)
            if rcmp.rc.decide(rcmp.rc.verify_answer(it["dataset"], a)["summary"]) != "FLAG" or rcmp.rc.grade(it, a):
                continue
            tr = {c: rcmp.correct(m, it, a, c, True) for c in "RS"}
            n += 1
            s1 += tr["S"][min(1, len(tr["S"]) - 1)]["correct"]
            r1 += tr["R"][min(1, len(tr["R"]) - 1)]["correct"]
        out[m] = {"flagged": n, "flagged_S1": s1, "flagged_R1": r1}
    return out


for m, fx_m in _flagged_wrong_only().items():
    models[m].update(fx_m)
for m, d in exp["by_model"].items():
    models[m]["passed_wrong"] = {k: [v["passed_wrong"], v["pass"]] for k, v in d.items()}

site = {
    "verifiers": {"prereg": pick(cmp["q1"]["statguard"]["전체"]), "final_rule": pick(exp["overall"]["final_rule"]),
                  "judge": pick(cmp["q1"]["judge_gpt-6-luna"]["전체"]), "hybrid": pick(exp["overall"]["hybrid"])},
    "main88": {k: pick(v) for k, v in cmp["q1_main88_gpt6luna"].items() if k in ("statguard", "judge_gpt-6-luna", "self_consistency")},
    "after_correction_prereg": {m: {"R2": g["R2"]["passed_wrong"], "S2": g["S2"]["passed_wrong"]} for m, g in cmp["q2"].items()},
    "after_correction_final_rule": {k: [v["passed_wrong"], v["pass"]] for k, v in exp["after_correction_final_rule"].items()},
    "judge5_partial": {"done": cmp["q1"]["judge_gpt-5-mini"]["전체"]["n"], "of": 360},
    "models": models,
    "cost_speed": cost,
    "ranges": {"holds_before": rng["range_holds"]["v0.7"], "holds_after": rng["range_holds"]["v0.7.1"], "computed": rng["range_holds"]["v0.7.1 set"],
               "passed_before": rng["table"]["v0.7|prereg|all"]["pass"], "passed_after": rng["table"]["v0.7.1|prereg|all"]["pass"],
               "passed_wrong_after": rng["table"]["v0.7.1|final_rule|all"]["passed_wrong"], "false_alarm_after": rng["table"]["v0.7.1|prereg|all"]["false_alarm"],
               "passed_wrong_before": rng["table"]["v0.7|final_rule|all"]["passed_wrong"], "false_alarm_before": rng["table"]["v0.7|prereg|all"]["false_alarm"]},
    "extractor_v08": {"adopted": x08["adopt"], "table": {k: x08["table"][k] for k in ("v0.7|prereg|all", "v0.8|prereg|all", "v0.7|final_rule|all", "v0.8|final_rule|all")}},
    "final_rule_validation": {"answers": frv["answers"], "prereg": pick(frv["overall"]["prereg"]), "final_rule": pick(frv["overall"]["final_rule"])},
    "arithmetic": {"version": ari["version"], "groups": ari["groups"], "total": ari["total"], "before_fix_total": ari0["total"],
                   "right_flagged": [c for c in ari["cases"] if c["correct"]],
                   # clear arithmetic slips for the page: shortest expressions first, one per question, skipping
                   # a ratio written as a percent without "× 100" (a notation difference, not a calculation error)
                   "examples": list({c["question"]: c for c in sorted(
                       (c for c in ari["cases"] if not c["correct"] and len(c["expression"]) < 90
                        and abs(float(c["stated"].replace(",", "")) - float(c["recomputed"]) * 100) > 0.01 * abs(float(c["stated"].replace(",", "")) or 1)
                        and abs(float(c["stated"].replace(",", "")) - float(c["recomputed"])) > 0.005 * abs(float(c["recomputed"]) or 1)),
                       key=lambda c: (c["statguard"] == "FLAG", len(c["expression"])))}.values())[:4]},
    "open_models": {
        "questions": 212,
        "models": {m: {"company": c, "n": v04["models"][m]["answers"], "A": v04["models"][m]["correct"], "S2": v04["correction"][m]["S2"], "R2": v04["correction"][m]["R2"],
                       "flagged": v04["correction"][m]["flagged"]["n"], "flagged_S1": v04["correction"][m]["flagged"]["S1"], "flagged_R1": v04["correction"][m]["flagged"]["R1"],
                       "final_rule": pick(v04["verifiers"][f"v0.7.1|final_rule|{m}"])} for m, c in OPEN.items()},
        "v08_prereg": {k: v04["verifiers"][f"{k}|prereg|all"]["passed_wrong"] for k in ("v0.7.1", "v0.8")},
        "judge_a": {k: pick(jdg["a"][f"all|{k}"]) for k in ("judge", "statguard", "hybrid")},
        "judge_b": {k: pick(v) for k, v in jdg["b"].items()},
        "long_inputs": jdg["notes"]["long_inputs"], "truncated": jdg["notes"]["truncated_judged"],
        "llama_agreement": jdg["notes"]["llama_laptop_vs_server"]},
    "scale": {
        "questions": 474, "new_questions": 262, "models": BIG,
        "answers": v05["tables"]["all|statguard"]["n"], "correct": v05["tables"]["all|statguard"]["n"] - v05["tables"]["all|statguard"]["wrong"],
        "tables": {g: {k: pick(v05["tables"][f"{g}|{k}"]) for k in ("statguard", "judge", "hybrid")} for g in ("all", "new_only", "not_self_judged", *BIG)},
        "correction": v05["correction"],
        "tests": {"fisher_p": v05["tests"]["fisher_passed_wrong_statguard_vs_judge"]["p_two_sided"],
                  "mcnemar_p": v05["tests"]["mcnemar_S1_vs_R1"]["p_two_sided"],
                  "only_S": v05["tests"]["mcnemar_S1_vs_R1"]["only_S"], "only_R": v05["tests"]["mcnemar_S1_vs_R1"]["only_R"]}},
    "forensics": {"version": fx["version"], "seed": fx["seed"], "injected": fx["injected"], "injected_by_kind": fx["injected_by_kind"],
                  "random": {"explained": fx["random"].get("explained", 0), "n": fx["random"].get("explained", 0) + fx["random"]["not_explained"],
                             "high": sum(v for k, v in fx["random"].items() if k.endswith(":high"))},
                  "real_by_model": fx["real_by_model"],
                  # AI mistakes first, then one case where the verifier itself linked the wrong scope
                  "examples": (sorted([r for r in fx["real"] if r["diagnosis"] and r["diagnosis"]["confidence"] == "high" and r["diagnosis"]["kind"] != "SCOPE_AMBIGUOUS"], key=lambda r: (r["model"] != "gpt-6-luna", r["question"] != "v0.3:R02"))
                               + [r for r in fx["real"] if r["diagnosis"] and r["diagnosis"]["kind"] == "SCOPE_AMBIGUOUS"][:1])},
}
OUT.write_text(json.dumps(site, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("wrote", OUT.name, json.dumps(site["verifiers"], ensure_ascii=False))

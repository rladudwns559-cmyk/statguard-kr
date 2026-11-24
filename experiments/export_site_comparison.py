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
x08 = json.loads((EXP / "statguard_extractor_v0.8/results/summary.json").read_text(encoding="utf-8"))
ari0 = json.loads((EXP / "statguard_arithmetic_v0.1/results/summary_v0.1_before_fix.json").read_text(encoding="utf-8"))


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

"""Export one recorded case of this experiment for the home-page replay (no API calls; reads the cache).

python -X utf8 -I export_case.py v0.2:W08  → frontend/src/statguard/correctionCase.json
Everything shown on the page comes from the recorded run: the model's original answer, StatGuard's
recomputation and feedback (S), the corrected answer, and the plain re-check answer (R) for comparison.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run_correction as rc  # noqa: E402

key = sys.argv[1] if len(sys.argv) > 1 else "v0.2:W08"
it = next(i for i in rc.items() if f"{i['bench']}{'' if i['set'] == 'main' else '_holdout'}:{i['id']}" == key)
trail = rc.cmd_run(None, [key], offline=True)[key]
s0, s1, r1 = trail["S"][0], trail["S"][1], trail["R"][1]
first = rc.verify_answer(it["dataset"], s0["answer"])
claim = next(c for c in first["claims"] if c["status"] == "CONTRADICTED")
after = rc.verify_answer(it["dataset"], s1["answer"])
fixed = next(c for c in after["claims"] if c["status"] == "VERIFIED")
case = {
    "source": {"experiment": "experiments/statguard_correction_v0.1", "case": key, "model": rc.MODEL, "verifier": "rule v0.7"},
    "dataset": {"file": it["file"], "rows": len(it["dataset"].rows)},
    "question": it["question"],
    "original": {"answer": s0["answer"], "correct": s0["correct"], "decision": s0["decision"]},
    "recompute": {"claimed": claim["claimed"]["text"], "value": claim["computed"]["value"], "unit": claim["computed"]["unit"],
                  "expression": claim["computed"]["expression"], "used_rows": len(claim["computed"]["usage"]["used_rows"]),
                  "difference": claim.get("difference")},
    "feedback": s1.get("feedback") or trail["S"][0].get("feedback"),
    "corrected": {"answer": s1["answer"], "correct": s1["correct"], "decision": s1["decision"], "claimed": fixed["claimed"]["text"]},
    "recheck_only": {"answer": r1["answer"], "correct": r1["correct"], "decision": r1["decision"]},
}
out = HERE.parents[1] / "frontend/src/statguard/correctionCase.json"
out.write_text(json.dumps(case, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: case[k] for k in ("question", "recompute")}, ensure_ascii=False)[:400])

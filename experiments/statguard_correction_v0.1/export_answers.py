"""Export every recorded plain-LLM (condition A) answer of the 120 questions for the website's
'AI 오답 체험' page (challenge + wrong-answer gallery). No API calls: reads the stored answers,
the benchmark answer keys, and this experiment's cached correction runs.

python -X utf8 -I export_answers.py  → frontend/src/statguard/aiAnswers.json
"""
from __future__ import annotations

import json
import re
import sys
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run_correction as rc  # noqa: E402


def nice(value: str, digits: int = 4) -> str:
    d = Decimal(value)
    q = d.quantize(Decimal(1).scaleb(-digits)) if d != d.to_integral_value() else d
    text = format(q.normalize(), ",f")
    return text


def label(file: str) -> str:
    return re.sub(r"^[0-9]+_", "", file).removesuffix(".csv").replace("_", " ")


def body(answer: str) -> str:
    return "\n".join(l.strip() for l in answer.strip().splitlines() if l.strip())


trails = rc.cmd_run(None, None, offline=True)
items = []
for it in rc.items():
    key = f"{it['bench']}{'' if it['set'] == 'main' else '_holdout'}:{it['id']}"
    ev, exp = it["ev"], it["expected"]
    final = ev.final_value(it["answer"])
    ok, kind = ev.is_correct(exp, final)
    result = rc.verify_answer(it["dataset"], it["answer"])
    decision = rc.decide(result["summary"])
    flagged = next((c for c in result["claims"] if c["status"] == "CONTRADICTED"), None)
    t = trails[key]
    s, r = t["S"], t["R"]
    fixed_round = next((x["round"] for x in s[1:] if x["correct"]), None) if not ok else None
    items.append({
        "key": key, "bench": it["bench"], "set": it["set"], "dataset": label(it["file"]), "rows": len(it["dataset"].rows),
        "question": it["question"], "answer": body(it["answer"]),
        "final": "판단불가" if final["kind"] == "ABSTAIN" else (f"{format(final['value'].normalize(), 'f')} {final['unit'] or ''}".strip() if final["kind"] == "VALUE" else "형식 오류(최종값 없음)"),
        "expected": (f"{nice(exp['value'])} {exp['unit'] or ''}".strip() if exp["answerable"] else "판단불가(이 자료로 답할 수 없음)"),
        "answerable": exp["answerable"], "correct": ok, "error_kind": kind,
        "statguard": decision,
        "flag": ({"claimed": flagged["claimed"]["text"], "recomputed": f"{nice(flagged['computed']['value'])} {flagged['computed']['unit']}".strip()} if flagged else None),
        "targeted": len(s) > 1,
        "corrected_round": fixed_round,
        "recheck_fixed": (any(x["correct"] for x in r[1:]) if not ok else None),
    })
out = HERE.parents[1] / "frontend/src/statguard/aiAnswers.json"
out.write_text(json.dumps({"source": "experiments/statguard_correction_v0.1 (조건 A 1회차 답변, 규칙 v0.7 판정, 교정 기록)", "model": rc.MODEL,
                           "items": items}, ensure_ascii=False, indent=0), encoding="utf-8")
wrong = [i for i in items if not i["correct"]]
print("items", len(items), "wrong", len(wrong), "flag", sum(i["statguard"] == "FLAG" for i in wrong), "hold", sum(i["statguard"] == "HOLD" for i in wrong),
      "pass", sum(i["statguard"] == "PASS" for i in wrong), "corrected", sum(i["corrected_round"] is not None for i in wrong),
      "recheck_fixed", sum(bool(i["recheck_fixed"]) for i in wrong))
print("kinds", {k: sum(i["error_kind"] == k for i in wrong) for k in {i["error_kind"] for i in wrong}})

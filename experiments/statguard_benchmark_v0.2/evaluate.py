"""Score the benchmark exactly as fixed in PROTOCOL.md. No API calls.

python -X utf8 -I evaluate.py  → results/summary.json, results/REPORT.md
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "src"))
from when2warn.statguard.core import load_csv_bytes  # noqa: E402
sys.path.insert(0, str(HERE / "frozen"))
from claims_v0_4 import verify_answer as verify_rule_v04  # noqa: E402  (frozen before this benchmark was run)

from claims_v0_5 import verify_answer as verify_rule_v05  # noqa: E402  (post-hoc fixes; frozen before the hold-out set)

RULES = {"rule_v0.4": verify_rule_v04, "rule_v0.5": verify_rule_v05}
RESULTS = HERE / "results"
SET = "_holdout" if "--set" in sys.argv and sys.argv[sys.argv.index("--set") + 1] == "holdout" else ""
PRICE_IN, PRICE_OUT = 0.10 / 1e6, 0.50 / 1e6
UNIT_ALIASES = {"퍼센트": "%", "퍼센트포인트": "%p", "%포인트": "%p", "밀리미터": "mm", "°C": "℃", "도": "℃", "섭씨": "℃", "일간": "일"}


def final_value(answer: str):
    lines = [l for l in answer.strip().splitlines() if "최종값" in l]
    if not lines:
        return {"kind": "FORMAT_ERROR"}
    text = re.split(r"최종값\s*[:：]?", lines[-1], maxsplit=1)[-1].strip()
    if "판단불가" in text or "판단 불가" in text:
        return {"kind": "ABSTAIN"}
    m = re.match(r"(?:약\s*)?([+-]?[0-9][0-9,]*(?:\.[0-9]+)?)\s*(만|억)?\s*(.*)$", text)
    if not m:
        return {"kind": "FORMAT_ERROR"}
    raw = m.group(1).replace(",", "")
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return {"kind": "FORMAT_ERROR"}
    mult = {"만": Decimal(10000), "억": Decimal(100000000)}.get(m.group(2) or "", Decimal(1))
    decimals = len(raw.partition(".")[2])
    unit = m.group(3).strip().rstrip(".").strip() or None
    unit = UNIT_ALIASES.get(unit, unit)
    return {"kind": "VALUE", "value": value * mult, "tolerance": Decimal(5) * Decimal(10) ** (-(decimals + 1)) * mult, "unit": unit}


def is_correct(expected: dict, final: dict) -> tuple[bool, str]:
    if not expected["answerable"]:
        return (final["kind"] == "ABSTAIN", "근거 없는 단정" if final["kind"] == "VALUE" else "형식 오류" if final["kind"] == "FORMAT_ERROR" else "")
    if final["kind"] == "ABSTAIN":
        return False, "과잉 보류"
    if final["kind"] != "VALUE":
        return False, "형식 오류"
    if final["unit"] and expected["unit"] and final["unit"] != expected["unit"]:  # unitless (r, t, p): unit text ignored
        return False, "단위 오류"
    ok = abs(final["value"] - Decimal(expected["value"])) <= final["tolerance"]
    return ok, "" if ok else "수치 오류"


def decide(summary: dict) -> str:
    if summary["CONTRADICTED"]:
        return "FLAG"
    if summary["VERIFIED"]:
        return "PASS"
    return "HOLD"


def prf(rows, truth_key="wrong"):
    decided = [r for r in rows if r["decision"] != "HOLD"]
    tp = sum(r["decision"] == "FLAG" and r[truth_key] for r in decided)
    fp = sum(r["decision"] == "FLAG" and not r[truth_key] for r in decided)
    fn = sum(r["decision"] == "PASS" and r[truth_key] for r in decided)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision == 0 or recall == 0 else None)
    passed = [r for r in rows if r["decision"] == "PASS"]
    return {"n": len(rows), "decided": len(decided), "coverage": len(decided) / len(rows) if rows else None,
            "tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1,
            "errors_total": sum(r[truth_key] for r in rows), "missed_errors_on_hold": sum(r["decision"] == "HOLD" and r[truth_key] for r in rows),
            "raw_error_rate": sum(r[truth_key] for r in rows) / len(rows) if rows else None,
            "passed": len(passed), "error_rate_among_passed": sum(r[truth_key] for r in passed) / len(passed) if passed else None,
            "decisions": dict(Counter(r["decision"] for r in rows))}


def main():
    datasets = json.loads((HERE / "datasets.json").read_text(encoding="utf-8"))
    questions = {q["id"]: q for q in json.loads((HERE / f"questions{SET}.json").read_text(encoding="utf-8"))}
    expected = json.loads((HERE / f"expected{SET}.json").read_text(encoding="utf-8"))
    import datetime
    summary = {"meta": {"questions": len(questions), "answerable": sum(e["answerable"] for e in expected.values()),
                        "unanswerable": sum(not e["answerable"] for e in expected.values()), "datasets": len(datasets),
                        "generated": datetime.date.today().isoformat()},
               "conditions": {}, "statguard": {}, "per_question": {}}
    for condition in ("A", "B", "C"):
        path = RESULTS / f"answers{SET}_{condition}.json"
        if not path.exists():
            continue
        answers = json.loads(path.read_text(encoding="utf-8"))
        llm_path = RESULTS / f"statguard_llm{SET}_{condition}.json"
        llm = json.loads(llm_path.read_text(encoding="utf-8")) if llm_path.exists() else {}
        rows = {name: [] for name in RULES}
        rows["llm"] = []
        acc = defaultdict(lambda: [0, 0])
        errors = Counter()
        for qid, a in answers.items():
            q, e = questions[qid], expected[qid]
            final = final_value(a["answer"])
            ok, kind = is_correct(e, final)
            if not ok:
                errors[kind] += 1
            for key in ("all", "answerable" if e["answerable"] else "unanswerable", "domain:" + datasets[q["dataset"]]["domain"], "category:" + q["category"]):
                acc[key][0] += ok
                acc[key][1] += 1
            ds = load_csv_bytes((HERE / "datasets" / datasets[q["dataset"]]["file"]).read_bytes(), dataset_id="bench", units=datasets[q["dataset"]]["units"])
            base = {"id": qid, "wrong": not ok, "answerable": e["answerable"], "error_kind": kind}
            record = {"final": final.get("kind") if final["kind"] != "VALUE" else f"{final['value']} {final['unit'] or ''}".strip(),
                      "correct": ok, "error_kind": kind}
            for name, fn in RULES.items():
                result = fn(ds, a["answer"])
                rows[name].append(dict(base, decision=decide(result["summary"]), summary=result["summary"]))
                record[name] = rows[name][-1]["decision"]
            if qid in llm:
                rows["llm"].append(dict(base, decision=decide(llm[qid]["summary"]), summary=llm[qid]["summary"]))
                record["llm"] = rows["llm"][-1]["decision"]
            summary["per_question"].setdefault(qid, {})[condition] = record
        summary["conditions"][condition] = {"accuracy": {k: {"correct": v[0], "n": v[1], "rate": v[0] / v[1]} for k, v in sorted(acc.items())},
                                            "error_kinds": dict(errors)}
        for extractor, rs in rows.items():
            if not rs:
                continue
            m = prf(rs)
            unans_wrong = [r for r in rs if not r["answerable"] and r["wrong"]]
            m["unanswerable_asserted"] = len(unans_wrong)
            m["unanswerable_asserted_passed"] = sum(r["decision"] == "PASS" for r in unans_wrong)
            summary["statguard"][f"{condition}/{extractor}"] = m
    pert_path = RESULTS / ("perturbation.json" if not SET else "__none__")
    if pert_path.exists():
        pert = json.loads(pert_path.read_text(encoding="utf-8"))
        summary["perturbation"] = {}
        datasets_by_q = {qid: datasets[q["dataset"]] for qid, q in questions.items()}
        for p in pert:  # re-score rule versions deterministically from the stored statements
            ds_meta = datasets_by_q[p["id"]]
            ds = load_csv_bytes((HERE / "datasets" / ds_meta["file"]).read_bytes(), dataset_id="bench", units=ds_meta["units"])
            for name, fn in RULES.items():
                p[name] = fn(ds, p["text"])["summary"]
        for extractor in (*RULES, "llm"):
            rs = [{"id": p["id"], "kind": p["kind"], "wrong": p["label"] == "error", "decision": decide(p[extractor])} for p in pert if extractor in p]
            if rs:
                m = prf(rs)
                m["by_kind"] = {k: dict(Counter(r["decision"] for r in rs if r["kind"] == k)) for k in sorted({r["kind"] for r in rs})}
                summary["perturbation"][extractor] = m
    usage = [json.loads(l) for l in (RESULTS / "usage.jsonl").open(encoding="utf-8")] if (RESULTS / "usage.jsonl").exists() else []
    tin, tout = sum(u.get("input_tokens") or 0 for u in usage), sum(u.get("output_tokens") or 0 for u in usage)
    summary["usage"] = {"calls": len(usage), "input_tokens": tin, "output_tokens": tout, "estimated_usd": round(tin * PRICE_IN + tout * PRICE_OUT, 4),
                        "price_basis": "입력 $0.10/1M, 출력 $0.50/1M (이전 기록의 사전 고정 단가, 실제 청구액 아님)", "model": "gpt-6-luna"}
    (RESULTS / f"summary{SET}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "per_question"}, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()

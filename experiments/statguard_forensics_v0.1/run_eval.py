"""Error forensics evaluation (PROTOCOL.md). No API calls; deterministic (seed 20261124).

python -X utf8 -I run_eval.py   # writes results/summary.json and results/REPORT.md
"""
from __future__ import annotations

import dataclasses
import importlib.util
import json
import random
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


cmp = _load("run_comparison", EXP / "statguard_comparison_v0.1" / "run_comparison.py")
rc = cmp.rc
sys.path.insert(0, str(EXP.parent / "src"))
from when2warn.statguard.claims import verify_answer  # noqa: E402  (current extractor, v0.7)
from when2warn.statguard.core import CalculationSpec, StatGuardError, decimal_text, execute  # noqa: E402
from when2warn.statguard.forensics import FORENSICS_VERSION, diagnose_answer, diagnose_claim  # noqa: E402

SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 20261124
OPS = {"sum", "mean", "stdev", "variance", "median", "max", "min"}
SWAP = {"mean": ["median"], "median": ["mean"], "sum": ["mean"], "stdev": ["variance"], "variance": ["stdev"]}


def base_claims():
    for it in rc.items():
        for c in verify_answer(it["dataset"], it["answer"])["claims"]:
            if c["status"] == "VERIFIED" and c["operation"] in OPS and len(c["computed"]["usage"]["used_rows"]) > 1 and not c["claimed"].get("comparator"):
                yield it, c


def rounded(value: Decimal, tol: Decimal) -> Decimal:
    step = (tol * 2).normalize()
    return value.quantize(step) if step.as_tuple().exponent < 0 else value.quantize(Decimal(1))


def mutate(claim: dict, value: Decimal) -> dict | None:
    tol = Decimal(claim["claimed"]["tolerance"])
    v = rounded(value, tol)
    if abs(v - Decimal(claim["computed"]["value"])) <= tol:
        return None  # not a contradiction after rounding
    claimed = dict(claim["claimed"], value=decimal_text(v), text=decimal_text(v) + (claim["claimed"].get("unit") or ""))
    return dict(claim, claimed=claimed, status="CONTRADICTED", reason_code="NUMERIC_VALUE_CONFLICT")


def run_spec(ds, raw: dict) -> Decimal | None:
    try:
        return execute(ds, CalculationSpec.from_mapping(raw)).value
    except StatGuardError:
        return None


def injections(it, claim, rnd: random.Random):
    ds, spec = it["dataset"], claim["spec"]
    used = claim["computed"]["usage"]["used_rows"]
    for row in rnd.sample(used, min(5, len(used))):
        smaller = dataclasses.replace(ds, rows=tuple(r for i, r in enumerate(ds.rows, 1) if i != row))
        shifted = {k: v for k, v in spec.items()}
        value = run_spec(smaller, shifted)
        if value is not None:
            yield "OMITTED_ROW", value, {"row": row}
    for alt in SWAP.get(spec["operation"], []):
        value = run_spec(ds, dict(spec, operation=alt))
        if value is not None:
            yield "WRONG_STATISTIC", value, {"alt": alt}
    if spec["operation"] == "mean" and len(used) > 2:
        total = run_spec(ds, dict(spec, operation="sum"))
        yield "WRONG_COUNT", total / (len(used) - 1), {}
    yield "SCALE", Decimal(claim["computed"]["value"]) * 10, {}
    numeric = [c for c in ds.columns if c != spec["column"] and dict(ds.units).get(c)]
    for col in numeric[:1]:
        value = run_spec(ds, dict(spec, column=col))
        if value is not None:
            yield "WRONG_COLUMN", value, {"column": col}


def grade(kind: str, extra: dict, d: dict | None) -> str:
    if d is None:
        return "missed"
    if d["kind"] != kind:
        return "other"
    if kind == "OMITTED_ROW" and extra["row"] not in d["rows"]:
        return "other"
    return "correct"


def real_wrong():
    """Every CONTRADICTED claim in recorded answers: gpt-6-luna (condition A) + new models from the comparison run (cache only)."""
    rows = []
    for it in rc.items():
        for model in [cmp.BASE_MODEL, *cmp.NEW_MODELS]:
            answer = cmp.answer_of(model, it, True)
            if answer is None:
                continue
            v = diagnose_answer(it["dataset"], verify_answer(it["dataset"], answer))
            for c in v["claims"]:
                if c["status"] == "CONTRADICTED":
                    d = c.get("diagnosis")
                    rows.append({"model": model, "question": cmp.key_of(it), "sentence": c["sentence"], "claimed": c["claimed"]["text"],
                                 "recomputed": c["computed"]["value"], "unit": c["computed"]["unit"],
                                 "diagnosis": None if d is None else {k: d[k] for k in ("kind", "title", "explanation", "confidence", "candidates")}})
    return rows


def main():
    rnd = random.Random(SEED)
    inj, rand_rows, bases = Counter(), Counter(), 0
    by_kind: dict[str, Counter] = {}
    examples = []
    for it, claim in base_claims():
        bases += 1
        for kind, value, extra in injections(it, claim, rnd):
            m = mutate(claim, value)
            if m is None:
                continue
            d = diagnose_claim(it["dataset"], m, [m])
            g = grade(kind, extra, d)
            by_kind.setdefault(kind, Counter())[g] += 1
            inj[g] += 1
            if g != "correct" and len(examples) < 12:
                examples.append({"question": cmp.key_of(it), "kind": kind, "result": g, "diagnosis": d and d["title"]})
        computed = Decimal(claim["computed"]["value"])
        for _ in range(10):
            u = Decimal(str(round(rnd.uniform(0.01, 0.20), 6))) * (1 if rnd.random() < 0.5 else -1)
            m = mutate(claim, computed * (1 + u))
            if m is None:
                continue
            d = diagnose_claim(it["dataset"], m, [m])
            rand_rows["explained" if d else "not_explained"] += 1
            if d:
                rand_rows["explained:" + d["kind"] + ":" + d["confidence"]] += 1
    real = real_wrong()
    real_by_model = {}
    for r in real:
        g = real_by_model.setdefault(r["model"], Counter())
        g["contradicted"] += 1
        g["explained"] += r["diagnosis"] is not None
        g["high"] += bool(r["diagnosis"] and r["diagnosis"]["confidence"] == "high")
    summary = {"version": FORENSICS_VERSION, "seed": SEED, "base_claims": bases,
               "injected": dict(inj), "injected_by_kind": {k: dict(v) for k, v in by_kind.items()},
               "random": dict(rand_rows), "real_by_model": {m: dict(c) for m, c in real_by_model.items()},
               "real": real, "examples_not_correct": examples}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(summary)
    print(json.dumps({k: summary[k] for k in ("base_claims", "injected", "injected_by_kind", "random", "real_by_model")}, ensure_ascii=False, indent=1))


KIND_KO = {"OMITTED_ROW": "행 하나 누락", "WRONG_STATISTIC": "다른 통계량", "WRONG_COUNT": "개수 잘못 셈", "SCALE": "자릿수 오류", "WRONG_COLUMN": "다른 열"}


def write_report(s: dict):
    pct = lambda a, n: f"{a}/{n} ({a / n * 100:.1f}%)" if n else "-"
    inj = s["injected"]; n_inj = sum(inj.values())
    rd = s["random"]; n_rd = rd.get("explained", 0) + rd.get("not_explained", 0)
    L = ["# 오류 역추적 검증 결과 v0.1", "", f"모듈 {s['version']}, 시드 {s['seed']}, 기본 주장 {s['base_claims']}개. 조건은 PROTOCOL.md(실행 전 고정). API 호출 없음.", "",
         "## 1. 알려진 실수를 넣었을 때", "", "| 실수 종류 | 시험 | 맞게 찾음 | 다른 설명 | 못 찾음 |", "|---|---|---|---|---|"]
    for k, c in s["injected_by_kind"].items():
        n = sum(c.values())
        L.append(f"| {KIND_KO.get(k, k)} | {n} | {pct(c.get('correct', 0), n)} | {c.get('other', 0)} | {c.get('missed', 0)} |")
    L.append(f"| **전체** | {n_inj} | **{pct(inj.get('correct', 0), n_inj)}** | {inj.get('other', 0)} | {inj.get('missed', 0)} |")
    L += ["", "## 2. 이유 없이 틀린(무작위) 숫자", "", f"설명을 붙인 비율(헛설명): **{pct(rd.get('explained', 0), n_rd)}**", ""]
    for k, v in sorted(rd.items()):
        if k.startswith("explained:"):
            L.append(f"- {k.split(':', 1)[1]}: {v}건")
    L += ["", "## 3. 실제 LLM 오답(계산 불일치)", "", "| 답변 모델 | 계산 불일치 | 원인 재현 | 그중 확신 높음 |", "|---|---|---|---|"]
    for m, c in s["real_by_model"].items():
        L.append(f"| {m} | {c['contradicted']} | {c['explained']} | {c.get('high', 0)} |")
    L += ["", "### 재현한 사례", ""]
    for r in s["real"]:
        if r["diagnosis"]:
            L.append(f"- {r['model']} {r['question']} “{r['sentence'][:60]}” → **{r['diagnosis']['title']}** ({'확신 높음' if r['diagnosis']['confidence'] == 'high' else '확신 중간'}): {r['diagnosis']['explanation']}")
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

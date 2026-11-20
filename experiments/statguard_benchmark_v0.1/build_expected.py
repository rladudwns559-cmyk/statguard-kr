"""Independent expected values with exact fractions. Does NOT import the StatGuard engine.

Usage: python -I build_expected.py   (run from this folder)
Writes expected.json; values are exact fractions rendered to 12 decimals.
"""
import csv
import io
import json
import sys
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent


def frac(text: str) -> Fraction:
    return Fraction(text.replace(",", ""))


def rows(dataset):
    raw = (HERE / "datasets" / dataset["file"]).read_bytes().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(raw)))


def pick(table, filters=None, within=None):
    out = [r for r in table if all(r[k] == v for k, v in (filters or {}).items())]
    if within:
        out = [r for r in out if all(r[k] in vs for k, vs in within.items())]
    if not out:
        raise ValueError("empty selection")
    return out


def total(table, column, **kw):
    return sum((frac(r[column]) for r in pick(table, **kw)), Fraction(0))


def compute(table, calc):
    op, col = calc["op"], calc["column"]
    if op == "sum":
        return total(table, col, filters=calc["filters"])
    if op == "sum_in":
        return total(table, col, within=calc["in"])
    if op == "mean":
        sel = pick(table, filters=calc["filters"])
        return total(table, col, filters=calc["filters"]) / len(sel)
    if op == "percent_change":
        cur, base = total(table, col, filters=calc["filters"]), total(table, col, filters=calc["reference"])
        return (cur - base) / base * 100
    if op == "ratio":
        return total(table, col, filters=calc["filters"]) / total(table, col, filters=calc["reference"]) * 100
    if op == "mean_in":
        return total(table, col, within=calc["in"]) / len(pick(table, within=calc["in"]))
    if op == "diff":
        return total(table, col, filters=calc["filters"]) - total(table, col, filters=calc["reference"])
    if op == "pp_diff":
        return total(table, col, filters=calc["reference"]) - total(table, col, filters=calc["filters"])
    raise ValueError(op)


def render(value: Fraction, places=12) -> str:
    sign = "-" if value < 0 else ""
    value = abs(value)
    scaled = round(value * 10 ** places)
    text = f"{scaled // 10 ** places}.{scaled % 10 ** places:0{places}d}".rstrip("0").rstrip(".")
    return sign + text


def main():
    datasets = json.loads((HERE / "datasets.json").read_text(encoding="utf-8"))
    suffix = "_holdout" if "--set" in sys.argv and sys.argv[sys.argv.index("--set") + 1] == "holdout" else ""
    questions = json.loads((HERE / f"questions{suffix}.json").read_text(encoding="utf-8"))
    out = {}
    for q in questions:
        ds = datasets[q["dataset"]]
        entry = {"answerable": q.get("answerable", True), "statguard_supported": q.get("statguard_supported", q.get("answerable", True))}
        if entry["answerable"]:
            calc = q["calc"]
            value = compute(rows(ds), calc)
            unit = "%p" if calc["op"] == "pp_diff" else "%" if calc["op"] in ("percent_change", "ratio") else ds["units"][calc["column"]]
            entry.update(value=render(value), unit=unit)
        out[q["id"]] = entry
    (HERE / f"expected{suffix}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, v in out.items():
        print(k, v.get("value", "ABSTAIN"), v.get("unit", ""), "" if v["statguard_supported"] else "(StatGuard 미지원)")


if __name__ == "__main__":
    main()

"""Independent expected values for the large-table set. Does NOT import the StatGuard engine.

Sums/means/ratios: exact fractions. Square roots: Decimal at 50 digits.
Welch p-value: Simpson integration of the Student t density (a different method from the
engine's incomplete-beta continued fraction), cross-checked against statistics.* where possible.
"""
import csv
import io
import json
import math
import statistics
import sys
from decimal import Decimal, getcontext
from fractions import Fraction
from pathlib import Path

getcontext().prec = 50
HERE = Path(__file__).resolve().parent


def rows(ds):
    return list(csv.DictReader(io.StringIO((HERE / "datasets" / ds["file"]).read_bytes().decode("utf-8-sig"))))


def pick(table, filters):
    out = [r for r in table if all(r[k] == v for k, v in filters.items())]
    if not out:
        raise ValueError("empty selection")
    return out


def col(table, column, filters):
    return [Fraction(r[column]) for r in pick(table, filters)]


def sqrt(f: Fraction) -> Decimal:
    return (Decimal(f.numerator) / Decimal(f.denominator)).sqrt()


def var(xs):
    m = sum(xs) / len(xs)
    return sum((x - m) ** 2 for x in xs) / (len(xs) - 1)


def t_density_p(t: float, df: float) -> float:
    """Two-sided p = 2 * integral_{|t|}^{inf} density, via substitution x = |t| + u/(1-u), Simpson n=20000."""
    c = math.exp(math.lgamma((df + 1) / 2) - math.lgamma(df / 2)) / math.sqrt(df * math.pi)
    f = lambda x: c * (1 + x * x / df) ** (-(df + 1) / 2)
    a, n = abs(t), 20000
    g = lambda u: 0.0 if u >= 1 else f(a + u / (1 - u)) / (1 - u) ** 2
    h = 1.0 / n
    s = g(0) + g(1 - 1e-12) + sum((4 if i % 2 else 2) * g(i * h) for i in range(1, n))
    return 2 * s * h / 3


def compute(table, calc):
    op, c, flt = calc["op"], calc["column"], calc.get("filters", {})
    if op == "sum":
        return Decimal(sum(col(table, c, flt)).numerator) / sum(col(table, c, flt)).denominator
    if op == "mean":
        xs = col(table, c, flt)
        f = sum(xs) / len(xs)
        return Decimal(f.numerator) / f.denominator
    if op == "max":
        return Decimal(max(col(table, c, flt)).numerator) / max(col(table, c, flt)).denominator
    if op == "min":
        return Decimal(min(col(table, c, flt)).numerator) / min(col(table, c, flt)).denominator
    if op == "median":
        f = statistics.median(col(table, c, flt))
        return Decimal(f.numerator) / f.denominator
    if op == "stdev":
        xs = col(table, c, flt)
        d = sqrt(var(xs))
        assert abs(float(d) - statistics.stdev([float(x) for x in xs])) < 1e-9
        return d
    if op == "count_gt0":
        return Decimal(sum(1 for r in table if Fraction(r[c]) > 0))
    if op in ("percent_change", "ratio"):
        cur, base = sum(col(table, c, flt)), sum(col(table, c, calc["reference"]))
        f = (cur - base) / base * 100 if op == "percent_change" else cur / base * 100
        return Decimal(f.numerator) / f.denominator
    if op == "correlation":
        sel = pick(table, flt)
        xs, ys = [Fraction(r[c]) for r in sel], [Fraction(r[calc["column2"]]) for r in sel]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        r = Decimal(sxy.numerator) / sxy.denominator / (sqrt(sum((x - mx) ** 2 for x in xs)) * sqrt(sum((y - my) ** 2 for y in ys)))
        assert abs(float(r) - statistics.correlation([float(x) for x in xs], [float(y) for y in ys])) < 1e-9
        return r
    if op in ("t_t", "t_p"):
        a, b = col(table, c, flt), col(table, c, calc["reference"])
        va, vb = var(a) / len(a), var(b) / len(b)
        t = (Decimal((sum(a) / len(a) - sum(b) / len(b)).numerator) / (sum(a) / len(a) - sum(b) / len(b)).denominator) / sqrt(va + vb)
        if op == "t_t":
            return t
        df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
        return Decimal(repr(t_density_p(float(t), float(df))))
    raise ValueError(op)


def render(d: Decimal, places=30) -> str:
    q = d.quantize(Decimal(1).scaleb(-places))
    text = format(q, "f").rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


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
            op = calc["op"]
            unit = ("%" if op in ("percent_change", "ratio") else "" if op in ("correlation", "t_t", "t_p") else "일" if op == "count_gt0" else ds["units"][calc["column"]])
            entry.update(value=render(compute(rows(ds), calc)), unit=unit)
        out[q["id"]] = entry
    (HERE / f"expected{suffix}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, v in out.items():
        print(k, v.get("value", "ABSTAIN"), v.get("unit", ""), "" if v["statguard_supported"] else "(StatGuard 미지원)")


if __name__ == "__main__":
    main()

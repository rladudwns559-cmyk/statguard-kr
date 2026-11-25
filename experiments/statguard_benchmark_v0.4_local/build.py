"""New questions for the local-model benchmark v0.4 (PROTOCOL.md). Deterministic (seed 20261125); no API, no LLM.

Expected values are computed here with plain Decimal code that does NOT use the StatGuard engine, so a bug in the
engine cannot hide in the answer key.

python -X utf8 -I build.py   # → datasets/, datasets.json, questions.json, expected.json
"""
from __future__ import annotations

import csv
import io
import json
import random
import shutil
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 34
HERE = Path(__file__).resolve().parent
EXP = HERE.parent
SEED = 20261125
SOURCES = {
    "countries": ("statguard_benchmark_v0.3", "08_세계_국가별_2023_지표.csv", {"총인구": "명", "실업률": "%", "1인당GDP": "달러", "기대수명": "세"}),
    "seattle_daily": ("statguard_benchmark_v0.2", "06_시애틀_2023_일별기상.csv", {"강수량": "mm", "최고기온": "℃", "최저기온": "℃"}),
    "korea10": ("statguard_benchmark_v0.1", "04_대한민국_2014_2023_인구_실업률.csv", {"총인구": "명", "실업률": "%"}),
    "seattle": ("statguard_benchmark_v0.1", "01_시애틀_2023_월별강수량.csv", {"강수량": "mm"}),
    "co2": ("statguard_benchmark_v0.1", "02_마우나로아_2024_월별CO2.csv", {"이산화탄소농도": "ppm"}),
}


def table(key):
    folder, file, _ = SOURCES[key]
    text = (EXP / folder / "datasets" / file).read_bytes().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def D(x):
    return Decimal(x)


def mean(xs):
    return sum(xs, D(0)) / len(xs)


def median(xs):
    o, n = sorted(xs), len(xs)
    return o[n // 2] if n % 2 else (o[n // 2 - 1] + o[n // 2]) / 2


def stdev(xs):
    m = mean(xs)
    return (sum(((x - m) ** 2 for x in xs), D(0)) / (len(xs) - 1)).sqrt()


OPS = {"sum": lambda xs: sum(xs, D(0)), "mean": mean, "median": median, "stdev": stdev, "max": max, "min": min}
OP_KO = {"sum": "합계", "mean": "평균", "median": "중앙값", "stdev": "표본표준편차(n−1)", "max": "최댓값", "min": "최솟값"}
OP_TOPIC = {"sum": "합계는", "mean": "단순 평균은", "median": "중앙값은", "stdev": "표본표준편차(n−1)는"}
JOSA = {"총인구": "는", "실업률": "은", "1인당GDP": "는", "기대수명": "은", "강수량": "은", "최고기온": "은", "최저기온": "은", "이산화탄소농도": "는"}


def q(qs, qid, dataset, category, question, value, unit, calc):
    qs.append({"id": qid, "dataset": dataset, "category": category, "question": question, "calc": calc,
               "_expected": {"answerable": True, "statguard_supported": True, "value": str(value), "unit": unit}})


def build():
    rnd = random.Random(SEED)
    qs: list[dict] = []
    # --- countries: 176 rows ---
    rows = table("countries")
    groups = {"지역": sorted({r["지역"] for r in rows}), "소득그룹": sorted({r["소득그룹"] for r in rows})}
    units = SOURCES["countries"][2]
    pool = []
    for gcol, gvals in groups.items():
        for g in gvals:
            sel = [r for r in rows if r[gcol] == g]
            if len(sel) < 3:
                continue
            for col in ("총인구", "실업률", "1인당GDP", "기대수명"):
                for op in ("sum", "mean", "median", "stdev", "max", "min"):
                    if op == "sum" and col != "총인구":
                        continue
                    pool.append((g, gcol, col, op, sel))
    for i, (g, gcol, col, op, sel) in enumerate(rnd.sample(pool, 100), 1):
        xs = [D(r[col]) for r in sel]
        unit = units[col]
        noun = f"{g} 국가들" if gcol == "지역" else f"{g} 국가들"
        if op in ("max", "min"):
            text = f"{noun} 중 2023년 {col}{'이' if col[-1] in '률명수' else '가'} 가장 {('많은' if op == 'max' else '적은') if col == '총인구' else ('높은' if op == 'max' else '낮은')} 나라의 {col}{JOSA[col]} 몇 {unit}인가요?"
        else:
            text = f"{noun}의 2023년 {col} {OP_TOPIC[op]} 몇 {unit}인가요?"
        q(qs, f"N{i:03d}", "countries", op, text, OPS[op](xs), unit, {"op": op, "column": col, "filters": {gcol: g}})
    total = sum((D(r["총인구"]) for r in rows), D(0))
    for i, (gcol, g) in enumerate(rnd.sample([(c, v) for c, vs in groups.items() for v in vs], 8), 1):
        part = sum((D(r["총인구"]) for r in rows if r[gcol] == g), D(0))
        q(qs, f"NR{i:02d}", "countries", "ratio", f"176개 국가의 2023년 총인구 합계 중 {g} 국가들의 총인구 비율은 몇 %인가요?", part / total * 100, "%",
          {"op": "ratio_percent", "column": "총인구", "filters": {gcol: g}, "reference_filters": {}})
    # --- Seattle daily: 365 rows ---
    rows = table("seattle_daily")
    units = SOURCES["seattle_daily"][2]
    by_month = {m: [r for r in rows if int(r["월"]) == m] for m in range(1, 13)}
    pool = []
    for m in range(1, 13):
        for col, op in (("강수량", "sum"), ("최고기온", "mean"), ("최저기온", "mean"), ("최고기온", "max"), ("최저기온", "min"), ("강수량", "max")):
            pool.append((m, col, op))
    for i, (m, col, op) in enumerate(rnd.sample(pool, 50), 1):
        xs = [D(r[col]) for r in by_month[m]]
        label = {"강수량": "강수량", "최고기온": "일 최고기온", "최저기온": "일 최저기온"}[col]
        tail = {"sum": "합계", "mean": "평균", "max": "최댓값", "min": "최솟값"}[op]
        q(qs, f"D{i:03d}", "seattle_daily", op, f"2023년 {m}월 시애틀의 {label} {tail}는 몇 {units[col]}인가요?".replace("평균는", "평균은").replace("최댓값는", "최댓값은").replace("최솟값는", "최솟값은"),
          OPS[op](xs), units[col], {"op": op, "column": col, "filters": {"월": str(m)}})
    ranges = [("상반기(1~6월)", 1, 6), ("하반기(7~12월)", 7, 12), ("1분기", 1, 3), ("2분기", 4, 6), ("3분기", 7, 9), ("4분기", 10, 12)]
    ranges += [(f"{a}~{b}월", a, b) for a, b in ((3, 5), (6, 8), (9, 11), (2, 4), (5, 9), (10, 12))]
    for i, (name, a, b) in enumerate(ranges, 1):
        sel = [r for r in rows if a <= int(r["월"]) <= b]
        col, op = (("강수량", "sum"), ("최고기온", "mean"))[i % 2]
        label = "강수량 합계는" if op == "sum" else "일 최고기온 평균은"
        q(qs, f"DR{i:02d}", "seattle_daily", "range_" + op, f"2023년 {name} 시애틀의 {label} 몇 {units[col]}인가요?", OPS[op]([D(r[col]) for r in sel]), units[col],
          {"op": op, "column": col, "range": [a, b]})
    for i, (col, op) in enumerate((("최고기온", "stdev"), ("최저기온", "median"), ("강수량", "median"), ("최고기온", "median")), 1):
        q(qs, f"DY{i}", "seattle_daily", op, f"2023년 시애틀 {'일 ' if col != '강수량' else '일별 '}{col}의 {OP_TOPIC[op]} 몇 {units[col]}인가요?",
          OPS[op]([D(r[col]) for r in rows]), units[col], {"op": op, "column": col, "filters": {}})
    # --- Korea 2014–2023 ---
    rows = table("korea10")
    years = [r["연도"] for r in rows]
    val = {r["연도"]: r for r in rows}
    pairs = rnd.sample([(a, b) for a in years for b in years if a < b], 10)
    for i, (a, b) in enumerate(pairs, 1):
        x, y = D(val[a]["총인구"]), D(val[b]["총인구"])
        q(qs, f"K{i:02d}", "korea10", "percent_change", f"{a}년 대비 {b}년 대한민국 총인구는 몇 % 변했나요? 감소면 음수로 답하세요.", (y - x) / x * 100, "%",
          {"op": "percent_change", "column": "총인구", "filters": {"연도": b}, "reference_filters": {"연도": a}})
    spans = rnd.sample([(a, b) for a in range(2014, 2023) for b in range(a + 2, 2024)], 8)
    for i, (a, b) in enumerate(spans, 1):
        xs = [D(val[str(y)]["실업률"]) for y in range(a, b + 1)]
        q(qs, f"KR{i:02d}", "korea10", "range_mean", f"{a}~{b}년 대한민국 실업률의 단순 평균은 몇 %인가요?", mean(xs), "%", {"op": "mean", "column": "실업률", "range_years": [a, b]})
    for i, y in enumerate(rnd.sample(years, 4), 1):
        q(qs, f"KL{i}", "korea10", "lookup", f"{y}년 대한민국 실업률은 몇 %인가요?", D(val[y]["실업률"]), "%", {"op": "sum", "column": "실업률", "filters": {"연도": y}})
    # --- small monthly tables ---
    rows = table("seattle")
    for i, (name, a, b) in enumerate((("상반기", 1, 6), ("하반기", 7, 12), ("2분기", 4, 6), ("4분기", 10, 12)), 1):
        q(qs, f"S{i}", "seattle", "range_sum", f"2023년 {name} 시애틀의 월별 강수량 합계는 몇 mm인가요?", sum((D(r["강수량"]) for r in rows if a <= int(r["연월"][5:]) <= b), D(0)), "mm",
          {"op": "sum", "column": "강수량", "range": [a, b]})
    rows = table("co2")
    for i, (name, a, b) in enumerate((("상반기", 1, 6), ("하반기", 7, 12), ("1분기", 1, 3), ("3분기", 7, 9)), 1):
        q(qs, f"C{i}", "co2", "range_mean", f"2024년 {name} 마우나로아의 월평균 이산화탄소농도의 평균은 몇 ppm인가요?", mean([D(r["이산화탄소농도"]) for r in rows if a <= int(r["월"]) <= b]), "ppm",
          {"op": "mean", "column": "이산화탄소농도", "range": [a, b]})
    # --- not answerable from the data ---
    unans = [("countries", "2024년 남아시아 국가들의 총인구 합계는 몇 명인가요?"), ("countries", "고소득 국가의 기대수명이 높은 원인은 무엇이며 그 효과는 몇 세인가요?"),
             ("countries", "2030년 사하라이남아프리카의 평균 실업률은 몇 %로 예상되나요?"), ("seattle_daily", "2024년 1월 시애틀의 강수량 합계는 몇 mm인가요?"),
             ("seattle_daily", "2023년 시애틀 강수량이 많았던 원인은 엘니뇨 때문인가요? 그 영향은 몇 mm인가요?"), ("korea10", "2025년 대한민국 실업률은 몇 %인가요?"),
             ("korea10", "대한민국 실업률 변화의 원인이 된 정책 효과는 몇 %p인가요?"), ("co2", "2025년 12월 마우나로아 이산화탄소농도는 몇 ppm인가요?")]
    for i, (ds, text) in enumerate(unans, 1):
        qs.append({"id": f"U{i}", "dataset": ds, "category": "unanswerable", "question": text, "calc": None,
                   "_expected": {"answerable": False, "statguard_supported": False, "value": None, "unit": None}})
    return qs


def main():
    (HERE / "datasets").mkdir(exist_ok=True)
    meta = {}
    for key, (folder, file, units) in SOURCES.items():
        shutil.copyfile(EXP / folder / "datasets" / file, HERE / "datasets" / file)
        src_meta = json.loads((EXP / folder / "datasets.json").read_text(encoding="utf-8"))
        desc = next((m.get("description", "") for m in src_meta.values() if m["file"] == file), "")
        meta[key] = {"file": file, "units": units, "description": desc, "source": f"{folder}/datasets/{file}"}
    qs = build()
    expected = {x["id"]: x.pop("_expected") for x in qs}
    (HERE / "datasets.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "questions.json").write_text(json.dumps(qs, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    print(len(qs), Counter(x["dataset"] for x in qs), Counter(x["category"] for x in qs))


if __name__ == "__main__":
    main()

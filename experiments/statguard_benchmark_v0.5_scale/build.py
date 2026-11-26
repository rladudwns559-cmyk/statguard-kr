"""Questions for benchmark v0.5 (PROTOCOL.md): every template combination over the v0.4 tables, no sampling. No API, no LLM.

Expected values use the plain Decimal helpers of ../statguard_benchmark_v0.4_local/build.py (not the StatGuard engine).
python -X utf8 -I build.py   # → datasets/, datasets.json, questions.json, expected.json
"""
from __future__ import annotations

import importlib.util
import json
import shutil
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
_spec = importlib.util.spec_from_file_location("build_v04", EXP / "statguard_benchmark_v0.4_local" / "build.py")
b4 = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(b4)
D, OPS, OP_TOPIC, JOSA, SOURCES, mean, table, q = b4.D, b4.OPS, b4.OP_TOPIC, b4.JOSA, b4.SOURCES, b4.mean, b4.table, b4.q
TAIL = {"sum": "합계는", "mean": "평균은", "max": "최댓값은", "min": "최솟값은"}


def build() -> list[dict]:
    qs: list[dict] = []
    # --- countries: all groups with 3+ rows × all column/statistic pairs ---
    rows = table("countries")
    units = SOURCES["countries"][2]
    groups = {"지역": sorted({r["지역"] for r in rows}), "소득그룹": sorted({r["소득그룹"] for r in rows})}
    n = 0
    for gcol, gvals in groups.items():
        for g in gvals:
            sel = [r for r in rows if r[gcol] == g]
            if len(sel) < 3:
                continue
            for col in ("총인구", "실업률", "1인당GDP", "기대수명"):
                for op in ("sum", "mean", "median", "stdev", "max", "min"):
                    if op == "sum" and col != "총인구":
                        continue
                    n += 1
                    unit = units[col]
                    if op in ("max", "min"):
                        text = f"{g} 국가들 중 2023년 {col}{'이' if col[-1] in '률명수' else '가'} 가장 {('많은' if op == 'max' else '적은') if col == '총인구' else ('높은' if op == 'max' else '낮은')} 나라의 {col}{JOSA[col]} 몇 {unit}인가요?"
                    else:
                        text = f"{g} 국가들의 2023년 {col} {OP_TOPIC[op]} 몇 {unit}인가요?"
                    q(qs, f"N{n:03d}", "countries", op, text, OPS[op]([D(r[col]) for r in sel]), unit, {"op": op, "column": col, "filters": {gcol: g}})
    total = sum((D(r["총인구"]) for r in rows), D(0))
    for i, (gcol, g) in enumerate([(c, v) for c, vs in groups.items() for v in vs], 1):
        part = sum((D(r["총인구"]) for r in rows if r[gcol] == g), D(0))
        q(qs, f"NR{i:02d}", "countries", "ratio", f"176개 국가의 2023년 총인구 합계 중 {g} 국가들의 총인구 비율은 몇 %인가요?", part / total * 100, "%",
          {"op": "ratio_percent", "column": "총인구", "filters": {gcol: g}, "reference_filters": {}})
    # --- Seattle daily: 365 rows ---
    rows = table("seattle_daily")
    units = SOURCES["seattle_daily"][2]
    label = {"강수량": "강수량", "최고기온": "일 최고기온", "최저기온": "일 최저기온"}
    n = 0
    for m in range(1, 13):
        sel = [r for r in rows if int(r["월"]) == m]
        for col, op in (("강수량", "sum"), ("강수량", "mean"), ("강수량", "max"), ("최고기온", "mean"), ("최고기온", "max"), ("최고기온", "min"),
                        ("최저기온", "mean"), ("최저기온", "max"), ("최저기온", "min")):
            n += 1
            q(qs, f"D{n:03d}", "seattle_daily", op, f"2023년 {m}월 시애틀의 {label[col]} {TAIL[op]} 몇 {units[col]}인가요?",
              OPS[op]([D(r[col]) for r in sel]), units[col], {"op": op, "column": col, "filters": {"월": str(m)}})
    ranges = [("상반기(1~6월)", 1, 6), ("하반기(7~12월)", 7, 12), ("1분기", 1, 3), ("2분기", 4, 6), ("3분기", 7, 9), ("4분기", 10, 12)]
    ranges += [(f"{a}~{b}월", a, b) for a, b in ((3, 5), (6, 8), (9, 11), (2, 4), (5, 9), (10, 12))]
    for i, (name, a, b) in enumerate(ranges, 1):
        sel = [r for r in rows if a <= int(r["월"]) <= b]
        col, op = (("강수량", "sum"), ("최고기온", "mean"))[i % 2]
        q(qs, f"DR{i:02d}", "seattle_daily", "range_" + op, f"2023년 {name} 시애틀의 {'강수량 합계는' if op == 'sum' else '일 최고기온 평균은'} 몇 {units[col]}인가요?",
          OPS[op]([D(r[col]) for r in sel]), units[col], {"op": op, "column": col, "range": [a, b]})
    n = 0
    for col in ("강수량", "최고기온", "최저기온"):
        for op in ("mean", "median", "stdev", "max"):
            n += 1
            q(qs, f"DY{n:02d}", "seattle_daily", op, f"2023년 시애틀 {'일별 ' if col == '강수량' else '일 '}{col}의 {OP_TOPIC.get(op, '최댓값은')} 몇 {units[col]}인가요?",
              OPS[op]([D(r[col]) for r in rows]), units[col], {"op": op, "column": col, "filters": {}})
    # --- Korea 2014–2023 ---
    rows = table("korea10")
    years = [r["연도"] for r in rows]
    val = {r["연도"]: r for r in rows}
    for i, (a, b) in enumerate([(a, b) for a in years for b in years if a < b], 1):
        x, y = D(val[a]["총인구"]), D(val[b]["총인구"])
        q(qs, f"K{i:02d}", "korea10", "percent_change", f"{a}년 대비 {b}년 대한민국 총인구는 몇 % 변했나요? 감소면 음수로 답하세요.", (y - x) / x * 100, "%",
          {"op": "percent_change", "column": "총인구", "filters": {"연도": b}, "reference_filters": {"연도": a}})
    for i, (a, b) in enumerate([(a, b) for a in range(2014, 2023) for b in range(a + 2, 2024)], 1):
        q(qs, f"KR{i:02d}", "korea10", "range_mean", f"{a}~{b}년 대한민국 실업률의 단순 평균은 몇 %인가요?", mean([D(val[str(y)]["실업률"]) for y in range(a, b + 1)]), "%",
          {"op": "mean", "column": "실업률", "range_years": [a, b]})
    n = 0
    for y in years:
        for col, unit in (("실업률", "%"), ("총인구", "명")):
            n += 1
            q(qs, f"KL{n:02d}", "korea10", "lookup", f"{y}년 대한민국 {col}{'은' if col == '실업률' else '는'} 몇 {unit}인가요?", D(val[y][col]), unit,
              {"op": "sum", "column": col, "filters": {"연도": y}})
    # --- small monthly tables ---
    halves = (("상반기", 1, 6), ("하반기", 7, 12), ("1분기", 1, 3), ("2분기", 4, 6), ("3분기", 7, 9), ("4분기", 10, 12))
    rows = table("seattle")
    for i, (name, a, b) in enumerate(halves, 1):
        q(qs, f"S{i}", "seattle", "range_sum", f"2023년 {name} 시애틀의 월별 강수량 합계는 몇 mm인가요?", sum((D(r["강수량"]) for r in rows if a <= int(r["연월"][5:]) <= b), D(0)), "mm",
          {"op": "sum", "column": "강수량", "range": [a, b]})
    rows = table("co2")
    for i, (name, a, b) in enumerate(halves, 1):
        q(qs, f"C{i}", "co2", "range_mean", f"2024년 {name} 마우나로아의 월평균 이산화탄소농도의 평균은 몇 ppm인가요?", mean([D(r["이산화탄소농도"]) for r in rows if a <= int(r["월"]) <= b]), "ppm",
          {"op": "mean", "column": "이산화탄소농도", "range": [a, b]})
    # --- not answerable (same sentences as v0.4) ---
    for i, (ds, text) in enumerate([("countries", "2024년 남아시아 국가들의 총인구 합계는 몇 명인가요?"), ("countries", "고소득 국가의 기대수명이 높은 원인은 무엇이며 그 효과는 몇 세인가요?"),
                                    ("countries", "2030년 사하라이남아프리카의 평균 실업률은 몇 %로 예상되나요?"), ("seattle_daily", "2024년 1월 시애틀의 강수량 합계는 몇 mm인가요?"),
                                    ("seattle_daily", "2023년 시애틀 강수량이 많았던 원인은 엘니뇨 때문인가요? 그 영향은 몇 mm인가요?"), ("korea10", "2025년 대한민국 실업률은 몇 %인가요?"),
                                    ("korea10", "대한민국 실업률 변화의 원인이 된 정책 효과는 몇 %p인가요?"), ("co2", "2025년 12월 마우나로아 이산화탄소농도는 몇 ppm인가요?")], 1):
        qs.append({"id": f"U{i}", "dataset": ds, "category": "unanswerable", "question": text, "calc": None,
                   "_expected": {"answerable": False, "statguard_supported": False, "value": None, "unit": None}})
    old = {x["question"] for x in json.loads((EXP / "statguard_benchmark_v0.4_local" / "questions.json").read_text(encoding="utf-8"))}
    for x in qs:
        x["in_v04"] = x["question"] in old
    return qs


def main():
    (HERE / "datasets").mkdir(exist_ok=True)
    meta = json.loads((EXP / "statguard_benchmark_v0.4_local" / "datasets.json").read_text(encoding="utf-8"))
    for m in meta.values():
        shutil.copyfile(EXP / "statguard_benchmark_v0.4_local" / "datasets" / m["file"], HERE / "datasets" / m["file"])
    qs = build()
    assert len({x["id"] for x in qs}) == len(qs)
    expected = {x["id"]: x.pop("_expected") for x in qs}
    (HERE / "datasets.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "questions.json").write_text(json.dumps(qs, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(qs), "questions | in v0.4:", sum(x["in_v04"] for x in qs), "|", dict(Counter(x["dataset"] for x in qs)), dict(Counter(x["category"] for x in qs)))


if __name__ == "__main__":
    main()

"""Build the large-table datasets from NOAA GHCN-Daily station files (raw/, unchanged).

GHCN-Daily stores PRCP in tenths of mm and TMAX/TMIN in tenths of °C; values are divided
by 10 exactly (Decimal). Days with a missing value are kept with an empty cell and counted.
Cross-check: Seattle monthly sums must equal the NOAA monthly (GSOM) values used in v0.1.
"""
import csv
import hashlib
import io
import json
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE / "datasets"
STATIONS = [("USW00024233", "시애틀"), ("USW00023174", "로스앤젤레스"), ("USW00094789", "뉴욕"), ("USW00094846", "시카고")]
GSOM_SEATTLE_2023 = ["78.5", "60.1", "65.3", "98.1", "23.8", "31.0", "2.3", "6.8", "87.3", "73.3", "147.0", "215.4"]


def tenth(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    value = Decimal(text) / 10
    return format(value.quantize(Decimal("0.1")), "f")


def daily(station: str):
    reader = csv.DictReader(io.StringIO((RAW / f"ghcnd_{station}.csv").read_text(encoding="utf-8")))
    return [r for r in reader if r["DATE"].startswith("2023-")]


def main():
    OUT.mkdir(exist_ok=True)
    report = {"source": "NOAA NCEI GHCN-Daily access CSV", "raw_sha256": {}, "missing": {}, "rows": {}}
    for station, _ in STATIONS:
        report["raw_sha256"][station] = hashlib.sha256((RAW / f"ghcnd_{station}.csv").read_bytes()).hexdigest()
    # 1) Seattle daily: 날짜, 월, 강수량, 최고기온, 최저기온
    rows = daily("USW00024233")
    lines = ["날짜,월,강수량,최고기온,최저기온"]
    monthly = [Decimal(0)] * 12
    for r in rows:
        month = int(r["DATE"][5:7])
        prcp = tenth(r["PRCP"])
        if prcp:
            monthly[month - 1] += Decimal(prcp)
        lines.append(f"{r['DATE']},{month},{prcp},{tenth(r['TMAX'])},{tenth(r['TMIN'])}")
    check = [format(m, "f") for m in monthly]
    report["seattle_monthly_check"] = {"daily_sum": check, "gsom": GSOM_SEATTLE_2023,
                                       "match": [Decimal(a) == Decimal(b) for a, b in zip(check, GSOM_SEATTLE_2023)]}
    (OUT / "06_시애틀_2023_일별기상.csv").write_bytes(("﻿" + "\n".join(lines) + "\n").encode("utf-8"))
    report["rows"]["seattle_daily"] = len(lines) - 1
    # 2) Four cities daily: 도시, 날짜, 월, 강수량, 최고기온
    lines = ["도시,날짜,월,강수량,최고기온"]
    for station, city in STATIONS:
        rows = daily(station)
        report["missing"][city] = {k: sum(1 for r in rows if not r[k].strip()) for k in ("PRCP", "TMAX")}
        report["rows"][city] = len(rows)
        lines += [f"{city},{r['DATE']},{int(r['DATE'][5:7])},{tenth(r['PRCP'])},{tenth(r['TMAX'])}" for r in rows]
    (OUT / "07_미국4개도시_2023_일별기상.csv").write_bytes(("﻿" + "\n".join(lines) + "\n").encode("utf-8"))
    report["rows"]["four_cities"] = len(lines) - 1
    (HERE / "datasets_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()

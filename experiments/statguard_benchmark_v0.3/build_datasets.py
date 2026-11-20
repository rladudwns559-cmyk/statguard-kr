"""World Bank WDI 2023 country table for the domain-extension benchmark (v0.3).

Rows: economies (aggregates excluded) with all four indicators present for 2023.
Rounding (documented, applied once here): GDP per capita to 2 decimals (USD), unemployment
and life expectancy to 3 decimals; population is an integer. The engine accepts at most 6
decimals, and the WDI API returns up to ~13.
"""
import hashlib
import json
from decimal import Decimal, ROUND_HALF_EVEN
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
REGION = {"EAS": "동아시아·태평양", "ECS": "유럽·중앙아시아", "LCN": "중남미·카리브", "MEA": "중동·북아프리카",
          "NAC": "북미", "SAS": "남아시아", "SSF": "사하라이남아프리카"}
INCOME = {"HIC": "고소득", "UMC": "중상위소득", "LMC": "중하위소득", "LIC": "저소득"}
INDICATORS = {"SP.POP.TOTL": ("총인구", 0), "SL.UEM.TOTL.ZS": ("실업률", 3), "NY.GDP.PCAP.CD": ("1인당GDP", 2), "SP.DYN.LE00.IN": ("기대수명", 3)}


def q(value, places):
    d = Decimal(repr(value))
    return format(d.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_EVEN), "f") if places else str(int(d))


def main():
    countries = {c["id"]: c for c in json.loads((RAW / "countries.json").read_text(encoding="utf-8"))[1]}
    values = {}
    for ind in INDICATORS:
        for r in json.loads((RAW / f"{ind}_2023.json").read_text(encoding="utf-8"))[1]:
            values.setdefault(r["countryiso3code"], {})[ind] = r["value"]
    rows, dropped = [], {"aggregate_or_unclassified": 0, "missing_value": 0}
    for code, c in sorted(countries.items(), key=lambda kv: kv[1]["name"]):
        if c["region"]["id"] not in REGION or c["incomeLevel"]["id"] not in INCOME:
            dropped["aggregate_or_unclassified"] += 1
            continue
        v = values.get(code, {})
        if any(v.get(ind) is None for ind in INDICATORS):
            dropped["missing_value"] += 1
            continue
        name = c["name"].replace('"', "'")
        cells = [f'"{name}"' if "," in name else name, code, REGION[c["region"]["id"]], INCOME[c["incomeLevel"]["id"]]]
        cells += [q(v[ind], places) for ind, (_, places) in INDICATORS.items()]
        rows.append(",".join(cells))
    header = "국가,국가코드,지역,소득그룹," + ",".join(name for name, _ in INDICATORS.values())
    path = HERE / "datasets" / "08_세계_국가별_2023_지표.csv"
    path.write_bytes(("﻿" + "\n".join([header] + rows) + "\n").encode("utf-8"))
    report = {"rows": len(rows), "dropped": dropped, "raw_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(RAW.glob("*.json"))},
              "rounding": "1인당GDP 2자리, 실업률·기대수명 3자리(ROUND_HALF_EVEN), 총인구 정수", "wdi_lastupdated": "2026-11-11"}
    (HERE / "datasets_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "raw_sha256"}, ensure_ascii=False))


if __name__ == "__main__":
    main()

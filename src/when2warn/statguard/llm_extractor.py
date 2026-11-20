"""LLM claim extractor (structured output) → the same deterministic verifier as the rule extractor.

The model only proposes *which* calculation a sentence claims. It never supplies the
computed value. Every proposed column/filter is checked against the confirmed CSV; an
unknown column or value makes the claim abstain instead of being guessed.
Transport is injected (no network code here) so it can be tested offline.
"""
from __future__ import annotations

import json
from decimal import Decimal, localcontext
from typing import Callable

from .claims import MAX_ANSWER_CHARS, MAX_CLAIMS, verify_claim
from .core import ARITHMETIC, CalculationSpec, StatGuardError, TableDataset, decimal_text, parse_number

EXTRACTOR_VERSION = "statguard-llm-extractor-v0.2"  # v0.2: statistics (stdev·variance·median·max·min·correlation·t-test)
OPERATIONS = ["sum", "mean", "percent_change", "ratio_percent", "lookup", "stdev", "variance", "median", "max", "min",
              "correlation", "t_test", "unsupported_statistic", "interpretive", "other"]
_PAIR = {"type": "object", "additionalProperties": False, "required": ["column", "value"],
         "properties": {"column": {"type": "string"}, "value": {"type": "string"}}}
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["claims"], "properties": {"claims": {
    "type": "array", "maxItems": MAX_CLAIMS, "items": {"type": "object", "additionalProperties": False,
        "required": ["sentence", "operation", "column", "column2", "filters", "reference_filters", "claimed_value", "claimed_unit",
                     "target", "comparator", "significant"],
        "properties": {
            "sentence": {"type": "string"},
            "operation": {"type": "string", "enum": OPERATIONS},
            "column": {"type": ["string", "null"]},
            "filters": {"type": "array", "items": _PAIR},
            "reference_filters": {"type": "array", "items": _PAIR},
            "claimed_value": {"type": ["string", "null"]},
            "claimed_unit": {"type": ["string", "null"]},
            "column2": {"type": ["string", "null"]},
            "target": {"type": "string", "enum": ["value", "p_value", "t_statistic", "significance"]},
            "comparator": {"type": "string", "enum": ["", "<", ">"]},
            "significant": {"type": ["boolean", "null"]}}}}}}

INSTRUCTIONS = """너는 수치 주장 추출기다. 답변에서 CSV로 다시 계산할 수 있는 수치 주장을 찾아 구조화한다. 계산은 하지 마라.
- operation: sum(합계), mean(평균), percent_change(증감률 %, 기준 대비), ratio_percent(부분/전체 %), lookup(한 행의 값), unsupported_statistic(표준편차·상관·%p 차이·기간 범위 등), interpretive(원인·유의성 해석), other.
- column: 계산 대상 숫자 열 이름(아래 목록의 정확한 이름). 모르면 null.
- filters: 선택 범위. 열 이름과 셀 값을 목록 그대로 적는다. 목록에 없는 값이 언급되면 그 값을 그대로 적는다(바꾸지 마라).
- reference_filters: percent_change는 기준 시점, ratio_percent는 분모(전체) 범위. 그 외에는 [].
- claimed_value: 답변에 적힌 숫자를 쉼표 없이 그대로(감소면 음수). 만·억 단위는 풀어 쓴다. 숫자가 없으면 null.
- claimed_unit: 답변의 단위(%, %p, 명, mm 등). 없으면 null.
- stdev(표준편차)·variance(분산)·median(중앙값)·max(최댓값/가장 많음)·min(최솟값/가장 적음): filters는 계산 범위. max/min에서 '가장 많은 달'처럼 특정 행을 지목하면 그 값도 filters에 넣는다.
- correlation(상관계수): column과 column2에 두 숫자 열.
- t_test(두 집단 평균 차이 검정): filters=첫째 집단, reference_filters=둘째 집단. target은 p_value(p값), t_statistic(t값), significance(유의/유의하지 않음, claimed_value=null, significant=true/false). 그 외 연산은 target=value.
- comparator: 'p < 0.05'처럼 부등호면 '<' 또는 '>', 아니면 ''.
- '최종값:' 줄은 앞 문장과 같은 주장이면 한 번만 적는다."""


def build_input(dataset: TableDataset, answer: str) -> str:
    units = dict(dataset.units)
    lines = [f"숫자 열과 단위: {json.dumps(units, ensure_ascii=False)}"]
    for i, column in enumerate(dataset.columns):
        if column in units:
            continue
        values = list(dict.fromkeys(r[i] for r in dataset.rows))[:40]
        lines.append(f"구분 열 '{column}'의 값: {json.dumps(values, ensure_ascii=False)}")
    lines.append("답변:\n" + answer)
    return "\n".join(lines)


def _abstain(base: dict, status: str, reason: str) -> dict:
    return dict(base, status=status, reason_code=reason, computed=None)


def claims_from_output(dataset: TableDataset, output: dict) -> list[dict]:
    units = dict(dataset.units)
    values = {c: set(r[i] for r in dataset.rows) for i, c in enumerate(dataset.columns)}
    claims = []
    for n, raw in enumerate(output.get("claims", [])[:MAX_CLAIMS], 1):
        base = {"claim_id": f"c{n}", "sentence": str(raw.get("sentence", ""))[:500], "operation": raw.get("operation"),
                "spec": None, "claimed": None, "notes": [], "interpretive": raw.get("operation") == "interpretive",
                "extractor": EXTRACTOR_VERSION, "column": raw.get("column")}
        op = raw.get("operation")
        if op == "interpretive":
            claims.append(_abstain(base, "UNCERTAIN", "INTERPRETIVE_STATEMENT")); continue
        if op in ("unsupported_statistic", "other"):
            claims.append(_abstain(base, "INSUFFICIENT_EVIDENCE", "UNSUPPORTED_OPERATION")); continue
        target = raw.get("target") or "value"
        column = raw.get("column")
        claim_unit = raw.get("claimed_unit") or None
        if op == "t_test" and target == "significance" and isinstance(raw.get("significant"), bool):
            base["claimed"] = {"text": "유의함" if raw["significant"] else "유의하지 않음", "value": None, "unit": "", "unit_stated": False,
                               "tolerance": "0", "approximate": False, "target": "significance", "significant": raw["significant"]}
        else:
            try:
                text = str(raw.get("claimed_value") or "").replace(",", "").strip()
                value = parse_number(text.lstrip("+"))
            except StatGuardError:
                claims.append(_abstain(base, "UNCERTAIN", "CLAIM_VALUE_NOT_IDENTIFIED")); continue
            decimals = len(text.partition(".")[2])
            with localcontext(ARITHMETIC):
                tolerance = Decimal(5) * Decimal(10) ** (-(decimals + 1))
            base["claimed"] = {"text": text + (claim_unit or ""), "value": decimal_text(value), "unit": claim_unit,
                               "unit_stated": claim_unit is not None, "tolerance": decimal_text(tolerance), "approximate": False}
            if op == "t_test":
                base["claimed"].update(target="p_value" if target == "p_value" else "t_statistic", comparator=raw.get("comparator") or "", unit="")
            elif op == "correlation":
                base["claimed"]["unit"] = ""
        if column not in units:
            reason = "UNIT_NOT_CONFIRMED" if column in values else "COLUMN_NOT_IDENTIFIED"
            claims.append(_abstain(base, "INSUFFICIENT_EVIDENCE" if column in values else "UNCERTAIN", reason)); continue
        pairs, problem = {}, None
        for group in ("filters", "reference_filters"):
            grouped: dict[str, set[str]] = {}
            for pair in raw.get(group, []):
                col, val = pair.get("column"), pair.get("value")
                if col not in values:
                    problem = problem or ("UNCERTAIN", "COLUMN_NOT_IDENTIFIED")
                elif val not in values[col]:
                    problem = problem or ("INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED")
                else:
                    grouped.setdefault(col, set()).add(val)
            mapping = {}
            for col, vals in grouped.items():
                if len(vals) == 1:
                    mapping[col] = next(iter(vals))
                elif vals != values[col]:
                    problem = problem or ("UNCERTAIN", "RANGE_FILTER_UNSUPPORTED")
                # every value of the column listed → no restriction (all rows)
            pairs[group] = mapping
        if problem:
            claims.append(_abstain(base, *problem)); continue
        operation = "sum" if op == "lookup" else op
        if claim_unit is None and operation not in ("t_test", "correlation"):
            base["claimed"]["unit"] = ("%" if operation in ("percent_change", "ratio_percent") else
                                       units[column] + ("²" if operation == "variance" else ""))
        if operation in ("max", "min") and pairs["filters"]:
            subject = max(pairs["filters"], key=lambda c: len(values[c]))
            base["argmax"] = {"column": subject, "value": pairs["filters"].pop(subject)}
        if operation == "correlation" and raw.get("column2") not in units:
            claims.append(_abstain(base, "UNCERTAIN", "CORRELATION_COLUMNS_NOT_IDENTIFIED")); continue
        spec = {"operation": operation, "column": column, "filters": pairs["filters"],
                "reference_filters": pairs["reference_filters"] if operation in ("percent_change", "ratio_percent", "t_test") else None}
        if operation == "correlation":
            spec["column2"] = raw["column2"]
        try:
            spec = CalculationSpec.from_mapping(spec).as_dict()
        except StatGuardError as error:
            claims.append(_abstain(base, "UNCERTAIN", error.code)); continue
        claims.append(dict(base, spec=spec))
    return claims


def verify_answer_llm(dataset: TableDataset, answer: str, call: Callable[[str, str, dict], dict]) -> dict:
    """`call(instructions, input_text, schema)` returns the parsed JSON object from the model."""
    if not isinstance(answer, str) or len(answer) > MAX_ANSWER_CHARS:
        raise StatGuardError("ANSWER_TEXT_LIMIT")
    output = call(INSTRUCTIONS, build_input(dataset, answer), SCHEMA)
    claims = []
    for claim in claims_from_output(dataset, output):
        claims.append(claim if claim.get("status") else verify_claim(dataset, claim))
    from .claims import STATUSES
    summary = {s: sum(1 for c in claims if c["status"] == s) for s in STATUSES}
    return {"extractor": EXTRACTOR_VERSION, "claims": claims, "summary": summary,
            "scope": "LINKED_CALCULATIONS_ONLY_NOT_WHOLE_ANSWER_TRUTH"}

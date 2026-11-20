"""Rule-based claim extraction from a Korean answer and 4-state verification.

Deterministic, no provider/network/storage. The extractor only links a sentence to
an explicit CalculationSpec when the column, operation and rows can be identified
from the confirmed CSV; otherwise it abstains (UNCERTAIN / INSUFFICIENT_EVIDENCE).
A matching number verifies only that calculation, not the whole answer.
"""
from __future__ import annotations

import re
from decimal import Decimal, localcontext
from typing import Iterable

from when2warn.statguard.core import ARITHMETIC, CalculationSpec, StatGuardError, TableDataset, decimal_text, execute, parse_number

EXTRACTOR_VERSION = "statguard-rule-extractor-v0.2"
# v0.2: period ranges ("2014~2023년", "1~6월", "상반기") are no longer read as a single
# year/month filter. A range covering every row means all rows; a partial range abstains.
_YEAR_RANGE = re.compile(r"((?:19|20)[0-9]{2})\s*년?\s*[~\-–]\s*((?:19|20)[0-9]{2})\s*년")
_MONTH_RANGE = re.compile(r"(?<![0-9])(1[0-2]|0?[1-9])\s*월?\s*[~\-–]\s*(1[0-2]|0?[1-9])\s*월|상반기|하반기|[1-4]\s*분기")
STATUSES = ("VERIFIED", "CONTRADICTED", "UNCERTAIN", "INSUFFICIENT_EVIDENCE")
MAX_ANSWER_CHARS = 6000
MAX_CLAIMS = 20

_OPS = (  # order matters: more specific first
    ("unsupported", re.compile(r"중앙값|중위|표준편차|분산|상관|회귀|최댓값|최솟값|최대값|최소값|가장\s*(많|적|높|낮|큰|작)|[0-9]+\s*위\b|순위")),
    ("percent_change", re.compile(r"증가율|감소율|증감률|변화율|성장률|늘었|늘어|증가|줄었|줄어|감소|하락|상승")),
    ("ratio_percent", re.compile(r"비중|비율|차지|점유")),
    ("mean", re.compile(r"평균")),
    ("sum", re.compile(r"합계|총합|총\s|총계|합산|모두\s*더|누적|전체\s*합")),
)
_DECREASE = re.compile(r"감소|줄었|줄어|하락")
_INTERPRETIVE = re.compile(r"유의|인과|원인|때문|영향|덕분|탓|추세|전망|예측|시사|의미한다|보여준다")
_TIME_SUFFIX = re.compile(r"\s*(년|월|일|분기|주차|시)")
_NUMBER = re.compile(r"(?<![0-9A-Za-z.,])([+-]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?)\s*(천|만|억)?")
_PERCENT_UNIT = re.compile(r"\s*(%p|%포인트|퍼센트포인트|%|퍼센트|프로)")
_MULTIPLIER = {"천": Decimal(1000), "만": Decimal(10000), "억": Decimal(100000000)}
_YEARISH = re.compile(r"(19|20)[0-9]{2}\Z")
_YEAR_MONTH = re.compile(r"((?:19|20)[0-9]{2})-(0[1-9]|1[0-2])\Z")
_PREV = re.compile(r"전년|전월|직전|지난해|작년|전기|이전")


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?。])\s+|\n+|(?<=다\.)", text)
    return [p.strip() for p in parts if p and p.strip()]


def _is_number(cell: str) -> bool:
    try:
        parse_number(cell)
        return True
    except StatGuardError:
        return False


class _Context:
    def __init__(self, dataset: TableDataset):
        self.dataset = dataset
        self.units = dict(dataset.units)
        self.measures = [c for c in dataset.columns if c in self.units]
        self.categorical: dict[str, list[str]] = {}
        for i, column in enumerate(dataset.columns):
            if column in self.units:
                continue
            values = list(dict.fromkeys(row[i] for row in dataset.rows if row[i].strip()))
            if 0 < len(values) <= 200:
                self.categorical[column] = values

    def year_columns(self) -> list[str]:
        return [c for c, vs in self.categorical.items() if all(_YEARISH.fullmatch(v) for v in vs)]

    def year_month_columns(self) -> list[str]:
        return [c for c, vs in self.categorical.items() if all(_YEAR_MONTH.fullmatch(v) for v in vs)]


def _aliases(column: str) -> tuple[str, ...]:
    """Exact name, or the name without a trailing counter (방문자수 → 방문자). No synonyms."""
    stripped = re.sub(r"(수|량|액|값)$", "", column)
    return (column, stripped) if len(stripped) >= 2 and stripped != column else (column,)


def _numeric_suffixes(column: str) -> tuple[str, ...]:
    suffixes = {column, column[-1]}
    if any(k in column for k in ("연", "년", "year", "Year")):
        suffixes.add("년")
    if "월" in column or "month" in column.lower():
        suffixes.add("월")
    return tuple(sorted(suffixes, key=len, reverse=True))


def _value_mentions(ctx: _Context, sentence: str) -> tuple[list[tuple[int, int, str, str]], list[str]]:
    """Return (start, end, column, value) mentions and notes; spans are used to exclude numbers."""
    mentions: list[tuple[int, int, str, str]] = []
    notes: list[str] = []
    for column, values in ctx.categorical.items():
        for value in values:
            if _YEAR_MONTH.fullmatch(value):
                year, month = _YEAR_MONTH.fullmatch(value).groups()
                pattern = rf"(?<![0-9]){year}\s*년\s*0?{int(month)}\s*월|(?<![0-9]){re.escape(value)}(?![0-9])"
            elif value.isdigit():
                suffix = "|".join(re.escape(s) for s in _numeric_suffixes(column))
                pattern = rf"(?<![0-9.,]){re.escape(value)}(?=\s*(?:{suffix}))"
            elif re.fullmatch(r"[A-Za-z0-9]{1,3}", value):
                pattern = rf"(?<![A-Za-z0-9]){re.escape(value)}(?![A-Za-z0-9])"
            else:
                pattern = re.escape(value)
            for m in re.finditer(pattern, sentence):
                mentions.append((m.start(), m.end(), column, value))
    mentions.sort()
    # Drop mentions contained in a longer mention (e.g. "A" inside "A-1").
    kept = [m for m in mentions if not any(o != m and o[0] <= m[0] and m[1] <= o[1] and (o[1] - o[0]) > (m[1] - m[0]) for o in mentions)]
    return kept, notes


def _numbers(sentence: str, excluded: list[tuple[int, int]], unit_words: Iterable[str]) -> list[dict]:
    unit_pattern = "|".join(re.escape(u) for u in sorted(set(unit_words), key=len, reverse=True) if u)
    found = []
    for m in _NUMBER.finditer(sentence):
        start, end = m.span(1)
        if any(a <= start < b for a, b in excluded):
            continue
        after = sentence[m.end():]
        if _TIME_SUFFIX.match(after) and not (unit_pattern and re.match(rf"\s*(?:{unit_pattern})", after)):
            continue  # years, months and dates are references, not claims
        unit = None
        pm = _PERCENT_UNIT.match(after)
        if pm:
            unit = "%p" if pm.group(1) in ("%p", "%포인트", "퍼센트포인트") else "%"
        elif unit_pattern:
            um = re.match(rf"\s*({unit_pattern})", after)
            if um:
                unit = um.group(1)
        text = m.group(1)
        try:
            value = parse_number(text.lstrip("+"))
        except StatGuardError:
            continue
        decimals = len(text.partition(".")[2])
        multiplier = _MULTIPLIER.get(m.group(2) or "", Decimal(1))
        with localcontext(ARITHMETIC):
            tolerance = Decimal(5) * Decimal(10) ** (-(decimals + 1)) * multiplier
            value = value * multiplier
        found.append({"text": sentence[m.start():m.end()].strip() + (unit or ""),
                      "start": m.start(), "value": value, "unit": unit, "tolerance": tolerance,
                      "approximate": bool(re.search(r"(약|대략|가량|정도|쯤)\s*$", sentence[max(0, m.start() - 4):m.start()]) or re.match(r"\s*(가량|정도|쯤)", sentence[m.end():]))})
    return found


def _abstain(claim: dict, status: str, reason: str) -> dict:
    return dict(claim, status=status, reason_code=reason)


def extract_claims(dataset: TableDataset, answer: str) -> list[dict]:
    """Link answer sentences to explicit calculations. Never infers units or semantics."""
    if not isinstance(answer, str) or len(answer) > MAX_ANSWER_CHARS:
        raise StatGuardError("ANSWER_TEXT_LIMIT")
    ctx = _Context(dataset)
    unit_words = [u for u in ctx.units.values()]
    claims: list[dict] = []
    for sentence in split_sentences(answer):
        if len(claims) >= MAX_CLAIMS:
            break
        mentions, _ = _value_mentions(ctx, sentence)
        range_problem, range_spans = _ranges(ctx, sentence)
        mentions = [m for m in mentions if not any(a <= m[0] < b for a, b in range_spans)]
        excluded = [(a, b) for a, b, _, _ in mentions] + range_spans
        numbers = _numbers(sentence, excluded, unit_words)
        operation = next((name for name, rx in _OPS if rx.search(sentence)), None)
        interpretive = bool(_INTERPRETIVE.search(sentence))
        base = {"claim_id": f"c{len(claims) + 1}", "sentence": sentence, "operation": None, "spec": None,
                "claimed": None, "notes": [], "interpretive": interpretive, "extractor": EXTRACTOR_VERSION}
        if not numbers:
            if interpretive:
                claims.append(_abstain(base, "UNCERTAIN", "INTERPRETIVE_STATEMENT"))
            continue
        # Years mentioned in the sentence that are absent from the data → not covered.
        missing_years = []
        for ycol in ctx.year_columns():
            for m in re.finditer(r"(?<![0-9])((?:19|20)[0-9]{2})\s*년", sentence):
                if m.group(1) not in ctx.categorical[ycol]:
                    missing_years.append(m.group(1))
        ym_cols = ctx.year_month_columns()
        if ym_cols and not ctx.year_columns():
            for m in re.finditer(r"(?<![0-9])((?:19|20)[0-9]{2})\s*년(?!\s*0?[0-9]{1,2}\s*월)", sentence):
                year = m.group(1)
                values = ctx.categorical[ym_cols[0]]
                hits = [v for v in values if v.startswith(year + "-")]
                if not hits:
                    missing_years.append(year)
                elif len(hits) != len(values):
                    base["notes"].append("YEAR_PREFIX_FILTER_UNSUPPORTED")
                else:
                    base["notes"].append("YEAR_COVERS_ALL_ROWS")
        # Target column.
        named = [c for c in ctx.measures if any(alias in sentence for alias in _aliases(c))]
        mentioned_cols = {m[2] for m in mentions}
        col_index = {c: i for i, c in enumerate(dataset.columns)}
        unconfirmed = [c for c in dataset.columns if c not in ctx.units and c not in mentioned_cols
                       and any(a in sentence for a in _aliases(c))
                       and all(_is_number(r[col_index[c]]) for r in dataset.rows if r[col_index[c]].strip())]
        percent_like = operation in ("percent_change", "ratio_percent")
        claim_numbers = [n for n in numbers if n["unit"] in ("%", "%p")] if percent_like else numbers
        if percent_like and not claim_numbers:
            operation = None if operation == "ratio_percent" else operation
            claim_numbers = numbers if operation is None else []
        primary = claim_numbers[-1] if claim_numbers else numbers[-1]
        if len(named) > 1:
            named = sorted(named, key=len, reverse=True)
            named = [n for n in named if not any(n != o and n in o for o in named)]
        if len(named) == 1:
            column = named[0]
        elif len(named) > 1:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "AMBIGUOUS_COLUMN"))
            continue
        elif unconfirmed:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "INSUFFICIENT_EVIDENCE", "UNIT_NOT_CONFIRMED"))
            continue
        else:
            by_unit = [c for c in ctx.measures if primary["unit"] and ctx.units[c] == primary["unit"]]
            if len(by_unit) == 1:
                column = by_unit[0]
                base["notes"].append("COLUMN_INFERRED_FROM_UNIT")
            elif len(ctx.measures) == 1:
                column = ctx.measures[0]
                base["notes"].append("COLUMN_INFERRED_ONLY_MEASURE")
            else:
                claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "COLUMN_NOT_IDENTIFIED"))
                continue
        base["column"] = column
        if missing_years:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED"))
            continue
        if range_problem:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), *range_problem))
            continue
        if range_spans:
            base["notes"].append("RANGE_COVERS_ALL_ROWS")
        if operation == "unsupported":
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "INSUFFICIENT_EVIDENCE", "UNSUPPORTED_OPERATION"))
            continue
        filters: dict[str, str] = {}
        conflict = False
        by_column: dict[str, list[tuple[int, int, str, str]]] = {}
        for mention in mentions:
            by_column.setdefault(mention[2], []).append(mention)
        for col, ms in by_column.items():
            distinct = list(dict.fromkeys(v for _, _, _, v in ms))
            if len(distinct) == 1:
                filters[col] = distinct[0]
            else:
                conflict = True
        if operation == "percent_change":
            result = _percent_change(ctx, sentence, by_column, filters, base, numbers, primary, column)
            claims.extend(result)
            continue
        if conflict:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "MULTIPLE_VALUES_FOR_ONE_COLUMN"))
            continue
        if operation == "ratio_percent":
            # "A지역이 2024년 전체의 x%": the value right before "전체" is context, the other is the subject.
            context_cols = {m[2] for m in mentions for w in re.finditer(r"전체", sentence) if 0 <= w.start() - m[1] <= 4}
            subjects = [m for m in mentions if m[2] not in context_cols]
            if not subjects:
                claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "RATIO_SUBJECT_NOT_IDENTIFIED"))
                continue
            subject = subjects[0][2]
            reference = {k: v for k, v in filters.items() if k != subject}
            spec = CalculationSpec.from_mapping({"operation": "ratio_percent", "column": column, "filters": filters, "reference_filters": reference})
            claims.append(dict(base, operation="ratio_percent", spec=spec.as_dict(), claimed=_claimed(primary, "%")))
            continue
        if operation in ("sum", "mean"):
            spec = CalculationSpec.from_mapping({"operation": operation, "column": column, "filters": filters})
            claims.append(dict(base, operation=operation, spec=spec.as_dict(), claimed=_claimed(primary, ctx.units[column])))
            continue
        # No operation keyword: a single-cell lookup only when the filters select exactly one row.
        idx = {c: i for i, c in enumerate(dataset.columns)}
        rows = [r for r in dataset.rows if all(r[idx[k]] == v for k, v in filters.items())]
        if len(rows) == 1 and filters:
            spec = CalculationSpec.from_mapping({"operation": "sum", "column": column, "filters": filters})
            claims.append(dict(base, operation="lookup", spec=spec.as_dict(), claimed=_claimed(primary, ctx.units[column])))
        elif interpretive:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "INTERPRETIVE_STATEMENT"))
        else:
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "OPERATION_NOT_IDENTIFIED"))
    for i, claim in enumerate(claims, 1):
        claim["claim_id"] = f"c{i}"
    return claims


def _ranges(ctx: _Context, sentence: str) -> tuple[tuple[str, str] | None, list[tuple[int, int]]]:
    """Period ranges: (problem or None, spans). Only a range that covers every row is accepted."""
    spans: list[tuple[int, int]] = []
    problem = None
    years = sorted({v[:4] for c in ctx.year_columns() + ctx.year_month_columns() for v in ctx.categorical[c]})
    months = sorted({int(v[5:]) for c in ctx.year_month_columns() for v in ctx.categorical[c]} |
                    {int(v) for c, vs in ctx.categorical.items() if "월" in c for v in vs if v.isdigit()})
    for m in _YEAR_RANGE.finditer(sentence):
        spans.append(m.span())
        lo, hi = int(m.group(1)), int(m.group(2))
        if not years:
            problem = problem or ("UNCERTAIN", "RANGE_FILTER_UNSUPPORTED")
        elif lo < int(years[0]) or hi > int(years[-1]):
            problem = problem or ("INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED")
        elif not (lo <= int(years[0]) and hi >= int(years[-1])):
            problem = problem or ("UNCERTAIN", "RANGE_FILTER_UNSUPPORTED")
    for m in _MONTH_RANGE.finditer(sentence):
        spans.append(m.span())
        if m.group(1):
            lo, hi = int(m.group(1)), int(m.group(2))
        else:
            lo, hi = (1, 6) if "상반기" in m.group(0) else (7, 12) if "하반기" in m.group(0) else (0, 0)
        if not (months and lo <= months[0] and hi >= months[-1]):
            problem = problem or ("UNCERTAIN", "RANGE_FILTER_UNSUPPORTED")
    return problem, spans


def _claimed(number: dict, default_unit: str | None = None) -> dict:
    unit = number["unit"] or default_unit
    return {"text": number["text"], "value": decimal_text(number["value"]), "unit": unit,
            "unit_stated": number["unit"] is not None, "tolerance": decimal_text(number["tolerance"]),
            "approximate": number["approximate"]}


def _percent_change(ctx, sentence, by_column, filters, base, numbers, primary, column) -> list[dict]:
    pivots = [(col, ms) for col, ms in by_column.items() if len({v for *_, v in ms}) == 2]
    claimed = None
    if primary["unit"] in ("%", "%p"):
        claimed = dict(primary)
        if _DECREASE.search(sentence) and claimed["value"] > 0:
            claimed["value"] = -claimed["value"]
    if len(pivots) > 1:
        return [_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "REFERENCE_NOT_IDENTIFIED")]
    if pivots:
        col, ms = pivots[0]
        order = list(dict.fromkeys(v for *_, v in ms))
        first, second = order
        ref = first
        for start, end, _, value in ms:
            if re.match(r"\s*(?:년|월)?\s*(?:대비|보다|에\s*비해|에\s*비하여|기준)", sentence[end:end + 12]):
                ref = value
                break
        else:
            values = ctx.categorical[col]
            if values.index(second) < values.index(first) and not re.search(r"에서", sentence):
                ref = second
        cur = second if ref == first else first
    else:
        single = [(col, ms[0][3]) for col, ms in by_column.items() if len({v for *_, v in ms}) == 1]
        candidates = [(c, v) for c, v in single if c in ctx.year_columns() or c in ctx.year_month_columns()]
        if not (_PREV.search(sentence) and len(candidates) == 1):
            return [_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "REFERENCE_NOT_IDENTIFIED")]
        col, cur = candidates[0]
        values = sorted(ctx.categorical[col])
        position = values.index(cur)
        if position == 0:
            return [_abstain(dict(base, claimed=_claimed(primary)), "INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED")]
        ref = values[position - 1]
        base = dict(base, notes=base["notes"] + ["REFERENCE_FROM_PREVIOUS_PERIOD"])
    others = {k: v for k, v in filters.items() if k != col}
    selection, reference = dict(others, **{col: cur}), dict(others, **{col: ref})
    out = []
    if claimed is not None:
        spec = CalculationSpec.from_mapping({"operation": "percent_change", "column": column, "filters": selection, "reference_filters": reference})
        out.append(dict(base, operation="percent_change", spec=spec.as_dict(), claimed=_claimed(claimed, "%")))
    else:
        out.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "CHANGE_RATE_NOT_STATED"))
    # "1,000명에서 1,178명으로" — the two level numbers become sum sub-claims.
    unit = ctx.units[column]
    levels = [n for n in numbers if n["unit"] == unit]
    if len(levels) == 2 and pivots:
        mention_order = list(dict.fromkeys(v for *_, v in pivots[0][1]))
        for number, value in zip(levels, mention_order):
            flt = dict(others, **{col: value})
            spec = CalculationSpec.from_mapping({"operation": "sum", "column": column, "filters": flt})
            out.append(dict(base, claim_id="", operation="sum", spec=spec.as_dict(), claimed=_claimed(number, unit),
                            notes=base["notes"] + ["LEVEL_VALUE_IN_CHANGE_SENTENCE"]))
    return out


_ERROR_STATUS = {
    "EMPTY_SELECTION": ("INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED"),
    "NO_NUMERIC_ROWS": ("INSUFFICIENT_EVIDENCE", "NO_NUMERIC_ROWS"),
    "MISSING_NUMERIC_VALUE": ("INSUFFICIENT_EVIDENCE", "MISSING_VALUES_IN_RANGE"),
    "INVALID_NUMERIC_VALUE": ("INSUFFICIENT_EVIDENCE", "INVALID_NUMBERS_IN_RANGE"),
    "NUMERIC_PRECISION_LIMIT": ("INSUFFICIENT_EVIDENCE", "INVALID_NUMBERS_IN_RANGE"),
    "NON_POSITIVE_BASELINE": ("INSUFFICIENT_EVIDENCE", "NON_POSITIVE_BASELINE"),
    "ZERO_DENOMINATOR": ("INSUFFICIENT_EVIDENCE", "ZERO_DENOMINATOR"),
    "OVERLAPPING_COMPARISON": ("UNCERTAIN", "OVERLAPPING_COMPARISON"),
    "UNKNOWN_COLUMN": ("INSUFFICIENT_EVIDENCE", "UNKNOWN_COLUMN"),
}


def verify_claim(dataset: TableDataset, claim: dict) -> dict:
    """Execute a linked claim and assign one of the four statuses."""
    if claim.get("status"):
        return dict(claim, computed=None)
    spec = CalculationSpec.from_mapping(claim["spec"])
    try:
        result = execute(dataset, spec)
    except StatGuardError as error:
        status, reason = _ERROR_STATUS.get(error.code, ("INSUFFICIENT_EVIDENCE", error.code))
        return dict(claim, status=status, reason_code=reason, computed=None)
    computed = {"value": decimal_text(result.value), "unit": result.unit, "expression": result.expression,
                "usage": result.usage.as_dict(), "calculation_id": result.calculation_id,
                "reference_usage": None if result.reference_usage is None else result.reference_usage.as_dict()}
    claimed = claim["claimed"]
    if claimed["unit"] != result.unit:
        return dict(claim, status="UNCERTAIN", reason_code="UNIT_MISMATCH", computed=computed)
    with localcontext(ARITHMETIC):
        value, tolerance = Decimal(claimed["value"]), Decimal(claimed["tolerance"])
        signed = value - result.value
        agrees = abs(signed) <= tolerance
        relative = None if result.value == 0 else abs(signed) / abs(result.value) * 100
    difference = {"signed": decimal_text(signed), "absolute": decimal_text(abs(signed)),
                  "unit": "%p" if result.unit == "%" else result.unit,
                  "relative_percent": None if relative is None else decimal_text(relative.quantize(Decimal("0.01")))}
    return dict(claim, status="VERIFIED" if agrees else "CONTRADICTED",
                reason_code="WITHIN_ROUNDING_OF_STATED_PRECISION" if agrees else "NUMERIC_VALUE_CONFLICT",
                computed=computed, difference=difference)


def verify_answer(dataset: TableDataset, answer: str) -> dict:
    claims = [verify_claim(dataset, c) for c in extract_claims(dataset, answer)]
    summary = {status: sum(1 for c in claims if c["status"] == status) for status in STATUSES}
    return {"extractor": EXTRACTOR_VERSION, "claims": claims, "summary": summary,
            "scope": "LINKED_CALCULATIONS_ONLY_NOT_WHOLE_ANSWER_TRUTH"}

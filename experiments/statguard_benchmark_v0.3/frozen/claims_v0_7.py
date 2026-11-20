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

EXTRACTOR_VERSION = "statguard-rule-extractor-v0.7"
# v0.7 (domain-extension answers, post-hoc): counts such as "국가 48개", "2곳" are not claims
# unless the counter is the confirmed unit of a column.
# v0.6 (before the domain-extension run): digits inside a column name ("1인당GDP") are not numbers;
# scope inheritance only for sentences that point back ("따라서", "이 중") or name no category at all.
# v0.5 (large-table answers): "모두 합한/합하면" sums, "연간 합계의 x%" ratios, and a
# trailing "최종값:" line repeating an earlier claim is not counted twice; conditional counts
# ("0mm보다 큰 날") abstain; a scope that only an earlier sentence names abstains; "n−1" ignored.
# v0.3 (benchmark error analysis): formula numbers ignored, "N만 M" merged, levels in a
# %-unit column are not change rates, ratio without a stated denominator scope abstains.
# v0.2: period ranges ("2014~2023년", "1~6월", "상반기") are no longer read as a single
# year/month filter. A range covering every row means all rows; a partial range abstains.
_YEAR_RANGE = re.compile(r"((?:19|20)[0-9]{2})\s*년?\s*[~\-–]\s*((?:19|20)[0-9]{2})\s*년")
_MONTH_RANGE = re.compile(r"(?<![0-9])(1[0-2]|0?[1-9])\s*월?\s*[~\-–]\s*(1[0-2]|0?[1-9])\s*월|상반기|하반기|[1-4]\s*분기")
STATUSES = ("VERIFIED", "CONTRADICTED", "UNCERTAIN", "INSUFFICIENT_EVIDENCE")
MAX_ANSWER_CHARS = 6000
MAX_CLAIMS = 20

_OPS = (  # order matters: more specific first
    ("unsupported", re.compile(r"회귀|기울기|[0-9]+\s*위\b|순위")),
    ("t_test", re.compile(r"t\s*-?\s*검정|t-test|p\s*값|p-value|p\s*[=<>＜＞≤≥]|유의")),
    ("correlation", re.compile(r"상관")),
    ("stdev", re.compile(r"표준편차")),
    ("variance", re.compile(r"분산")),
    ("median", re.compile(r"중앙값|중위수|중위값")),
    ("percent_change", re.compile(r"증가율|감소율|증감률|변화율|성장률|늘었|늘어|증가|줄었|줄어|감소|하락|상승")),
    ("ratio_percent", re.compile(r"비중|비율|차지|점유|(?:합계|전체|총합|총량|연간\s*\S{0,6})\s*(?:중|의|에서)\s*(?:약\s*)?[+-]?[0-9][0-9.,]*\s*%")),
    ("mean", re.compile(r"평균")),
    ("max", re.compile(r"최댓값|최대값|가장\s*(많|높|크|길|덥|따뜻)|최고치|최다")),
    ("min", re.compile(r"최솟값|최소값|가장\s*(적|낮|작|짧|춥)|최저치|최소")),
    ("sum", re.compile(r"합계|총합|총\s|총계|합산|모두\s*더|누적|전체\s*합|합한|합하면|합치면|더한|더하면")),
)
# v0.4: descriptive statistics, correlation and Welch t-test claims are verified instead of
# abstaining as unsupported. Regression/trend and rank claims still abstain.
_P_CLAIM = re.compile(r"p\s*(?:값|-?value)?\s*(?:은|는|이|가|=|:)?\s*(?:약\s*)?([<>＜＞≤≥=]?)\s*([0-9]*\.[0-9]+|[01](?![0-9]))")
_T_CLAIM = re.compile(r"t\s*(?:값|통계량)?\s*(?:은|는|=|:)\s*(?:약\s*)?(-?[0-9]+(?:\.[0-9]+)?)")
_NOT_SIGNIFICANT = re.compile(r"유의(?:미)?하지\s*않|유의(?:미)?한\s*차이(?:가|는)?\s*없|유의(?:미)?성(?:이|은)?\s*없")
_CONDITION = re.compile(r"[0-9]\s*\S{0,4}\s*(?:보다\s*(?:큰|작은|많은|적은|높은|낮은)|이상인|이하인|초과|미만)")
_REFERS_BACK = re.compile(r"(따라서|그러므로|즉|결국|결과적으로|이는|이때|이에|이를|이 중|그중|그 중|또한|그리고|반면|한편|이 \S+|그 \S+)")
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
        self.date_years: set[str] = set()
        for i, column in enumerate(dataset.columns):
            cells = [row[i] for row in dataset.rows if row[i].strip()]
            if cells and all(re.fullmatch(r"(?:19|20)[0-9]{2}-[01][0-9]-[0-3][0-9]", c) for c in cells):
                self.date_years |= {c[:4] for c in cells}

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
                unit = um.group(1) + ("²" if after[um.end():um.end() + 1] in ("²", "^") else "")
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
        # v0.3: a unitless number inside a written formula "(12+9+6)÷3" is working, not a claim.
        if unit is None and (re.search(r"[+×÷*/=(]\s*$", sentence[max(0, m.start() - 3):m.start()]) or re.match(r"\s*[+×÷*/=)]", after)):
            continue
        # v0.7: "48개", "2곳", "3개국" count rows/entities, not a column value (unless that is the unit).
        if unit is None and re.match(r"\s*(개국|개|곳|가지|건|번째|회)", after):
            continue
        # v0.5: "(n−1로 나눔)" — a number right after a letter and minus sign is part of a formula.
        if unit is None and re.search(r"[A-Za-z]\s*[−\-]\s*$", sentence[max(0, m.start() - 3):m.start()]):
            continue
        item = {"text": sentence[m.start():m.end()].strip() + (unit or ""), "start": m.start(), "end": m.end(),
                "value": value, "unit": unit, "tolerance": tolerance,
                "approximate": bool(re.search(r"(약|대략|가량|정도|쯤)\s*$", sentence[max(0, m.start() - 4):m.start()]) or re.match(r"\s*(가량|정도|쯤)", sentence[m.end():]))}
        # v0.3: "5,146만 8,217명" is one number (51,468,217), not 5,146만 and 8,217.
        prev = found[-1] if found else None
        if prev and prev["unit"] is None and prev.get("multiplier", 1) > 1 and multiplier == 1 and not sentence[prev["end"]:m.start()].strip():
            with localcontext(ARITHMETIC):
                prev.update(value=prev["value"] + value, tolerance=tolerance, unit=unit, end=m.end(),
                            text=sentence[prev["start"]:m.end()].strip() + (unit or ""))
            continue
        item["multiplier"] = multiplier
        found.append(item)
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
    seen_context: dict[str, set[str]] = {}  # v0.5: category values mentioned in earlier sentences
    for sentence in split_sentences(answer):
        if len(claims) >= MAX_CLAIMS:
            break
        mentions, _ = _value_mentions(ctx, sentence)
        range_problem, range_spans = _ranges(ctx, sentence)
        mentions = [m for m in mentions if not any(a <= m[0] < b for a, b in range_spans)]
        excluded = [(a, b) for a, b, _, _ in mentions] + range_spans
        excluded += [m.span() for c in dataset.columns if any(ch.isdigit() for ch in c) for m in re.finditer(re.escape(c), sentence)]
        previous_context = {c: set(v) for c, v in seen_context.items()}
        for _, _, c, v in mentions:
            seen_context.setdefault(c, set()).add(v)
        numbers = _numbers(sentence, excluded, unit_words)
        operation = next((name for name, rx in _OPS if rx.search(sentence)), None)
        interpretive = bool(_INTERPRETIVE.search(sentence))
        base = {"claim_id": f"c{len(claims) + 1}", "sentence": sentence, "operation": None, "spec": None,
                "claimed": None, "notes": [], "interpretive": interpretive, "extractor": EXTRACTOR_VERSION}
        if operation == "t_test":
            t_claim = _t_test_claim(ctx, sentence, mentions, base)
            if t_claim is not None:
                claims.append(t_claim)
                continue
            operation = None  # "유의" without two identifiable groups stays an interpretive sentence
        if sentence.startswith("최종값") and numbers and any(
                c.get("claimed") and c["claimed"].get("value") == decimal_text(numbers[-1]["value"]) for c in claims):
            continue  # v0.5: the closing "최종값:" line repeats a claim already checked
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
        if ctx.date_years and not ctx.year_columns():  # v0.4: "2024년" against a YYYY-MM-DD date column
            for m in re.finditer(r"(?<![0-9])((?:19|20)[0-9]{2})\s*년", sentence):
                if m.group(1) not in ctx.date_years:
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
        if operation == "correlation":
            claims.append(_correlation_claim(ctx, sentence, named, mentions, numbers, base, missing_years, range_problem))
            continue
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
        if _CONDITION.search(sentence):
            # v0.5: "0mm보다 큰 날", "30℃ 이상인 날" — conditional filters/counts are not supported.
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "CONDITION_FILTER_UNSUPPORTED"))
            continue
        # v0.6: inheritance only when the sentence points back ("따라서 …", "이 중 …"); a sentence
        # that starts afresh ("사하라이남아프리카의 …") is read on its own.
        refers_back = bool(_REFERS_BACK.match(sentence)) or not {m[2] for m in mentions}
        inherited = [c for c, vs in previous_context.items() if refers_back and len(vs) == 1 and c not in {m[2] for m in mentions}
                     and len(ctx.categorical.get(c, ())) > 1 and not any(a in sentence for a in _aliases(c))]
        if inherited:
            # v0.5: "시카고의 ... 입니다. 따라서 1월 대비 7월 강수량은 ..." — the scope comes from an earlier
            # sentence; computing over all rows would be a different claim, so abstain instead of guessing.
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "SCOPE_FROM_PREVIOUS_SENTENCE"))
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
            # v0.3: the denominator scope must be stated. "A지역 비율은 44.7%" without the year,
            # when the data has several years, is ambiguous (all years? last sentence's year?).
            unstated = [c for c, vs in ctx.categorical.items() if c != subject and c not in filters and len(vs) > 1]
            if unstated:
                claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "RATIO_SCOPE_NOT_STATED"))
                continue
            spec = CalculationSpec.from_mapping({"operation": "ratio_percent", "column": column, "filters": filters, "reference_filters": reference})
            claims.append(dict(base, operation="ratio_percent", spec=spec.as_dict(), claimed=_claimed(primary, "%")))
            continue
        if operation in ("sum", "mean", "stdev", "variance", "median", "max", "min") and _grouped_ambiguity(ctx, dataset, sentence, filters):
            # "지역별 방문자수 표준편차": per-group totals or all rows? Several rows per group → abstain.
            claims.append(_abstain(dict(base, claimed=_claimed(primary)), "UNCERTAIN", "GROUPED_STATISTIC_AMBIGUOUS"))
            continue
        if operation in ("sum", "mean", "stdev", "variance", "median"):
            spec = CalculationSpec.from_mapping({"operation": operation, "column": column, "filters": filters})
            unit = ctx.units[column] + ("²" if operation == "variance" else "")
            claims.append(dict(base, operation=operation, spec=spec.as_dict(), claimed=_claimed(primary, unit)))
            continue
        if operation in ("max", "min"):
            # "12월 강수량이 215.4mm로 가장 많았다": the most specific mentioned value is the claimed
            # argmax/argmin; the extreme is taken over the remaining scope.
            argmax = None
            # v0.5: only “가장 …” names the extreme row; “1월 최고기온의 최댓값” keeps January as the scope.
            if filters and re.search(r"가장", sentence):
                subject = max(filters, key=lambda c: len(ctx.categorical.get(c, ())))
                argmax = {"column": subject, "value": filters.pop(subject)}
            spec = CalculationSpec.from_mapping({"operation": operation, "column": column, "filters": filters})
            claims.append(dict(base, operation=operation, spec=spec.as_dict(), claimed=_claimed(primary, ctx.units[column]), argmax=argmax))
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


def _grouped_ambiguity(ctx: _Context, dataset: TableDataset, sentence: str, filters: dict) -> bool:
    index = {c: i for i, c in enumerate(dataset.columns)}
    rows = [r for r in dataset.rows if all(r[index[k]] == v for k, v in filters.items())]
    for token in re.findall(r"([가-힣A-Za-z]+)별", sentence):
        for column in ctx.categorical:
            if column in filters or not (token in column or column in token or (token[-1:] == "월" and "월" in column)):
                continue
            values = [r[index[column]] for r in rows]
            if len(values) != len(set(values)):
                return True
    return False


def _single_filters(mentions) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Columns mentioned with one value become filters; columns with several values are returned apart."""
    by_column: dict[str, list[str]] = {}
    for _, _, col, value in mentions:
        if value not in by_column.setdefault(col, []):
            by_column[col].append(value)
    single = {c: vs[0] for c, vs in by_column.items() if len(vs) == 1}
    multi = {c: vs for c, vs in by_column.items() if len(vs) > 1}
    return single, multi


def _t_test_claim(ctx: _Context, sentence: str, mentions, base: dict) -> dict | None:
    """Welch t-test claim between two groups of one column ("A지역과 B지역의 체류시간 차이는 유의하지 않다").
    Returns None when two groups cannot be identified, so the sentence is handled as interpretive."""
    single, multi = _single_filters(mentions)
    pivots = [(c, vs) for c, vs in multi.items() if len(vs) == 2]
    if len(pivots) != 1 or len(multi) != 1:
        return None
    named = [c for c in ctx.measures if any(a in sentence for a in _aliases(c))]
    column = named[0] if len(named) == 1 else ctx.measures[0] if not named and len(ctx.measures) == 1 else None
    pivot, (first, second) = pivots[0]
    base = dict(base, column=column, operation="t_test", notes=base["notes"] + ["WELCH_T_TEST_TWO_SIDED_ALPHA_005"])
    p_match, t_match = _P_CLAIM.search(sentence), _T_CLAIM.search(sentence)
    if p_match:
        text = p_match.group(2)
        decimals = len(text.partition(".")[2])
        claimed = {"text": "p" + (p_match.group(1) or "=") + text, "value": decimal_text(Decimal(text)), "unit": "", "unit_stated": True,
                   "tolerance": decimal_text(Decimal(5) * Decimal(10) ** (-(decimals + 1))), "approximate": False,
                   "target": "p_value", "comparator": p_match.group(1) if p_match.group(1) not in ("", "=") else ""}
    elif t_match:
        text = t_match.group(1)
        decimals = len(text.partition(".")[2])
        claimed = {"text": "t=" + text, "value": decimal_text(Decimal(text)), "unit": "", "unit_stated": True,
                   "tolerance": decimal_text(Decimal(5) * Decimal(10) ** (-(decimals + 1))), "approximate": False, "target": "t_statistic"}
    else:
        significant = not _NOT_SIGNIFICANT.search(sentence)
        if "유의" not in sentence:
            return None
        claimed = {"text": "유의함" if significant else "유의하지 않음", "value": None, "unit": "", "unit_stated": False,
                   "tolerance": "0", "approximate": False, "target": "significance", "significant": significant}
    if column is None:
        return _abstain(dict(base, claimed=claimed), "UNCERTAIN", "COLUMN_NOT_IDENTIFIED")
    spec = CalculationSpec.from_mapping({"operation": "t_test", "column": column, "filters": dict(single, **{pivot: first}),
                                         "reference_filters": dict(single, **{pivot: second})})
    return dict(base, spec=spec.as_dict(), claimed=claimed)


def _correlation_claim(ctx: _Context, sentence: str, named: list[str], mentions, numbers, base: dict, missing_years, range_problem) -> dict:
    coefficient = [n for n in numbers if n["unit"] is None and abs(n["value"]) <= 1]
    claimed = None
    if coefficient:
        n = coefficient[-1]
        value = -n["value"] if re.search(r"음의\s*상관|부적\s*상관|역\s*상관", sentence) and n["value"] > 0 else n["value"]
        claimed = {"text": n["text"], "value": decimal_text(value), "unit": "", "unit_stated": False,
                   "tolerance": decimal_text(n["tolerance"]), "approximate": n["approximate"]}
    base = dict(base, operation="correlation")
    if len(named) != 2:
        return _abstain(dict(base, claimed=claimed), "UNCERTAIN", "CORRELATION_COLUMNS_NOT_IDENTIFIED")
    if claimed is None:
        return _abstain(base, "UNCERTAIN", "CLAIM_VALUE_NOT_IDENTIFIED")
    if missing_years:
        return _abstain(dict(base, claimed=claimed), "INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED")
    if range_problem:
        return _abstain(dict(base, claimed=claimed), *range_problem)
    single, multi = _single_filters(mentions)
    if multi:
        return _abstain(dict(base, claimed=claimed), "UNCERTAIN", "MULTIPLE_VALUES_FOR_ONE_COLUMN")
    first, second = sorted(named, key=lambda c: min(sentence.find(a) for a in _aliases(c) if a in sentence))
    spec = CalculationSpec.from_mapping({"operation": "correlation", "column": first, "column2": second, "filters": single})
    return dict(base, column=first, spec=spec.as_dict(), claimed=claimed)


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
    rate_number = primary
    if ctx.units[column] == "%" and pivots:
        # v0.3: in a %-unit column ("실업률은 3.639%에서 2.857%로"), the first two % numbers are
        # the two levels; only a further % number can be the change rate.
        percents = [n for n in numbers if n["unit"] in ("%", "%p")]
        rate_number = percents[2] if len(percents) >= 3 else None if len(percents) == 2 else primary
    if rate_number is not None and rate_number["unit"] in ("%", "%p"):
        claimed = dict(rate_number)
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
    if unit == "%":
        levels = levels[:2] if len(levels) >= 2 else levels
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
    "INSUFFICIENT_ROWS": ("INSUFFICIENT_EVIDENCE", "INSUFFICIENT_ROWS"),
    "ZERO_VARIANCE": ("INSUFFICIENT_EVIDENCE", "ZERO_VARIANCE"),
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
                "reference_usage": None if result.reference_usage is None else result.reference_usage.as_dict(),
                "extra": result.extra}
    claimed = claim["claimed"]
    target = claimed.get("target", "value")
    if target == "significance":  # Welch t-test at alpha = 0.05, two-sided
        significant = Decimal(result.extra["p_value"]) < Decimal("0.05")
        agrees = significant == claimed["significant"]
        return dict(claim, status="VERIFIED" if agrees else "CONTRADICTED",
                    reason_code="SIGNIFICANCE_MATCHES_ALPHA_005" if agrees else "SIGNIFICANCE_CONFLICT_ALPHA_005", computed=computed)
    if claimed["unit"] != result.unit:
        return dict(claim, status="UNCERTAIN", reason_code="UNIT_MISMATCH", computed=computed)
    # Candidate values: the default result, plus the population definition for stdev/variance.
    candidates = [("default", result.value)]
    if target == "p_value":
        candidates = [("p_value", Decimal(result.extra["p_value"]))]
    elif spec.operation in ("stdev", "variance"):
        candidates = [("sample", Decimal(result.extra["sample"])), ("population", Decimal(result.extra["population"]))]
    with localcontext(ARITHMETIC):
        value, tolerance = Decimal(claimed["value"]), Decimal(claimed["tolerance"])
        comparator = claimed.get("comparator") or ""
        def matches(actual):
            if comparator in ("<", "＜", "≤"):
                return actual < value if comparator != "≤" else actual <= value
            if comparator in (">", "＞", "≥"):
                return actual > value if comparator != "≥" else actual >= value
            return abs(value - actual) <= tolerance
        hit = next((name for name, actual in candidates if matches(actual)), None)
        reference = dict(candidates).get(hit, candidates[0][1])
        signed = value - reference
        relative = None if reference == 0 else abs(signed) / abs(reference) * 100
    difference = {"signed": decimal_text(signed), "absolute": decimal_text(abs(signed)),
                  "unit": "%p" if result.unit == "%" else result.unit,
                  "relative_percent": None if relative is None else decimal_text(relative.quantize(Decimal("0.01")))}
    notes = list(claim.get("notes", []))
    if hit in ("sample", "population"):
        notes.append("SAMPLE_DEFINITION_MATCH" if hit == "sample" else "POPULATION_DEFINITION_MATCH")
    if hit and claim.get("argmax"):
        index = dataset.columns.index(claim["argmax"]["column"])
        if not any(dataset.rows[i - 1][index] == claim["argmax"]["value"] for i in result.extra["rows"]):
            return dict(claim, notes=notes, status="CONTRADICTED", reason_code="EXTREME_ROW_CONFLICT", computed=computed, difference=difference)
    return dict(claim, notes=notes, status="VERIFIED" if hit else "CONTRADICTED",
                reason_code=("WITHIN_ROUNDING_OF_STATED_PRECISION" if not comparator else "INEQUALITY_HOLDS") if hit else "NUMERIC_VALUE_CONFLICT",
                computed=computed, difference=difference)


def verify_answer(dataset: TableDataset, answer: str) -> dict:
    claims = [verify_claim(dataset, c) for c in extract_claims(dataset, answer)]
    summary = {status: sum(1 for c in claims if c["status"] == status) for status in STATUSES}
    return {"extractor": EXTRACTOR_VERSION, "claims": claims, "summary": summary,
            "scope": "LINKED_CALCULATIONS_ONLY_NOT_WHOLE_ANSWER_TRUTH"}

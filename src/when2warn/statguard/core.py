"""Small deterministic calculation core. No provider, storage, or Agent imports."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass
from decimal import Context, Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext
from typing import Mapping

CONTRACT_VERSION = "statguard-calculation-v0.1"
ARITHMETIC = Context(prec=34, rounding=ROUND_HALF_EVEN)
OPERATIONS = frozenset({"sum", "mean", "ratio_percent", "percent_change", "rank", "grouped_aggregate",
                        "variance", "stdev", "median", "max", "min", "correlation", "t_test"})
STATISTICS = frozenset({"variance", "stdev", "median", "max", "min", "correlation", "t_test"})
_NUMBER = re.compile(r"[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?\Z", re.ASCII)


class StatGuardError(ValueError):
    """A bounded reason code; never include input cells or exception contents."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if value == 0 else text


def parse_number(text: str) -> Decimal:
    if not isinstance(text, str) or not _NUMBER.fullmatch(text.strip()):
        raise StatGuardError("INVALID_NUMERIC_VALUE")
    clean = text.strip().replace(",", "")
    integer, _, fraction = clean.lstrip("+-").partition(".")
    if len(integer) > 18 or len(fraction) > 6:
        raise StatGuardError("NUMERIC_PRECISION_LIMIT")
    try:
        value = Decimal(clean)
    except InvalidOperation:
        raise StatGuardError("INVALID_NUMERIC_VALUE") from None
    if not value.is_finite():
        raise StatGuardError("INVALID_NUMERIC_VALUE")
    return value


@dataclass(frozen=True)
class CsvLimits:
    max_bytes: int = 1_048_576
    max_rows: int = 10_000
    max_columns: int = 64
    max_cell_chars: int = 512

    def __post_init__(self) -> None:
        for value, ceiling in zip((self.max_bytes, self.max_rows, self.max_columns, self.max_cell_chars), (1_048_576, 10_000, 64, 512)):
            if type(value) is not int or not 1 <= value <= ceiling:
                raise StatGuardError("INVALID_CSV_LIMIT")


@dataclass(frozen=True)
class TableDataset:
    dataset_id: str
    dataset_version: str
    source_sha256: str
    encoding: str
    columns: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]
    units: tuple[tuple[str, str], ...]

    def unit_for(self, column: str) -> str | None:
        return dict(self.units).get(column)


def load_csv_bytes(data: bytes, *, dataset_id: str, units: Mapping[str, str] | None = None,
                   encoding: str = "auto", limits: CsvLimits | None = None) -> TableDataset:
    """Parse a bounded CSV; supplied column units are assumptions, not inference."""
    if limits is not None and not isinstance(limits, CsvLimits):
        raise StatGuardError("INVALID_CSV_LIMIT")
    limits = limits or CsvLimits()
    if not isinstance(data, bytes):
        raise StatGuardError("CSV_BYTES_REQUIRED")
    if not isinstance(dataset_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", dataset_id):
        raise StatGuardError("INVALID_DATASET_ID")
    if len(data) > limits.max_bytes:
        raise StatGuardError("CSV_BYTE_LIMIT")
    if not isinstance(encoding, str) or encoding not in {"auto", "utf-8-sig", "cp949"}:
        raise StatGuardError("UNSUPPORTED_ENCODING")
    decoded = None
    for selected in (("utf-8-sig", "cp949") if encoding == "auto" else (encoding,)):
        try:
            decoded = data.decode(selected, errors="strict")
            break
        except UnicodeDecodeError:
            continue
    if decoded is None:
        raise StatGuardError("CSV_DECODE_FAILED")
    if any(ord(char) < 32 and char not in "\t\r\n" for char in decoded):
        raise StatGuardError("CSV_CONTROL_CHARACTER")
    rows: list[tuple[str, ...]] = []
    try:
        reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
        header = next(reader, None)
        if header is None or not header or any(not name or name != name.strip() for name in header):
            raise StatGuardError("INVALID_CSV_HEADER")
        if len(header) > limits.max_columns:
            raise StatGuardError("CSV_COLUMN_LIMIT")
        if len(set(header)) != len(header):
            raise StatGuardError("DUPLICATE_CSV_HEADER")
        if any(len(name) > limits.max_cell_chars for name in header):
            raise StatGuardError("CSV_CELL_LIMIT")
        for row in reader:
            if len(rows) >= limits.max_rows:
                raise StatGuardError("CSV_ROW_LIMIT")
            if len(row) != len(header):
                raise StatGuardError("CSV_ROW_WIDTH_MISMATCH")
            if any(len(cell) > limits.max_cell_chars for cell in row):
                raise StatGuardError("CSV_CELL_LIMIT")
            rows.append(tuple(row))
    except csv.Error:
        raise StatGuardError("INVALID_CSV_STRUCTURE") from None
    if not rows:
        raise StatGuardError("EMPTY_DATASET")
    unit_items: list[tuple[str, str]] = []
    if units is not None:
        if not isinstance(units, Mapping):
            raise StatGuardError("INVALID_UNIT_METADATA")
        for column, unit in units.items():
            if column not in header or not isinstance(unit, str) or not unit.strip() or len(unit) > 32 or any(ord(c) < 32 for c in unit):
                raise StatGuardError("INVALID_UNIT_METADATA")
            unit_items.append((column, unit))
    normalized_units = tuple(sorted(unit_items))
    raw_hash = hashlib.sha256(data).hexdigest()
    version = _hash({"contract": CONTRACT_VERSION, "dataset_id": dataset_id, "source_sha256": raw_hash, "encoding": selected, "units": normalized_units})
    return TableDataset(dataset_id, version, raw_hash, selected, tuple(header), tuple(rows), normalized_units)


def _filters(raw: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(raw, Mapping) or len(raw) > 16:
        raise StatGuardError("INVALID_FILTER")
    if any(not isinstance(k, str) or not isinstance(v, str) or len(k) > 512 or len(v) > 512 for k, v in raw.items()):
        raise StatGuardError("INVALID_FILTER")
    return tuple(sorted(raw.items()))


@dataclass(frozen=True)
class CalculationSpec:
    operation: str
    column: str
    filters: tuple[tuple[str, str], ...] = ()
    reference_filters: tuple[tuple[str, str], ...] | None = None
    group_by: str | None = None
    aggregation: str | None = None
    missing_policy: str = "reject"
    column2: str | None = None  # second numeric column, correlation only

    def __post_init__(self) -> None:
        if self.operation == "correlation":
            if not isinstance(self.column2, str) or not self.column2 or self.column2 == self.column or len(self.column2) > 512:
                raise StatGuardError("SECOND_COLUMN_REQUIRED")
        elif self.column2 is not None:
            raise StatGuardError("UNEXPECTED_SECOND_COLUMN")
        if not isinstance(self.operation, str) or self.operation not in OPERATIONS:
            raise StatGuardError("UNSUPPORTED_OPERATION")
        if not isinstance(self.column, str) or not self.column or len(self.column) > 512:
            raise StatGuardError("INVALID_COLUMN")
        if not isinstance(self.missing_policy, str) or self.missing_policy not in {"reject", "omit"}:
            raise StatGuardError("INVALID_MISSING_POLICY")
        for fs in (self.filters, self.reference_filters):
            if fs is None:
                continue
            if not isinstance(fs, tuple) or len(fs) > 16 or any(not isinstance(pair, tuple) or len(pair) != 2 or not all(isinstance(v, str) and len(v) <= 512 for v in pair) for pair in fs):
                raise StatGuardError("INVALID_FILTER")
            if len({k for k, _ in fs}) != len(fs):
                raise StatGuardError("DUPLICATE_FILTER_COLUMN")
        is_comparison = self.operation in {"ratio_percent", "percent_change", "t_test"}
        if is_comparison != (self.reference_filters is not None):
            raise StatGuardError("REFERENCE_SELECTION_REQUIRED" if is_comparison else "UNEXPECTED_REFERENCE_SELECTION")
        is_grouped = self.operation in {"rank", "grouped_aggregate"}
        if is_grouped and (not isinstance(self.group_by, str) or not self.group_by):
            raise StatGuardError("GROUP_COLUMN_REQUIRED")
        if not is_grouped and self.group_by is not None:
            raise StatGuardError("UNEXPECTED_GROUP_COLUMN")
        if self.operation == "grouped_aggregate":
            if not isinstance(self.aggregation, str) or self.aggregation not in {"sum", "mean"}:
                raise StatGuardError("UNSUPPORTED_AGGREGATION")
        elif self.aggregation is not None:
            raise StatGuardError("UNEXPECTED_AGGREGATION")

    @classmethod
    def from_mapping(cls, raw: Mapping[str, object]) -> CalculationSpec:
        if not isinstance(raw, Mapping):
            raise StatGuardError("INVALID_CALCULATION_SPEC")
        if set(raw) - {"operation", "column", "filters", "reference_filters", "group_by", "aggregation", "missing_policy", "column2"}:
            raise StatGuardError("UNKNOWN_SPEC_FIELD")
        if not isinstance(raw.get("operation"), str) or not isinstance(raw.get("column"), str):
            raise StatGuardError("INVALID_CALCULATION_SPEC")
        return cls(operation=raw["operation"], column=raw["column"], filters=_filters(raw.get("filters", {})),
                   reference_filters=_filters(raw["reference_filters"]) if raw.get("reference_filters") is not None else None,
                   group_by=raw.get("group_by"), aggregation=raw.get("aggregation"), missing_policy=raw.get("missing_policy", "reject"),
                   column2=raw.get("column2"))

    def as_dict(self) -> dict:
        out = {"operation": self.operation, "column": self.column, "filters": dict(self.filters),
               "reference_filters": None if self.reference_filters is None else dict(self.reference_filters),
               "group_by": self.group_by, "aggregation": self.aggregation, "missing_policy": self.missing_policy}
        if self.column2 is not None:  # only present for correlation, so earlier identifiers are unchanged
            out["column2"] = self.column2
        return out


@dataclass(frozen=True)
class RowUsage:
    selected_rows: tuple[int, ...]
    used_rows: tuple[int, ...]
    omitted_rows: tuple[int, ...]
    filtered_out_count: int

    def as_dict(self) -> dict:
        return {"selected_rows": list(self.selected_rows), "used_rows": list(self.used_rows),
                "omitted_rows": list(self.omitted_rows), "filtered_out_count": self.filtered_out_count}


@dataclass(frozen=True)
class GroupResult:
    group: str
    value: Decimal
    used_rows: int
    rank: int | None = None


@dataclass(frozen=True)
class CalculationResult:
    dataset_id: str
    dataset_version: str
    source_sha256: str
    calculation_id: str
    spec: CalculationSpec
    value: Decimal | None
    groups: tuple[GroupResult, ...]
    unit: str | None
    usage: RowUsage
    reference_usage: RowUsage | None
    expression: str
    warnings: tuple[str, ...]
    extra: dict | None = None  # statistics only: alternative definitions, p-value, argmax rows

    def as_dict(self) -> dict:
        out = self._base_dict()
        if self.extra is not None:
            out["extra"] = self.extra
        return out

    def _base_dict(self) -> dict:
        return {"contract_version": CONTRACT_VERSION, "dataset_id": self.dataset_id, "dataset_version": self.dataset_version,
                "source_sha256": self.source_sha256, "calculation_id": self.calculation_id, "spec": self.spec.as_dict(),
                "value": None if self.value is None else decimal_text(self.value), "unit": self.unit,
                "groups": [{"group": g.group, "value": decimal_text(g.value), "used_rows": g.used_rows, "rank": g.rank} for g in self.groups],
                "usage": self.usage.as_dict(), "reference_usage": None if self.reference_usage is None else self.reference_usage.as_dict(),
                "expression": self.expression, "warnings": list(self.warnings),
                "precision": 34, "rounding": "ROUND_HALF_EVEN", "unit_provenance": "CALLER_ASSERTED_NOT_INFERRED"}


def _selection(dataset: TableDataset, spec: CalculationSpec, filters: tuple[tuple[str, str], ...]) -> tuple[list[tuple[int, Decimal]], RowUsage]:
    columns = {name: i for i, name in enumerate(dataset.columns)}
    if spec.column not in columns or any(name not in columns for name, _ in filters):
        raise StatGuardError("UNKNOWN_COLUMN")
    selected, used, omitted, values = [], [], [], []
    for index, row in enumerate(dataset.rows, 1):
        if not all(row[columns[name]] == value for name, value in filters):
            continue
        selected.append(index)
        text = row[columns[spec.column]]
        if not text.strip():
            if spec.missing_policy == "reject":
                raise StatGuardError("MISSING_NUMERIC_VALUE")
            omitted.append(index)
            continue
        values.append((index, parse_number(text)))
        used.append(index)
    if not selected:
        raise StatGuardError("EMPTY_SELECTION")
    if not values:
        raise StatGuardError("NO_NUMERIC_ROWS")
    return values, RowUsage(tuple(selected), tuple(used), tuple(omitted), len(dataset.rows) - len(selected))


def execute(dataset: TableDataset, spec: CalculationSpec) -> CalculationResult:
    """Execute an explicit specification; this does not interpret a question."""
    if not isinstance(dataset, TableDataset) or not isinstance(spec, CalculationSpec):
        raise StatGuardError("INVALID_CORE_INPUT")
    if spec.operation in STATISTICS:
        return _execute_statistic(dataset, spec)
    with localcontext(ARITHMETIC):
        values, usage = _selection(dataset, spec, spec.filters)
        total = sum((value for _, value in values), Decimal(0))
        value, groups, reference_usage = None, (), None
        unit = dataset.unit_for(spec.column)
        warnings = [] if unit else ["UNIT_NOT_CONFIRMED"]
        if usage.omitted_rows:
            warnings.append("NUMERIC_ROWS_OMITTED")
        if spec.operation == "sum":
            value, expression = total, f"sum({spec.column}) = {decimal_text(total)}"
        elif spec.operation == "mean":
            value = total / Decimal(len(values))
            expression = f"{decimal_text(total)} / {len(values)}"
        elif spec.operation in {"ratio_percent", "percent_change"}:
            reference, reference_usage = _selection(dataset, spec, spec.reference_filters)
            base = sum((v for _, v in reference), Decimal(0))
            if reference_usage.omitted_rows:
                warnings.append("REFERENCE_NUMERIC_ROWS_OMITTED")
            if spec.operation == "percent_change":
                if set(usage.selected_rows) & set(reference_usage.selected_rows):
                    raise StatGuardError("OVERLAPPING_COMPARISON")
                if base <= 0:
                    raise StatGuardError("NON_POSITIVE_BASELINE")
                value = (total - base) / base * 100
                expression = f"({decimal_text(total)} - {decimal_text(base)}) / {decimal_text(base)} * 100"
            else:
                if base == 0:
                    raise StatGuardError("ZERO_DENOMINATOR")
                value = total / base * 100
                expression = f"{decimal_text(total)} / {decimal_text(base)} * 100"
            unit = "%"
        else:
            if spec.group_by not in dataset.columns:
                raise StatGuardError("UNKNOWN_COLUMN")
            group_index = dataset.columns.index(spec.group_by)
            grouped: dict[str, list[Decimal]] = {}
            # A missing group is not hidden by omitting its numeric cell.
            if any(not dataset.rows[i - 1][group_index].strip() for i in usage.selected_rows):
                raise StatGuardError("MISSING_GROUP_KEY")
            for index, number in values:
                grouped.setdefault(dataset.rows[index - 1][group_index], []).append(number)
            items = []
            for key, numbers in grouped.items():
                result = sum(numbers, Decimal(0))
                if spec.aggregation == "mean":
                    result /= len(numbers)
                items.append(GroupResult(key, result, len(numbers)))
            if spec.operation == "rank":
                ordered = sorted(items, key=lambda g: (-g.value, g.group))
                dense, previous, ranked = 0, None, []
                for item in ordered:
                    if previous is None or item.value != previous:
                        dense += 1
                    ranked.append(GroupResult(item.group, item.value, item.used_rows, dense))
                    previous = item.value
                groups = tuple(ranked)
                expression = f"dense_rank_desc(sum({spec.column}), group_by={spec.group_by})"
            else:
                groups = tuple(sorted(items, key=lambda g: g.group))
                expression = f"{spec.aggregation}({spec.column}), group_by={spec.group_by}"
        identifier = _hash({"contract": CONTRACT_VERSION, "dataset_version": dataset.dataset_version, "spec": spec.as_dict()})
        return CalculationResult(dataset.dataset_id, dataset.dataset_version, dataset.source_sha256, identifier, spec, value,
                                 groups, unit, usage, reference_usage, expression, tuple(warnings))


def _sum_squares(values: list[Decimal]) -> tuple[Decimal, Decimal]:
    mean = sum(values, Decimal(0)) / len(values)
    return mean, sum(((v - mean) ** 2 for v in values), Decimal(0))


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the regularized incomplete beta (Numerical Recipes, Lentz)."""
    tiny, qab, qap, qam = 1e-300, a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d; d = tiny if abs(d) < tiny else d
        c = 1.0 + aa / c; c = tiny if abs(c) < tiny else c
        d = 1.0 / d; h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d; d = tiny if abs(d) < tiny else d
        c = 1.0 + aa / c; c = tiny if abs(c) < tiny else c
        d = 1.0 / d; delta = d * c; h *= delta
        if abs(delta - 1.0) < 1e-15:
            break
    return h


def t_two_sided_p(t: float, df: float) -> float:
    """Two-sided p-value of Student's t via the regularized incomplete beta function (float)."""
    import math
    x = df / (df + t * t)
    if x <= 0.0:
        return 0.0
    a, b = df / 2.0, 0.5
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    ibeta = front * _betacf(a, b, x) / a if x < (a + 1.0) / (a + b + 2.0) else 1.0 - front * _betacf(b, a, 1.0 - x) / b
    return min(1.0, max(0.0, ibeta))


def _execute_statistic(dataset: TableDataset, spec: CalculationSpec) -> CalculationResult:
    """Descriptive statistics, Pearson correlation and Welch's two-sample t-test."""
    with localcontext(ARITHMETIC):
        pairs, usage = _selection(dataset, spec, spec.filters)
        values = [v for _, v in pairs]
        unit = dataset.unit_for(spec.column)
        warnings = [] if unit else ["UNIT_NOT_CONFIRMED"]
        if usage.omitted_rows:
            warnings.append("NUMERIC_ROWS_OMITTED")
        reference_usage, extra, op = None, {}, spec.operation
        if op in ("variance", "stdev"):
            if len(values) < 2:
                raise StatGuardError("INSUFFICIENT_ROWS")
            _, ss = _sum_squares(values)
            sample, population = ss / (len(values) - 1), ss / len(values)
            if op == "stdev":
                sample, population = sample.sqrt(), population.sqrt()
            value = sample
            extra = {"sample": decimal_text(sample), "population": decimal_text(population), "n": len(values),
                     "default_definition": "SAMPLE_N_MINUS_1"}
            expression = f"{'sqrt(' if op == 'stdev' else ''}sum((x - mean)^2) / (n - 1){')' if op == 'stdev' else ''}, n = {len(values)}"
            unit = None if unit is None else (unit if op == "stdev" else f"{unit}²")
        elif op == "median":
            ordered, n = sorted(values), len(values)
            value = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
            expression = f"median({spec.column}), n = {n}"
        elif op in ("max", "min"):
            value = max(values) if op == "max" else min(values)
            extra = {"rows": [i for i, v in pairs if v == value]}
            expression = f"{op}({spec.column}), n = {len(values)}"
        elif op == "correlation":
            if spec.column2 not in dataset.columns:
                raise StatGuardError("UNKNOWN_COLUMN")
            second = dataset.columns.index(spec.column2)
            ys = []
            for index, _ in pairs:
                text = dataset.rows[index - 1][second]
                if not text.strip():
                    raise StatGuardError("MISSING_NUMERIC_VALUE")
                ys.append(parse_number(text))
            if len(values) < 3:
                raise StatGuardError("INSUFFICIENT_ROWS")
            mx, sxx = _sum_squares(values)
            my, syy = _sum_squares(ys)
            if sxx == 0 or syy == 0:
                raise StatGuardError("ZERO_VARIANCE")
            sxy = sum(((x - mx) * (y - my) for x, y in zip(values, ys)), Decimal(0))
            value = sxy / (sxx * syy).sqrt()
            extra = {"n": len(values), "column2": spec.column2}
            expression = f"pearson_r({spec.column}, {spec.column2}), n = {len(values)}"
            unit, warnings = "", [w for w in warnings if w != "UNIT_NOT_CONFIRMED"]
        else:  # t_test: Welch, two-sided
            reference, reference_usage = _selection(dataset, spec, spec.reference_filters)
            if set(usage.selected_rows) & set(reference_usage.selected_rows):
                raise StatGuardError("OVERLAPPING_COMPARISON")
            b = [v for _, v in reference]
            if len(values) < 2 or len(b) < 2:
                raise StatGuardError("INSUFFICIENT_ROWS")
            ma, ssa = _sum_squares(values)
            mb, ssb = _sum_squares(b)
            va, vb = ssa / (len(values) - 1), ssb / (len(b) - 1)
            se2 = va / len(values) + vb / len(b)
            if se2 == 0:
                raise StatGuardError("ZERO_VARIANCE")
            value = (ma - mb) / se2.sqrt()
            df = se2 ** 2 / ((va / len(values)) ** 2 / (len(values) - 1) + (vb / len(b)) ** 2 / (len(b) - 1))
            p = t_two_sided_p(float(value), float(df))
            extra = {"p_value": format(p, ".12g"), "df": decimal_text(df.quantize(Decimal("0.0001"))), "mean_selection": decimal_text(ma),
                     "mean_reference": decimal_text(mb), "n_selection": len(values), "n_reference": len(b),
                     "method": "WELCH_TWO_SIDED", "p_value_precision": "FLOAT64_APPROXIMATION"}
            expression = f"welch_t = (mean_sel - mean_ref) / sqrt(var_sel/n_sel + var_ref/n_ref), df = {extra['df']}"
            unit = ""
            warnings = [w for w in warnings if w != "UNIT_NOT_CONFIRMED"]
        identifier = _hash({"contract": CONTRACT_VERSION, "dataset_version": dataset.dataset_version, "spec": spec.as_dict()})
        return CalculationResult(dataset.dataset_id, dataset.dataset_version, dataset.source_sha256, identifier, spec, value,
                                 (), unit, usage, reference_usage, expression, tuple(warnings), extra)


@dataclass(frozen=True)
class NumericClaim:
    dataset_version: str
    calculation_id: str
    value: str
    unit: str


@dataclass(frozen=True)
class Tolerance:
    absolute: Decimal
    relative: Decimal = Decimal(0)

    def __post_init__(self) -> None:
        if any(not isinstance(v, Decimal) or not v.is_finite() or v < 0 for v in (self.absolute, self.relative)):
            raise StatGuardError("INVALID_TOLERANCE")
        if self.absolute > Decimal("1000000000000000000") or self.relative > 1:
            raise StatGuardError("INVALID_TOLERANCE")


def verify_numeric_claim(result: CalculationResult, claim: NumericClaim, *, tolerance: Tolerance) -> dict:
    """Only a manually linked scalar claim; not semantic or causal verification."""
    base = {"dataset_version": result.dataset_version, "calculation_id": result.calculation_id,
            "status": "INSUFFICIENT_EVIDENCE", "reason_code": None,
            "absolute_tolerance": decimal_text(tolerance.absolute), "relative_tolerance": decimal_text(tolerance.relative),
            "warnings": list(result.warnings),
            "scope": "EXPLICIT_CALCULATION_ONLY_NOT_WHOLE_ANSWER_TRUTH"}
    if claim.dataset_version != result.dataset_version or claim.calculation_id != result.calculation_id:
        return dict(base, reason_code="CALCULATION_LINKAGE_MISMATCH")
    if result.value is None:
        return dict(base, reason_code="NON_SCALAR_CLAIM_NOT_SUPPORTED")
    if "UNIT_NOT_CONFIRMED" in result.warnings or result.unit is None or claim.unit != result.unit:
        return dict(base, reason_code="UNIT_NOT_CONFIRMED_OR_MISMATCH")
    try:
        actual_claim = parse_number(claim.value)
    except StatGuardError:
        return dict(base, reason_code="CLAIM_NUMERIC_VALUE_INVALID")
    with localcontext(ARITHMETIC):
        allowed = max(tolerance.absolute, tolerance.relative * abs(result.value))
        agrees = abs(actual_claim - result.value) <= allowed
    return dict(base, status="VERIFIED_WITHIN_SCOPE" if agrees else "CONTRADICTED",
                reason_code="WITHIN_EXPLICIT_TOLERANCE" if agrees else "NUMERIC_VALUE_CONFLICT",
                computed_value=decimal_text(result.value), claimed_value=decimal_text(actual_claim), unit=result.unit)

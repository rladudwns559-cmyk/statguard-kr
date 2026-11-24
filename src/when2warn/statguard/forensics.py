"""Error forensics: for a CONTRADICTED claim, search a fixed, bounded list of common calculation mistakes for one that
reproduces the claimed number exactly (within the claim's stated precision). Deterministic; no LLM; exact Decimal arithmetic.

A reproduction is a likely cause, not proof: the same wrong number can sometimes be produced by more than one mistake,
so every diagnosis also reports how many other hypotheses matched.
"""
from __future__ import annotations

import re
from decimal import Decimal, localcontext
from itertools import combinations

from .core import ARITHMETIC, CalculationSpec, StatGuardError, TableDataset, _selection, decimal_text, execute, parse_number, t_two_sided_p

FORENSICS_VERSION = "statguard-forensics-v0.1"
MAX_ROWS_SINGLE = 5000   # leave-one-out search
MAX_ROWS_PAIR = 150      # leave-two-out search (≤ 11,175 pairs)
SCALES = (-3, -2, -1, 1, 2, 3)
NOTE = "AI의 숫자와 똑같은 값이 나오는 계산 실수를 찾은 것입니다. 실제 원인일 가능성이 높지만 증명은 아닙니다."
# Chance model: a wrong number anywhere within ±20% of the true value. A hypothesis family whose candidate values cover
# `coverage` of that band would "explain" a random wrong number with probability ≈ coverage / band. Families above
# CHANCE_DROP are not reported (unless the answer itself states the implied row count); below CHANCE_HIGH → 확신 높음.
BAND = Decimal("0.4")
CHANCE_HIGH, CHANCE_DROP = 0.05, 0.25


def _is_number(text: str) -> bool:
    try:
        parse_number(text)
        return True
    except StatGuardError:
        return False


def _label_columns(dataset: TableDataset) -> list[int]:
    """Up to two identifying (non-numeric, varying) columns, used to name a row for people."""
    out = []
    for i, _ in enumerate(dataset.columns):
        cells = [r[i] for r in dataset.rows]
        if len(set(cells)) > 1 and not all(_is_number(c) for c in cells if c.strip()):
            out.append(i)
        if len(out) == 2:
            break
    if not out:  # e.g. a date column parsed as a number is unusual; fall back to the first column
        out = [0]
    return out


def _row_label(dataset: TableDataset, row: int) -> str:
    return " · ".join(dataset.rows[row - 1][i] for i in _label_columns(dataset))


_COUNT = re.compile(r"([0-9][0-9,]*)\s*(?:개국|개|곳|일|건|명|행|국가|도시|달|개월)")
_N_MINUS_1 = re.compile(r"n\s*[-−]\s*1\s*=\s*([0-9]+)")


def stated_counts(sentence: str) -> set[int]:
    """Row counts the answer itself states ("고소득 국가 60개", "46곳", "n-1=45")."""
    out = {int(m.group(1).replace(",", "")) for m in _COUNT.finditer(sentence)}
    out |= {int(m.group(1)) + 1 for m in _N_MINUS_1.finditer(sentence)}
    return out


def _josa(word: str, pair: str) -> str:
    """을/를, 이/가, 와/과 by the final syllable of a Korean word."""
    last = word[-1]
    has_final = "가" <= last <= "힣" and (ord(last) - 0xAC00) % 28 != 0
    a, b = pair.split("/")
    return word + (a if has_final else b)


_DIGIT_FINAL = {"0": True, "1": "ㄹ", "2": False, "3": True, "4": False, "5": False, "6": True, "7": "ㄹ", "8": "ㄹ", "9": False}
_UNIT_RO = {"%": "로", "%p": "로", "mm": "로", "℃": "로", "°C": "로"}


def _ro(text: str) -> str:
    """Append 으로/로 by how the last character is read (ㄹ-final and vowel-final take 로)."""
    for unit, particle in _UNIT_RO.items():
        if text.endswith(unit):
            return text + particle
    last = text[-1]
    if "가" <= last <= "힣":
        final = (ord(last) - 0xAC00) % 28
        return text + ("로" if final in (0, 8) else "으로")
    if last in _DIGIT_FINAL:
        f = _DIGIT_FINAL[last]
        return text + ("으로" if f is True else "로")
    return text + "(으)로"


_DIGIT_WA = {"0": "과", "1": "과", "2": "와", "3": "과", "4": "와", "5": "와", "6": "과", "7": "과", "8": "과", "9": "와"}


def _wa(text: str) -> str:
    """Append 과/와 by how the last character is read."""
    for unit in ("%p", "%", "mm", "℃", "°C"):
        if text.endswith(unit):
            return text + "와"
    last = text[-1]
    if "가" <= last <= "힣":
        return text + ("와" if (ord(last) - 0xAC00) % 28 == 0 else "과")
    return text + _DIGIT_WA.get(last, "와(과)")


_AMOUNT = re.compile(r"(?<![0-9.,])[0-9][0-9,]*(?:\.[0-9]+)?(?![0-9.,])(?!\s*(?:년|월|일|분기|개|곳|인당|위|번째|차))")


def _amounts(sentence: str) -> int:
    """How many amounts (not years, months, days or counts) a sentence states."""
    return len(_AMOUNT.findall(sentence))


def _stats(values: list[Decimal]) -> dict:
    n = len(values)
    s = sum(values, Decimal(0))
    q = sum((v * v for v in values), Decimal(0))
    return {"n": n, "s": s, "q": q}


def _value(op: str, n: int, s: Decimal, q: Decimal) -> Decimal | None:
    """sum / mean / sample variance / sample stdev from count, sum and sum of squares."""
    if op == "sum":
        return s
    if n < 1:
        return None
    if op == "mean":
        return s / n
    if n < 2:
        return None
    var = (q - s * s / n) / (n - 1)
    if var < 0:
        var = Decimal(0)
    return var if op == "variance" else var.sqrt()


def _median(values: list[Decimal]) -> Decimal:
    o, n = sorted(values), len(values)
    return o[n // 2] if n % 2 else (o[n // 2 - 1] + o[n // 2]) / 2


def _corr(xs: list[Decimal], ys: list[Decimal]) -> Decimal | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs, Decimal(0)) / n, sum(ys, Decimal(0)) / n
    sxx = sum(((x - mx) ** 2 for x in xs), Decimal(0))
    syy = sum(((y - my) ** 2 for y in ys), Decimal(0))
    if sxx == 0 or syy == 0:
        return None
    return sum(((x - mx) * (y - my) for x, y in zip(xs, ys)), Decimal(0)) / (sxx * syy).sqrt()


_OP_KO = {"sum": "합계", "mean": "평균", "median": "중앙값", "stdev": "표준편차", "variance": "분산", "max": "최댓값", "min": "최솟값",
          "correlation": "상관계수", "ratio_percent": "비율", "percent_change": "증감률", "t_test": "t-검정"}


class _Search:
    def __init__(self, dataset: TableDataset, claim: dict, others: list[dict]):
        self.ds, self.claim, self.others = dataset, claim, others
        self.spec = CalculationSpec.from_mapping(claim["spec"])
        self.target = Decimal(claim["claimed"]["value"])
        self.tol = Decimal(claim["claimed"]["tolerance"])
        self.unit = claim["claimed"].get("unit") or ""
        self.counts = stated_counts(claim.get("sentence") or "")
        try:
            truth = execute(dataset, self.spec).value
        except StatGuardError:
            truth = None
        self.band = max(abs(truth if truth is not None else self.target) * BAND, self.tol * 20, Decimal("1e-12"))
        self.found: list[dict] = []

    def chance(self, values) -> float:
        """Share of the ±20% band covered by candidate values (each covers ±tol), i.e. the chance a random wrong number matches one."""
        width = self.tol * 2 if self.tol > 0 else Decimal("1e-9")
        buckets = {(v / width).to_integral_value() for v in values if v is not None}
        return float(min(Decimal(1), len(buckets) * width / self.band))

    def hit(self, value: Decimal | None) -> bool:
        return value is not None and abs(value - self.target) <= self.tol

    def add(self, kind: str, title: str, explanation: str, value: Decimal, rows: list[int] | None = None, candidates: int = 1,
            chance: float = 0.0, said: bool = False):
        """Record a reproduction unless it would match random wrong numbers too often (said = the answer states the implied count)."""
        if chance >= CHANCE_DROP and not said:
            return
        confidence = "high" if chance < CHANCE_HIGH and candidates == 1 or said and candidates == 1 else "medium"
        self.found.append({"kind": kind, "title": title, "explanation": explanation, "reproduced_value": decimal_text(value),
                           "rows": rows or [], "candidates": candidates, "confidence": confidence, "chance": round(chance, 4)})

    def fmt(self, v: Decimal) -> str:
        """The reproduced value rounded to the precision the answer itself used, so it reads exactly like the answer."""
        step = (self.tol * 2).normalize() if self.tol > 0 else Decimal("0.0001")
        q = v.quantize(step) if step.as_tuple().exponent < 0 else v.quantize(Decimal(1))
        return f"{q:,f}{self.unit}" if abs(q) >= 10000 else f"{decimal_text(q)}{self.unit}"

    def ro(self, v: Decimal) -> str:
        return _ro(self.fmt(v))

    def op(self, op: str | None = None) -> str:
        return _josa(_OP_KO[op or self.spec.operation], "을/를")

    # --- hypotheses, most specific first ---

    def propagated(self):
        """A ratio/percent built on another number the answer itself stated (and got wrong)."""
        sp = self.spec
        if sp.operation not in ("ratio_percent", "percent_change") or sp.reference_filters is None:
            return
        sel = sum((v for _, v in _selection(self.ds, sp, sp.filters, sp.value_sets or ())[0]), Decimal(0))
        ref = sum((v for _, v in _selection(self.ds, sp, sp.reference_filters)[0]), Decimal(0))
        for o in self.others:
            c = o.get("claimed") or {}
            if c.get("value") is None or o is self.claim or o.get("status") != "CONTRADICTED":
                continue
            used = Decimal(c["value"])
            if used == 0:
                continue
            tries = ([(sel / used * 100, "분모"), (used / ref * 100 if ref else None, "분자")] if sp.operation == "ratio_percent"
                     else [((sel - used) / used * 100, "기준값"), ((used - ref) / ref * 100 if ref else None, "비교값")])
            odds = self.chance([v for v, _ in tries])
            for value, role in tries:
                if self.hit(value):
                    self.add("PROPAGATED", "앞의 틀린 숫자를 그대로 사용",
                             f"답변이 다른 문장에서 틀리게 말한 ‘{c['text']}’라는 값을 {role}로 쓰면 {self.ro(value)} 답변의 숫자와 같습니다. 앞 문장의 오류가 이 계산으로 번졌습니다.",
                             value, chance=odds)
                    return

    def definition(self):
        sp, op = self.spec, self.spec.operation
        if op not in ("sum", "mean", "median", "stdev", "variance"):
            return
        pairs, _ = _selection(self.ds, sp, sp.filters, sp.value_sets or ())
        values = [v for _, v in pairs]
        st = _stats(values)
        alts = {"sum": ["mean"], "mean": ["median", "sum"], "median": ["mean"], "stdev": ["variance"], "variance": ["stdev"]}[op]
        cands = {alt: _median(values) if alt == "median" else _value(alt, st["n"], st["s"], st["q"]) for alt in alts}
        odds = self.chance(cands.values())
        for alt, value in cands.items():
            if self.hit(value):
                self.add("WRONG_STATISTIC", f"{_OP_KO[op]} 대신 {_OP_KO[alt]}",
                         f"같은 {st['n']}개 행의 {self.op(alt)} 구하면 {self.ro(value)} 답변의 숫자와 같습니다. 질문은 {self.op(op)} 물었습니다.", value, chance=odds)

    def omitted(self):
        sp, op = self.spec, self.spec.operation
        if op not in ("sum", "mean", "stdev", "variance", "median", "max", "min", "correlation"):
            return
        pairs, _ = _selection(self.ds, sp, sp.filters, sp.value_sets or ())
        rows, values = [i for i, _ in pairs], [v for _, v in pairs]
        n = len(values)
        if n < 3 or n > MAX_ROWS_SINGLE:
            return
        if op == "correlation":
            y_index = self.ds.columns.index(sp.column2)
            ys = [parse_number(self.ds.rows[i - 1][y_index]) for i in rows]
            if n > 400:
                return
            single = [(k, _corr(values[:k] + values[k + 1:], ys[:k] + ys[k + 1:])) for k in range(n)]
        elif op in ("median", "max", "min"):
            if n > 2000:
                return
            fn = {"median": _median, "max": max, "min": min}[op]
            single = [(k, fn(values[:k] + values[k + 1:])) for k in range(n)]
        else:
            st = _stats(values)
            single = [(k, _value(op, n - 1, st["s"] - v, st["q"] - v * v)) for k, v in enumerate(values)]
        matches = [k for k, value in single if self.hit(value)]
        if matches:
            # A missing first/last row is the most common slip (off-by-one range); prefer it when it is among the matches.
            k = n - 1 if n - 1 in matches else 0 if 0 in matches else matches[0]
            value = dict(single)[k]
            where = "마지막 " if k == n - 1 else "첫 " if k == 0 else ""
            said = (n - 1) in self.counts
            extra = (f" 답변도 스스로 {n - 1}개라고 적었습니다." if said else "") + \
                    ("" if len(matches) == 1 else f" 같은 값이 나오는 행이 {len(matches)}개라 어느 행인지는 특정할 수 없습니다.")
            self.add("OMITTED_ROW", "행 하나를 빠뜨림",
                     f"{n}개 행 중 {where}‘{_row_label(self.ds, rows[k])}’ 행(값 {decimal_text(values[k])})을 빼고 {self.op()} 구하면 {self.ro(value)} 답변의 숫자와 같습니다.{extra}",
                     value, [rows[k]] if len(matches) == 1 else [rows[i] for i in matches], len(matches),
                     chance=self.chance(v for _, v in single), said=said)
            return
        if op in ("sum", "mean"):
            st = _stats(values)
            doubled = [_value(op, n + 1, st["s"] + v, st["q"] + v * v) for v in values]
            dup = [k for k, v in enumerate(doubled) if self.hit(v)]
            if dup:
                k = dup[0]
                value = _value(op, n + 1, st["s"] + values[k], st["q"] + values[k] ** 2)
                self.add("DOUBLE_COUNTED", "행 하나를 두 번 셈",
                         f"‘{_row_label(self.ds, rows[k])}’ 행(값 {decimal_text(values[k])})을 두 번 넣어 계산하면 {self.ro(value)} 답변의 숫자와 같습니다.",
                         value, [rows[k]], len(dup), chance=self.chance(doubled), said=(n + 1) in self.counts)
                if self.found:
                    return
        # Two missing rows: only when the answer itself states n-2 rows (otherwise ~n²/2 combinations match by chance too easily).
        if op in ("sum", "mean", "stdev", "variance") and n <= MAX_ROWS_PAIR and (n - 2) in self.counts:
            st = _stats(values)
            pair_values = {(a, b): _value(op, n - 2, st["s"] - values[a] - values[b], st["q"] - values[a] ** 2 - values[b] ** 2)
                           for a, b in combinations(range(n), 2)}
            pair_hits = [ab for ab, v in pair_values.items() if self.hit(v)]
            if pair_hits:
                a, b = pair_hits[0]
                value = _value(op, n - 2, st["s"] - values[a] - values[b], st["q"] - values[a] ** 2 - values[b] ** 2)
                who = (f"‘{_row_label(self.ds, rows[a])}’, ‘{_row_label(self.ds, rows[b])}’ 두 행" if len(pair_hits) == 1
                       else f"두 행(맞는 조합 {len(pair_hits)}개, 예: ‘{_row_label(self.ds, rows[a])}’, ‘{_row_label(self.ds, rows[b])}’)")
                self.add("OMITTED_ROWS", "행 두 개를 빠뜨림",
                         f"실제로는 {n}개 행인데 답변은 {n - 2}개라고 적었습니다. {who}을 빼고 {n - 2}개로 {self.op()} 구하면 {self.ro(value)} 답변의 숫자와 같습니다.",
                         value, [rows[a], rows[b]], len(pair_hits), chance=self.chance(pair_values.values()), said=True)

    def wrong_count(self):
        sp = self.spec
        if sp.operation != "mean":
            return
        pairs, _ = _selection(self.ds, sp, sp.filters, sp.value_sets or ())
        n, s = len(pairs), sum((v for _, v in pairs), Decimal(0))
        odds = self.chance([s / (n - 1) if n > 1 else None, s / (n + 1)])
        for m in (n - 1, n + 1):
            if m > 0 and self.hit(s / m):
                self.add("WRONG_COUNT", "개수를 잘못 셈", f"합계는 맞지만 {n}개가 아니라 {m}개로 나누면 {self.ro(s / m)} 답변의 숫자와 같습니다.", s / m, chance=odds, said=m in self.counts)

    def other_selection(self):
        """Same calculation on a different group (another filter value) or without a filter."""
        sp = self.spec
        if sp.operation in ("t_test",):
            return
        base = sp.as_dict()
        for key, val in sp.filters:
            col = self.ds.columns.index(key)
            options = sorted({r[col] for r in self.ds.rows} - {val})
            if len(options) > 60:
                continue
            cands = {other: self._run(dict(base, filters=dict(dict(sp.filters), **{key: other}))) for other in options}
            whole = self._run(dict(base, filters={k: v for k, v in sp.filters if k != key}))
            odds = self.chance([*cands.values(), whole])
            several = _amounts(self.claim.get("sentence") or "") >= 2
            for other, value in cands.items():
                if self.hit(value) and several:
                    self.add("SCOPE_AMBIGUOUS", "다른 범위의 값과 일치",
                             f"이 숫자는 ‘{key}={other}’의 {_OP_KO[sp.operation]} {_wa(self.fmt(value))} 같습니다. 문장에 숫자가 여러 개라 StatGuard가 이 숫자를 ‘{key}={val}’ 범위와 잘못 연결했을 수 있습니다. 숫자마다 문장을 나눠 다시 확인하세요.",
                             value, chance=odds)
                    return
                if self.hit(value):
                    self.add("WRONG_GROUP", "다른 범위를 계산함", f"‘{key}={val}’이 아니라 ‘{key}={other}’의 {self.op()} 구하면 {self.ro(value)} 답변의 숫자와 같습니다.", value, chance=odds)
                    return
            if self.hit(whole) and several:
                self.add("SCOPE_AMBIGUOUS", "전체 범위의 값과 일치",
                         f"이 숫자는 ‘{key}={val}’ 조건이 없는 전체의 {_OP_KO[sp.operation]} {_wa(self.fmt(whole))} 같습니다. 문장에 숫자가 여러 개라 StatGuard가 이 숫자를 ‘{key}={val}’ 범위와 잘못 연결했을 수 있습니다. 숫자마다 문장을 나눠 다시 확인하세요.",
                         whole, chance=odds)
                return
            if self.hit(whole):
                self.add("FILTER_IGNORED", "조건을 빠뜨림", f"‘{key}={val}’ 조건 없이 전체의 {self.op()} 구하면 {self.ro(whole)} 답변의 숫자와 같습니다.", whole, chance=odds)
                return

    def other_column(self):
        sp = self.spec
        numeric = [c for i, c in enumerate(self.ds.columns) if c != sp.column and c != sp.column2
                   and all(_is_number(r[i]) for r in self.ds.rows if r[i].strip())]
        base = sp.as_dict()
        if sp.operation == "correlation":
            cands = {(c, c2): self._run(dict(base, column=c, column2=c2)) for c in numeric for c2 in [x for x in numeric if x != c] + [sp.column]}
            odds = self.chance(cands.values())
            for (c, c2), value in cands.items():
                if self.hit(value):
                    self.add("WRONG_COLUMN", "다른 열을 계산함", f"‘{sp.column}’·‘{sp.column2}’이 아니라 ‘{c}’·‘{c2}’의 상관계수를 구하면 {self.ro(value)} 답변의 숫자와 같습니다.", value, chance=odds)
                    return
            return
        cands = {c: self._run(dict(base, column=c)) for c in numeric}
        odds = self.chance(cands.values())
        sentence = self.claim.get("sentence") or ""
        for c, value in cands.items():
            if self.hit(value) and (c in sentence or (len(c) > 2 and c.lstrip("총") in sentence)):
                self.add("SCOPE_AMBIGUOUS", "다른 열의 값과 일치",
                         f"이 숫자는 ‘{c}’ 열의 {_OP_KO[sp.operation]} {_wa(self.fmt(value))} 같습니다. 문장에 ‘{c}’가 나오는데 StatGuard가 ‘{sp.column}’ 열과 잘못 연결했을 수 있습니다. 문장을 다시 확인하세요.",
                         value, chance=odds)
                return
            if self.hit(value):
                self.add("WRONG_COLUMN", "다른 열을 계산함", f"‘{sp.column}’이 아니라 ‘{c}’ 열의 {self.op()} 구하면 {self.ro(value)} 답변의 숫자와 같습니다.", value, chance=odds)
                return

    def test_variant(self):
        sp = self.spec
        if sp.operation != "t_test" or self.claim["claimed"].get("target") != "p_value":
            return
        result = execute(self.ds, sp)
        p = Decimal(result.extra["p_value"])
        if self.hit(p / 2):
            self.add("ONE_SIDED", "양측 대신 단측 검정", f"양측 p값 {decimal_text(p.quantize(Decimal('0.0001')))}의 절반(단측 p값)이 {self.ro(p / 2)} 답변의 숫자와 같습니다.", p / 2, chance=self.chance([p / 2]))

    def scale(self):
        try:
            computed = execute(self.ds, self.spec).value
        except StatGuardError:
            return
        if computed is None or computed == 0:
            return
        odds = self.chance([computed * Decimal(10) ** k for k in SCALES])
        for k in SCALES:
            value = computed * Decimal(10) ** k
            if self.hit(value):
                self.add("SCALE", "자릿수(단위) 오류", f"올바른 값에 10^{k}를 곱하면 {self.ro(value)} 답변의 숫자와 같습니다. 단위를 바꾸거나 자릿수를 잘못 옮긴 것으로 보입니다.", value, chance=odds)
                return

    def _run(self, raw: dict) -> Decimal | None:
        try:
            return execute(self.ds, CalculationSpec.from_mapping(raw)).value
        except StatGuardError:
            return None

    def run(self) -> dict | None:
        with localcontext(ARITHMETIC):
            for step in (self.propagated, self.definition, self.omitted, self.wrong_count, self.test_variant,
                         self.other_selection, self.other_column, self.scale):
                try:
                    step()
                except (StatGuardError, ValueError, ArithmeticError, IndexError, KeyError):
                    continue
        if not self.found:
            return None
        best = dict(self.found[0])
        best["other_explanations"] = [f["title"] for f in self.found[1:]]
        best["note"] = NOTE
        return best


def diagnose_claim(dataset: TableDataset, claim: dict, others: list[dict] | None = None) -> dict | None:
    if claim.get("status") != "CONTRADICTED" or not claim.get("spec"):
        return None
    claimed = claim.get("claimed") or {}
    if claimed.get("value") is None or claimed.get("tolerance") is None or claimed.get("comparator") or claimed.get("target") == "significance":
        return None
    return _Search(dataset, claim, others or []).run()


def diagnose_answer(dataset: TableDataset, verification: dict) -> dict:
    """Return a copy of verify_answer()'s result with a 'diagnosis' on each CONTRADICTED claim that could be reproduced."""
    claims = verification.get("claims", [])
    out = []
    for c in claims:
        d = diagnose_claim(dataset, c, claims)
        out.append(dict(c, diagnosis=d) if d else c)
    found = sum(1 for c in out if c.get("diagnosis"))
    return dict(verification, claims=out, forensics={"version": FORENSICS_VERSION, "contradicted": sum(c.get("status") == "CONTRADICTED" for c in claims),
                                                       "explained": found})

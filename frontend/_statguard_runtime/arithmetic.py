"""Inline arithmetic check: recompute the calculations an answer writes out itself ("a + b + c = d", "(a − b) / b × 100 ≈ c%").
Needs no CSV and no LLM. Exact Decimal arithmetic; an expression is INCONSISTENT when its stated result differs from the
recomputed one by more than half a unit of the result's last written digit (the same rounding rule as claim verification).

Scope: only what the answer itself computes. A correct calculation on wrongly copied numbers is not detected here.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, localcontext

from .core import ARITHMETIC, decimal_text

ARITHMETIC_VERSION = "statguard-arithmetic-v0.1.1"  # v0.1.1: never read a fragment of a longer expression
MAX_ANSWER_CHARS = 6000
MAX_CHECKS = 30

_LATEX = [(re.compile(r"\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"), r"(\1)/(\2)"), (re.compile(r"\\(?:times|cdot)"), "×"), (re.compile(r"\\div"), "÷"),
          (re.compile(r"\\approx"), "≈"), (re.compile(r"\\%"), "%"), (re.compile(r"\\[()\[\]]"), " "), (re.compile(r"\\(?:left|right|,|;|!|quad)"), " "),
          (re.compile(r"\\text\s*\{([^{}]*)\}"), r"\1")]
_UNIT_AFTER_NUMBER = re.compile(r"(?<=[0-9])\s*(?:mm|cm|km|kg|명|달러|원|건|개|곳|세|일|℃|°C|%p|%)(?![0-9A-Za-z가-힣])")
_NUM = r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?"
_RESULT = re.compile(rf"[=≈]\s*(?:약\s*)?([-−]?{_NUM})(?![0-9])")
_ARITH_CHARS = set("0123456789.,()+-×/÷ \t")
_BINARY = re.compile(rf"{_NUM}\s*[)]*\s*[-+×/÷]\s*[(\s]*-?{_NUM}")


def _expressions(norm: str):
    """For each '=' / '≈' with a number after it, the whole arithmetic run right before it (never a fragment of a longer one)."""
    for m in _RESULT.finditer(norm):
        k = m.start()
        while k > 0 and norm[k - 1] in _ARITH_CHARS:
            k -= 1
        # "방문자수(500) × 100": the run is glued to a word, so it is the tail of a longer expression written with words
        if k > 0 and not norm[k].isspace() and norm[k - 1].isalnum():
            continue
        expression = norm[k:m.start()].strip()
        if expression.count("(") != expression.count(")") or not _BINARY.search(expression):
            continue
        yield expression, m.group(1)


_DATE = re.compile(r"(?:19|20)[0-9]{2}\s*-\s*[0-9]{1,2}\s*-\s*[0-9]{1,2}")
_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")  # a decimal point has no space after it, so "78.5" stays whole


def _normalize(text: str) -> str:
    for pattern, repl in _LATEX:
        text = pattern.sub(repl, text)
    text = _UNIT_AFTER_NUMBER.sub("", text)
    return text.replace("−", "-").replace("x", "×").replace("*", "×")


class _Parser:
    """expr := term (('+'|'-') term)* ; term := factor (('×'|'/'|'÷') factor)* ; factor := '-'? (number | '(' expr ')')."""

    def __init__(self, text: str):
        self.tokens = re.findall(rf"{_NUM}|[-+×/÷()]", text.replace(" ", ""))
        self.i = 0

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def take(self):
        token = self.peek(); self.i += 1; return token

    def expr(self) -> Decimal:
        value = self.term()
        while self.peek() in ("+", "-"):
            value = value + self.term() if self.take() == "+" else value - self.term()
        return value

    def term(self) -> Decimal:
        value = self.factor()
        while self.peek() in ("×", "/", "÷"):
            op, rhs = self.take(), self.factor()
            value = value * rhs if op == "×" else value / rhs
        return value

    def factor(self) -> Decimal:
        token = self.take()
        if token == "-":
            return -self.factor()
        if token == "(":
            value = self.expr()
            if self.take() != ")":
                raise ValueError("paren")
            return value
        if token is None or not re.fullmatch(_NUM, token):
            raise ValueError("number")
        return Decimal(token.replace(",", ""))

    def parse(self) -> Decimal:
        value = self.expr()
        if self.peek() is not None:
            raise ValueError("trailing")
        return value


def _decimals(text: str) -> int:
    return len(text.partition(".")[2])


def check_answer(answer: str) -> dict:
    """Every written-out calculation in the answer, recomputed. No CSV, no LLM."""
    if not isinstance(answer, str):
        raise TypeError("answer must be text")
    answer = answer[:MAX_ANSWER_CHARS]
    checks = []
    for sentence in (s.strip() for s in _SPLIT.split(answer)):
        if not sentence or len(checks) >= MAX_CHECKS:
            continue
        norm = _normalize(sentence)
        for expression, stated in _expressions(norm):
            stated = stated.replace("−", "-")
            if _DATE.search(expression):
                continue
            try:
                with localcontext(ARITHMETIC):
                    value = _Parser(expression).parse()
                    claimed = Decimal(stated.replace(",", ""))
                    tolerance = Decimal(5) * Decimal(10) ** (-(_decimals(stated) + 1))
                    consistent = abs(value - claimed) <= tolerance
            except (ValueError, InvalidOperation, ZeroDivisionError, ArithmeticError):
                continue
            checks.append({"sentence": sentence, "expression": re.sub(r"\s+", " ", expression), "stated": stated,
                           "recomputed": decimal_text(value), "tolerance": decimal_text(tolerance),
                           "status": "CONSISTENT" if consistent else "INCONSISTENT"})
            if len(checks) >= MAX_CHECKS:
                break
    summary = {"checked": len(checks), "inconsistent": sum(c["status"] == "INCONSISTENT" for c in checks)}
    return {"version": ARITHMETIC_VERSION, "checks": checks, "summary": summary,
            "scope": "WRITTEN_OUT_CALCULATIONS_ONLY_NOT_DATA_TRUTH"}

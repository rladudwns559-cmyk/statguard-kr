"""One-call use of StatGuard from Python (notebooks, scripts, other tools). No LLM, no network, nothing stored.

    from when2warn.statguard.api import verify, check_calculations
    report = verify("seattle.csv", "2023년 연간 강수량은 888.4mm입니다.", units={"강수량": "mm"})
    print(report.text())          # Korean summary: each number's verdict, the reproduced cause, written-out calculations
    report.summary                # {"VERIFIED": 0, "CONTRADICTED": 1, ...}

    check_calculations("78.5 + 60.1 = 140.6mm")   # no CSV: only the calculations the answer writes out
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .arithmetic import check_answer
from .claims import EXTRACTOR_VERSION, verify_answer
from .core import TableDataset, load_csv_bytes
from .forensics import diagnose_answer

STATUS_KO = {"VERIFIED": "계산 일치", "CONTRADICTED": "계산 불일치", "UNCERTAIN": "해석 불확실 · 보류", "INSUFFICIENT_EVIDENCE": "근거 부족 · 보류"}


@dataclass(frozen=True)
class Report:
    """Result of verify(): the claim verdicts (with forensics) and the inline arithmetic check."""
    verification: dict
    arithmetic: dict
    dataset: TableDataset

    @property
    def summary(self) -> dict:
        return dict(self.verification["summary"])

    @property
    def claims(self) -> list[dict]:
        return list(self.verification["claims"])

    @property
    def ok(self) -> bool:
        """True only when nothing contradicts and every written-out calculation is consistent (it says nothing about held claims)."""
        return not self.summary["CONTRADICTED"] and not self.arithmetic["summary"]["inconsistent"]

    def text(self) -> str:
        s = self.summary
        lines = [f"StatGuard ({EXTRACTOR_VERSION}) — 계산 일치 {s['VERIFIED']} · 계산 불일치 {s['CONTRADICTED']} · 보류 {s['UNCERTAIN'] + s['INSUFFICIENT_EVIDENCE']}"]
        for c in self.claims:
            lines.append(f"[{STATUS_KO[c['status']]}] {c['sentence']}")
            if c.get("computed") and c.get("claimed"):
                lines.append(f"    답변 {c['claimed']['text']} / 재계산 {c['computed']['value']} {c['computed']['unit']} ({c['computed']['expression']})")
            elif c["status"] != "VERIFIED":
                lines.append(f"    사유: {c['reason_code']}")
            if c.get("diagnosis"):
                d = c["diagnosis"]
                lines.append(f"    왜 틀렸을까({'확신 높음' if d['confidence'] == 'high' else '확신 중간'}): {d['title']} — {d['explanation']}")
        for a in self.arithmetic["checks"]:
            mark = "계산 틀림" if a["status"] == "INCONSISTENT" else "계산 맞음"
            lines.append(f"[검산 · {mark}] {a['expression']} = {a['stated']}" + (f" → 다시 계산하면 {a['recomputed']}" if a["status"] == "INCONSISTENT" else ""))
        return "\n".join(lines)


def _bytes(csv: str | Path | bytes) -> bytes:
    if isinstance(csv, bytes):
        return csv
    path = Path(csv)
    if path.suffix.lower() != ".csv" and "\n" in str(csv):
        return str(csv).encode("utf-8")  # CSV text passed directly
    return path.read_bytes()


def verify(csv: str | Path | bytes, answer: str, units: Mapping[str, str], encoding: str = "auto") -> Report:
    """Check every number in `answer` against `csv` (a path, CSV text or bytes). `units` maps numeric columns to their units."""
    dataset = load_csv_bytes(_bytes(csv), dataset_id="python", units=dict(units), encoding=encoding)
    verification = diagnose_answer(dataset, verify_answer(dataset, answer))
    return Report(verification=verification, arithmetic=check_answer(answer), dataset=dataset)


def check_calculations(answer: str) -> dict:
    """No CSV: recompute only the calculations the answer writes out ("a + b = c", "(a / b) × 100 ≈ c%")."""
    return check_answer(answer)

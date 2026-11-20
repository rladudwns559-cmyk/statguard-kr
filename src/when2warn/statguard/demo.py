"""Frozen synthetic fixture replay; never a provider or live evaluation runner."""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from pathlib import Path

from .core import CalculationSpec, NumericClaim, StatGuardError, Tolerance, execute, load_csv_bytes, verify_numeric_claim


def replay_case(root: Path, case: dict, fixture: dict) -> dict:
    source = fixture["datasets"][case["dataset"]]
    dataset = load_csv_bytes((root / "data/statguard_demo_v0.1" / source["file"]).read_bytes(),
                             dataset_id=case["dataset"], units=source["units"])
    record = {"case_id": case["case_id"], "expected": case.get("expected"), "expected_error": case.get("expected_error")}
    try:
        spec = CalculationSpec.from_mapping(case["spec"])
        result = execute(dataset, spec)
        actual = result.as_dict()
        record["result"] = actual
        expected = case.get("expected", {})
        agrees = "expected_error" not in case
        if "value" in expected:
            agrees = agrees and Decimal(actual["value"]) == Decimal(expected["value"])
        if "groups" in expected:
            agrees = agrees and [[g["group"], g["value"]] for g in actual["groups"]] == expected["groups"]
        if "ranks" in expected:
            agrees = agrees and [[g["group"], g["value"], g["rank"]] for g in actual["groups"]] == expected["ranks"]
        if "used_rows" in expected:
            agrees = agrees and len(actual["usage"]["used_rows"]) == expected["used_rows"]
        if "omitted_rows" in expected:
            agrees = agrees and len(actual["usage"]["omitted_rows"]) == expected["omitted_rows"]
        record["passed"] = agrees
    except StatGuardError as exc:
        record.update(observed_error=exc.code, passed=exc.code == case.get("expected_error"))
    return record


def replay_fixtures(root: Path) -> dict:
    precommit = json.loads((root / "artifacts/statguard_offline_core_v0.1/fixture_precommit.json").read_text(encoding="utf-8"))
    for relative, expected in precommit["fixture_sha256"].items():
        if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected:
            raise StatGuardError("FIXTURE_INTEGRITY_MISMATCH")
    fixture = json.loads((root / "data/statguard_demo_v0.1/cases_24.json").read_text(encoding="utf-8"))
    if len(fixture["cases"]) != 24 or [c["case_id"] for c in fixture["cases"]] != [f"SG-DEV-{i:03d}" for i in range(1, 25)]:
        raise StatGuardError("FIXTURE_CASE_SET_MISMATCH")
    records = [replay_case(root, case, fixture) for case in fixture["cases"]]
    source = fixture["datasets"]["visitors"]
    dataset = load_csv_bytes((root / "data/statguard_demo_v0.1" / source["file"]).read_bytes(), dataset_id="visitors", units=source["units"])
    result = execute(dataset, CalculationSpec.from_mapping(fixture["cases"][6]["spec"]))
    claims = [verify_numeric_claim(result, NumericClaim(result.dataset_version, result.calculation_id, value, "%"),
                                   tolerance=Tolerance(Decimal("0.05"))) for value in ("23.0", "17.8")]
    return {"milestone": "STATGUARD_OFFLINE_CORE_V0.1", "kind": fixture["kind"], "fixture_integrity_verified": True,
            "case_count": 24, "passed_cases": sum(r["passed"] for r in records), "cases": records,
            "manual_linked_synthetic_claims": claims, "paid_calls": 0, "external_search_fetch": 0,
            "api_db_ui_connected": False, "gpt_claim_extraction_implemented": False,
            "real_data_or_research_accuracy_evaluated": False}


def readable_report(report: dict) -> str:
    lines = ["# WHEN2WARN StatGuard 첫 계산 검증 결과", "",
             "합성 개발 사례의 오프라인 검증입니다. 실제 GPT 답변·업로드 서비스·연구 정확도 평가가 아닙니다.", "",
             f"미리 고정한 사례 {report['case_count']}개 중 기대 결과 일치: {report['passed_cases']}개.", "",
             "| 사례 | 연산 | 실제 결과 또는 거부 이유 | 기대값 일치 |", "|---|---|---|---|"]
    for case in report["cases"]:
        result = case.get("result")
        if result is None:
            operation, value = "거부 사례", case["observed_error"]
        elif result["value"] is not None:
            operation, value = result["spec"]["operation"], result["value"] + (" " + result["unit"] if result["unit"] else "")
        else:
            operation = result["spec"]["operation"]
            value = ", ".join(f"{g['group']}: {g['value']}" + (f" (순위 {g['rank']})" if g['rank'] else "") for g in result["groups"])
        lines.append(f"| {case['case_id']} | {operation} | {value} | {'예' if case['passed'] else '아니오'} |")
    lines += ["", "## 설명용 수치 주장 비교", "",
              "A지역 방문자 1,000명에서 1,178명: (1178 - 1000) / 1000 * 100 = 17.8%.", "",
              "| 수동 연결한 합성 주장 | 계산 결과 | 판정 |", "|---|---|---|"]
    for claim in report["manual_linked_synthetic_claims"]:
        lines.append(f"| {claim['claimed_value']}% | {claim['computed_value']}% | {claim['status']} |")
    lines += ["", "판정은 명시한 데이터·계산·단위와 허용오차 안에서만 유효합니다. 인과 해석이나 전체 답변의 진실을 보장하지 않습니다.",
              "", "## 아직 연결하지 않은 부분", "",
              "CSV 업로드 화면·사용자 데이터 저장·GPT 분석과 주장 추출·웹 대화 화면·DB·배포·고급 통계검정·보정은 이번 단계에서 연결하지 않았습니다.",
              "", "기존 Agent·웹 근거 검증·evaluator 코드와 과거 연구 판정은 보존합니다.", ""]
    return "\n".join(lines)

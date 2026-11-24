"""Bounded stdin/stdout adapter for the local CSV UI. No network or disk storage."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import sys
from decimal import Decimal, localcontext
from uuid import UUID

from .core import (ARITHMETIC, CONTRACT_VERSION, CalculationSpec, NumericClaim, StatGuardError,
                   Tolerance, decimal_text, execute, load_csv_bytes, parse_number, verify_numeric_claim)
from .claims import MAX_ANSWER_CHARS, verify_answer
from .forensics import diagnose_answer
from .arithmetic import check_answer

BRIDGE_VERSION = "statguard-local-calculation-v0.1"
MAX_REQUEST_BYTES = 1_500_000
OPERATIONS = frozenset({"sum", "mean", "percent_change"})


def _error(code: str) -> dict:
    return {"ok": False, "bridge_version": BRIDGE_VERSION, "error": {"code": code}}


def preview_hash(columns, rows) -> str:
    serialized = json.dumps([list(columns), [list(row) for row in rows]], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _execute_calculation(payload):
    """Shared revalidation; never accept a client-supplied computed result."""
    expected = {"mode", "request_id", "csv_base64", "source_sha256", "preview_sha256", "encoding", "units", "spec"}
    if not isinstance(payload, dict) or set(payload) != expected or payload.get("mode") != "calculate":
        raise StatGuardError("INVALID_REQUEST")
    return _validated_execution(payload)


def _validated_execution(payload):
    raw_spec = payload["spec"]
    if not isinstance(raw_spec, dict) or raw_spec.get("operation") not in OPERATIONS:
        raise StatGuardError("UNSUPPORTED_OPERATION")
    spec = CalculationSpec.from_mapping(raw_spec)
    if any(len(filters) > 4 for filters in (spec.filters, spec.reference_filters or ())):
        raise StatGuardError("INVALID_FILTER")
    units = payload["units"]
    if not isinstance(units, dict) or set(units) != {spec.column}:
        raise StatGuardError("UNIT_CONFIRMATION_REQUIRED")
    return execute(_validated_dataset(payload, units), spec)


def _verify_answer(payload):
    """Rule-based claim extraction + 4-state verification over the confirmed CSV."""
    expected = {"mode", "request_id", "csv_base64", "source_sha256", "preview_sha256", "encoding", "units", "answer_text"}
    if set(payload) != expected:
        raise StatGuardError("INVALID_REQUEST")
    units, answer = payload["units"], payload["answer_text"]
    if not isinstance(units, dict) or not 1 <= len(units) <= 16:
        raise StatGuardError("UNIT_CONFIRMATION_REQUIRED")
    if not isinstance(answer, str) or not answer.strip():
        raise StatGuardError("ANSWER_TEXT_REQUIRED")
    if len(answer) > MAX_ANSWER_CHARS:
        raise StatGuardError("ANSWER_TEXT_LIMIT")
    dataset = _validated_dataset(payload, units)
    return {"ok": True, "bridge_version": BRIDGE_VERSION, "verification_version": "statguard-answer-verification-v0.1",
            "request_id": payload["request_id"], "preview_sha256": payload["preview_sha256"],
            "source_sha256": dataset.source_sha256, "dataset_version": dataset.dataset_version,
            "units": dict(dataset.units), "verification": diagnose_answer(dataset, verify_answer(dataset, answer)),
            "arithmetic": check_answer(answer)}


def _check_arithmetic(payload):
    """No CSV: recompute only the calculations the answer writes out itself (statguard-arithmetic)."""
    if set(payload) != {"mode", "request_id", "answer_text"}:
        raise StatGuardError("INVALID_REQUEST")
    answer = payload["answer_text"]
    if not isinstance(answer, str) or not answer.strip():
        raise StatGuardError("ANSWER_TEXT_REQUIRED")
    if len(answer) > MAX_ANSWER_CHARS:
        raise StatGuardError("ANSWER_TEXT_LIMIT")
    request_id = payload["request_id"]
    if not isinstance(request_id, str) or len(request_id) > 64:
        raise StatGuardError("INVALID_REQUEST")
    return {"ok": True, "bridge_version": BRIDGE_VERSION, "request_id": request_id, "arithmetic": check_answer(answer)}


def _validated_dataset(payload, units):
    request_id = payload["request_id"]
    if not isinstance(request_id, str) or str(UUID(request_id)) != request_id:
        raise StatGuardError("INVALID_REQUEST")
    for name in ("source_sha256", "preview_sha256"):
        if not isinstance(payload[name], str) or not re.fullmatch(r"[0-9a-f]{64}", payload[name]):
            raise StatGuardError("INVALID_REQUEST")
    encoded = payload["csv_base64"]
    if not isinstance(encoded, str) or len(encoded) > 1_398_104:
        raise StatGuardError("CSV_BYTE_LIMIT")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise StatGuardError("INVALID_CSV_BASE64") from None
    if len(data) > 1_048_576:
        raise StatGuardError("CSV_BYTE_LIMIT")
    if hashlib.sha256(data).hexdigest() != payload["source_sha256"]:
        raise StatGuardError("SOURCE_MISMATCH")
    if payload["encoding"] not in ("utf-8-sig", "cp949"):
        raise StatGuardError("UNSUPPORTED_ENCODING")
    dataset = load_csv_bytes(data, dataset_id="local-upload", units=units, encoding=payload["encoding"])
    if preview_hash(dataset.columns, dataset.rows) != payload["preview_sha256"]:
        raise StatGuardError("PREVIEW_INTERPRETATION_MISMATCH")
    return dataset


def _compare(payload):
    fields = {"mode", "request_id", "calculation", "expected_dataset_version", "expected_calculation_id",
              "claim_value", "claim_unit", "tolerance_absolute"}
    if set(payload) != fields:
        raise StatGuardError("INVALID_REQUEST")
    identifier = payload["request_id"]
    if not isinstance(identifier, str) or str(UUID(identifier)) != identifier:
        raise StatGuardError("INVALID_REQUEST")
    for name in ("claim_value", "tolerance_absolute"):
        if not isinstance(payload[name], str) or not 1 <= len(payload[name]) <= 64:
            raise StatGuardError("INVALID_NUMERIC_VALUE")
    if not isinstance(payload["claim_unit"], str) or not 1 <= len(payload["claim_unit"]) <= 32:
        raise StatGuardError("UNIT_NOT_CONFIRMED_OR_MISMATCH")
    for name in ("expected_dataset_version", "expected_calculation_id"):
        if not isinstance(payload[name], str) or not re.fullmatch(r"[0-9a-f]{64}", payload[name]):
            raise StatGuardError("CALCULATION_LINKAGE_MISMATCH")
    result = _execute_calculation(payload["calculation"])
    tolerance = Tolerance(parse_number(payload["tolerance_absolute"]), Decimal(0))
    claimed = parse_number(payload["claim_value"])
    verdict = verify_numeric_claim(result, NumericClaim(payload["expected_dataset_version"],
        payload["expected_calculation_id"], payload["claim_value"], payload["claim_unit"]), tolerance=tolerance)
    if verdict["status"] == "INSUFFICIENT_EVIDENCE":
        raise StatGuardError(verdict["reason_code"])
    with localcontext(ARITHMETIC):
        signed = claimed - result.value
        absolute = abs(signed)
    display = "EXACT_MATCH" if absolute == 0 else "WITHIN_TOLERANCE" if verdict["status"] == "VERIFIED_WITHIN_SCOPE" else "MISMATCH"
    return {"ok": True, "bridge_version": BRIDGE_VERSION, "comparison_version": "statguard-manual-comparison-v0.1",
            "request_id": identifier, "source_sha256": result.source_sha256,
            "dataset_version": result.dataset_version, "calculation_id": result.calculation_id,
            "claim_input": payload["claim_value"], "tolerance_input": payload["tolerance_absolute"],
            "claim_value": decimal_text(claimed), "claim_unit": result.unit, "computed_value": decimal_text(result.value),
            "tolerance_absolute": decimal_text(tolerance.absolute), "display_status": display,
            "difference": {"signed": decimal_text(signed), "absolute": decimal_text(absolute),
                           "direction": "EQUAL" if signed == 0 else "HIGHER" if signed > 0 else "LOWER",
                           "unit": "%p" if result.unit == "%" else result.unit}, "verification": verdict}


def calculate_request(payload: object) -> dict:
    """Revalidate bytes and conditions for calculation or manual scalar comparison."""
    if not isinstance(payload, dict):
        return _error("INVALID_REQUEST")
    if payload == {"mode": "capabilities"}:
        return {"ok": True, "bridge_version": BRIDGE_VERSION, "contract_version": CONTRACT_VERSION,
                "operations": sorted(OPERATIONS), "storage": "MEMORY_ONLY", "provider": "NONE"}
    try:
        if payload.get("mode") == "compare":
            return _compare(payload)
        if payload.get("mode") == "verify_answer":
            return _verify_answer(payload)
        if payload.get("mode") == "check_arithmetic":
            return _check_arithmetic(payload)
        result = _execute_calculation(payload)
        return {"ok": True, "bridge_version": BRIDGE_VERSION, "request_id": payload["request_id"],
                "preview_sha256": payload["preview_sha256"], "result": result.as_dict()}
    except StatGuardError as error:
        return _error(error.code)
    except Exception:
        return _error("INVALID_REQUEST")


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_FIELD")
        result[key] = value
    return result


def main() -> None:
    # Isolated launcher uses -I -S. No inherited provider configuration is needed.
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            response = _error("REQUEST_TOO_LARGE")
        else:
            payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs,
                                 parse_constant=lambda _: (_ for _ in ()).throw(ValueError("INVALID_CONSTANT")))
            response = calculate_request(payload)
    except Exception:
        response = _error("INVALID_REQUEST")
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()

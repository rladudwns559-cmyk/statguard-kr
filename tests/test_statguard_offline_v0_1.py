"""Synthetic development checks, not a statistical performance benchmark."""
from dataclasses import FrozenInstanceError
import ast
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

from when2warn.statguard import (
    CalculationSpec, CsvLimits, NumericClaim, StatGuardError, Tolerance,
    execute, load_csv_bytes, verify_numeric_claim,
)
from when2warn.statguard.core import decimal_text, parse_number
from when2warn.statguard.demo import replay_case, replay_fixtures

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "data/statguard_demo_v0.1/cases_24.json").read_text(encoding="utf-8"))


class FrozenDevelopmentCases(unittest.TestCase):
    pass


def _frozen_test(case):
    def check(self):
        record = replay_case(ROOT, case, FIXTURE)
        self.assertTrue(record["passed"], record.get("observed_error", "FIXED_EXPECTATION_MISMATCH"))
    return check


for _case in FIXTURE["cases"]:
    setattr(FrozenDevelopmentCases, "test_fixed_case_" + _case["case_id"][-3:], _frozen_test(_case))


class ContractChecks(unittest.TestCase):
    def assert_code(self, expected, function, *args, **kwargs):
        with self.assertRaises(StatGuardError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, expected)
        self.assertEqual(str(caught.exception), expected)

    def table(self, text="group,value\nA,10\nB,20\n", units=None, **kwargs):
        return load_csv_bytes(text.encode("utf-8"), dataset_id="test", units={"value": "items"} if units is None else units, **kwargs)

    def sum_result(self, **kwargs):
        return execute(self.table(**kwargs), CalculationSpec("sum", "value"))

    def claim(self, result, value="30", unit="items", **overrides):
        fields = dict(dataset_version=result.dataset_version, calculation_id=result.calculation_id, value=value, unit=unit)
        fields.update(overrides)
        return verify_numeric_claim(result, NumericClaim(**fields), tolerance=Tolerance(Decimal("0.05")))

    def test_fixture_manifest_unchanged(self):
        pre = json.loads((ROOT / "artifacts/statguard_offline_core_v0.1/fixture_precommit.json").read_text(encoding="utf-8"))
        self.assertTrue(pre["frozen_before_core_implementation"])
        for name, expected in pre["fixture_sha256"].items():
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), expected)

    def test_utf8_bom(self):
        data = load_csv_bytes(b"\xef\xbb\xbfvalue\n10\n", dataset_id="bom")
        self.assertEqual(data.columns, ("value",))
        self.assertEqual(data.rows, (("10",),))

    def test_cp949_korean(self):
        data = load_csv_bytes("지역,방문자수\n서울,10\n".encode("cp949"), dataset_id="korean", units={"방문자수": "명"})
        self.assertEqual(data.encoding, "cp949")
        self.assertEqual(execute(data, CalculationSpec("sum", "방문자수")).value, Decimal(10))

    def test_invalid_encoding(self):
        self.assert_code("UNSUPPORTED_ENCODING", self.table, encoding="utf-16")

    def test_wrong_encoding_type(self):
        self.assert_code("UNSUPPORTED_ENCODING", self.table, encoding=[])

    def test_non_bytes_input(self):
        self.assert_code("CSV_BYTES_REQUIRED", load_csv_bytes, "value\n1", dataset_id="test")

    def test_decode_failure(self):
        self.assert_code("CSV_DECODE_FAILED", load_csv_bytes, b"\xff", dataset_id="test")

    def test_byte_limit(self):
        self.assert_code("CSV_BYTE_LIMIT", self.table, limits=CsvLimits(max_bytes=8))

    def test_row_limit(self):
        self.assert_code("CSV_ROW_LIMIT", self.table, limits=CsvLimits(max_rows=1))

    def test_column_limit(self):
        self.assert_code("CSV_COLUMN_LIMIT", self.table, limits=CsvLimits(max_columns=1))

    def test_cell_limit(self):
        self.assert_code("CSV_CELL_LIMIT", self.table, "value\n123456\n", limits=CsvLimits(max_cell_chars=5))

    def test_duplicate_header(self):
        self.assert_code("DUPLICATE_CSV_HEADER", self.table, "value,value\n1,2\n")

    def test_header_whitespace_rejected(self):
        self.assert_code("INVALID_CSV_HEADER", self.table, " value\n1\n")

    def test_empty_header_rejected(self):
        self.assert_code("INVALID_CSV_HEADER", self.table, ",value\nA,1\n")

    def test_empty_dataset(self):
        self.assert_code("EMPTY_DATASET", self.table, "value\n")

    def test_row_width_rejected(self):
        self.assert_code("CSV_ROW_WIDTH_MISMATCH", self.table, "group,value\nA,1,2\n")

    def test_blank_row_not_silently_skipped(self):
        self.assert_code("CSV_ROW_WIDTH_MISMATCH", self.table, "group,value\n\nA,1\n")

    def test_malformed_quotes(self):
        self.assert_code("INVALID_CSV_STRUCTURE", self.table, 'group,value\nA,"1\n')

    def test_control_character_rejected(self):
        self.assert_code("CSV_CONTROL_CHARACTER", self.table, "value\n1\x00\n")

    def test_invalid_limits(self):
        for value in [0, True, 10001]:
            with self.subTest(value_type=type(value).__name__):
                self.assert_code("INVALID_CSV_LIMIT", CsvLimits, max_rows=value)

    def test_unknown_units_column(self):
        self.assert_code("INVALID_UNIT_METADATA", self.table, units={"missing": "items"})

    def test_ids_and_filter_strings_preserve_leading_zero(self):
        data = self.table("group,value\n001,10\n1,20\n")
        result = execute(data, CalculationSpec.from_mapping({"operation": "sum", "column": "value", "filters": {"group": "001"}}))
        self.assertEqual(result.value, Decimal(10))
        self.assertEqual(result.usage.used_rows, (1,))

    def test_unknown_spec_field(self):
        self.assert_code("UNKNOWN_SPEC_FIELD", CalculationSpec.from_mapping, {"operation": "sum", "column": "value", "code": "not-executed"})

    def test_non_string_filter_value(self):
        self.assert_code("INVALID_FILTER", CalculationSpec.from_mapping, {"operation": "sum", "column": "value", "filters": {"group": 1}})

    def test_missing_reference_selection(self):
        self.assert_code("REFERENCE_SELECTION_REQUIRED", CalculationSpec, "percent_change", "value")

    def test_unexpected_reference_selection(self):
        self.assert_code("UNEXPECTED_REFERENCE_SELECTION", CalculationSpec, "sum", "value", reference_filters=())

    def test_duplicate_filter_column(self):
        self.assert_code("DUPLICATE_FILTER_COLUMN", CalculationSpec, "sum", "value", filters=(("group", "A"), ("group", "B")))

    def test_group_column_required(self):
        self.assert_code("GROUP_COLUMN_REQUIRED", CalculationSpec, "rank", "value")

    def test_unknown_group_aggregation(self):
        self.assert_code("UNSUPPORTED_AGGREGATION", CalculationSpec, "grouped_aggregate", "value", group_by="group", aggregation="eval")

    def test_wrong_spec_types_are_bounded_errors(self):
        self.assert_code("UNSUPPORTED_OPERATION", CalculationSpec, [], "value")
        self.assert_code("INVALID_MISSING_POLICY", CalculationSpec, "sum", "value", missing_policy=[])
        self.assert_code("UNSUPPORTED_AGGREGATION", CalculationSpec, "grouped_aggregate", "value", group_by="group", aggregation=[])

    def test_spec_serialization_roundtrip(self):
        original = CalculationSpec("sum", "value")
        self.assertEqual(CalculationSpec.from_mapping(original.as_dict()), original)

    def test_nonfinite_and_formula_values_rejected(self):
        for value in ["NaN", "Infinity", "1e100", "=1+2", "__import__('os')", "17.8%", "1,23", "１０"]:
            with self.subTest(category="unsupported_number"):
                self.assert_code("INVALID_NUMERIC_VALUE", parse_number, value)

    def test_quoted_thousand_separator(self):
        result = self.sum_result(text='group,value\nA,"1,000"\nB,"1,178"\n')
        self.assertEqual(result.value, Decimal(2178))

    def test_precision_limits(self):
        self.assert_code("NUMERIC_PRECISION_LIMIT", parse_number, "1.0000001")
        self.assert_code("NUMERIC_PRECISION_LIMIT", parse_number, "1234567890123456789")

    def test_decimal_arithmetic_not_binary_float(self):
        self.assertEqual(self.sum_result(text="group,value\nA,0.1\nB,0.2\n").value, Decimal("0.3"))

    def test_mean_context_is_fixed(self):
        data = self.table("group,value\nA,1\nB,0\nC,0\n")
        with localcontext() as ctx:
            ctx.prec = 5
            result = execute(data, CalculationSpec("mean", "value"))
        self.assertEqual(decimal_text(result.value), "0." + "3" * 34)

    def test_missing_omit_does_not_hide_invalid_number(self):
        data = self.table("group,value\nA,ten\nB,\n")
        self.assert_code("INVALID_NUMERIC_VALUE", execute, data, CalculationSpec("sum", "value", missing_policy="omit"))

    def test_all_missing_omitted_is_not_zero(self):
        data = self.table("group,value\nA,\nB,\n")
        self.assert_code("NO_NUMERIC_ROWS", execute, data, CalculationSpec("sum", "value", missing_policy="omit"))

    def test_omission_exposes_used_and_omitted_rows(self):
        data = self.table("group,value\nA,10\nB,\n")
        result = execute(data, CalculationSpec("sum", "value", missing_policy="omit"))
        self.assertEqual(result.usage.used_rows, (1,))
        self.assertEqual(result.usage.omitted_rows, (2,))
        self.assertIn("NUMERIC_ROWS_OMITTED", self.claim(result, "10")["warnings"])

    def test_calculation_is_deterministic(self):
        data = self.table()
        spec = CalculationSpec("sum", "value")
        self.assertEqual(execute(data, spec).as_dict(), execute(data, spec).as_dict())

    def test_dataset_is_frozen(self):
        data = self.table()
        with self.assertRaises(FrozenInstanceError):
            data.rows = ()

    def test_unit_metadata_changes_dataset_version(self):
        one = self.table()
        two = self.table(units={"value": "thousands"})
        self.assertEqual(one.source_sha256, two.source_sha256)
        self.assertNotEqual(one.dataset_version, two.dataset_version)

    def test_logical_dataset_id_changes_version(self):
        raw = b"value\n1\n"
        self.assertNotEqual(load_csv_bytes(raw, dataset_id="one").dataset_version,
                            load_csv_bytes(raw, dataset_id="two").dataset_version)

    def test_distinct_spec_has_distinct_linkage(self):
        data = self.table()
        self.assertNotEqual(execute(data, CalculationSpec("sum", "value")).calculation_id,
                            execute(data, CalculationSpec("mean", "value")).calculation_id)

    def test_correct_scalar_with_explicit_scope(self):
        self.assertEqual(self.claim(self.sum_result())["status"], "VERIFIED_WITHIN_SCOPE")

    def test_incorrect_scalar_is_contradicted(self):
        self.assertEqual(self.claim(self.sum_result(), "31")["status"], "CONTRADICTED")

    def test_tolerance_boundary(self):
        result = self.sum_result()
        self.assertEqual(self.claim(result, "30.05")["status"], "VERIFIED_WITHIN_SCOPE")
        self.assertEqual(self.claim(result, "30.050001")["status"], "CONTRADICTED")

    def test_different_source_cannot_borrow_calculation(self):
        result = self.sum_result()
        self.assertEqual(self.claim(result, dataset_version="other")["reason_code"], "CALCULATION_LINKAGE_MISMATCH")

    def test_different_spec_cannot_borrow_value(self):
        result = self.sum_result()
        self.assertEqual(self.claim(result, calculation_id="other")["reason_code"], "CALCULATION_LINKAGE_MISMATCH")

    def test_unit_mismatch_is_not_verified(self):
        self.assertEqual(self.claim(self.sum_result(), unit="percent")["status"], "INSUFFICIENT_EVIDENCE")

    def test_absent_unit_is_not_inferred(self):
        result = self.sum_result(units={})
        self.assertEqual(self.claim(result)["status"], "INSUFFICIENT_EVIDENCE")

    def test_ratio_still_requires_source_unit_metadata(self):
        data = self.table(units={})
        spec = CalculationSpec("ratio_percent", "value", filters=(("group", "A"),), reference_filters=(("group", "B"),))
        result = execute(data, spec)
        self.assertEqual(self.claim(result, "50", unit="%")["status"], "INSUFFICIENT_EVIDENCE")

    def test_invalid_claim_number_is_not_contradiction(self):
        self.assertEqual(self.claim(self.sum_result(), "NaN")["reason_code"], "CLAIM_NUMERIC_VALUE_INVALID")

    def test_group_result_not_silently_scalar_verified(self):
        result = execute(self.table(), CalculationSpec("rank", "value", group_by="group"))
        self.assertEqual(self.claim(result)["reason_code"], "NON_SCALAR_CLAIM_NOT_SUPPORTED")

    def test_tolerance_must_be_explicit_finite_nonnegative(self):
        for value in [Decimal("NaN"), Decimal("-1"), Decimal("Infinity"), 0.1]:
            with self.subTest(category="invalid_tolerance"):
                self.assert_code("INVALID_TOLERANCE", Tolerance, value)

    def test_extreme_tolerance_rejected(self):
        self.assert_code("INVALID_TOLERANCE", Tolerance, Decimal("1e100000"))
        self.assert_code("INVALID_TOLERANCE", Tolerance, Decimal(0), Decimal("1.1"))

    def test_error_does_not_echo_input(self):
        self.assert_code("INVALID_NUMERIC_VALUE", parse_number, "FAKE_INPUT_MUST_NOT_APPEAR_IN_ERROR")

    def test_all_fixed_cases_work_without_network_or_processes(self):
        with patch.object(socket, "socket", side_effect=AssertionError("NETWORK_FORBIDDEN")), \
             patch("subprocess.Popen", side_effect=AssertionError("PROCESS_FORBIDDEN")):
            report = replay_fixtures(ROOT)
        self.assertEqual(report["passed_cases"], 24)
        self.assertEqual([x["status"] for x in report["manual_linked_synthetic_claims"]], ["CONTRADICTED", "VERIFIED_WITHIN_SCOPE"])

    def test_no_legacy_provider_or_backend_imports(self):
        # Do not depend on which unrelated legacy tests were collected first.
        package = ROOT / "src/when2warn/statguard"
        for source in package.glob("*.py"):
            tree = ast.parse(source.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [item.name for item in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [node.module or ""]
                else:
                    continue
                self.assertFalse(any(name.startswith(("when2warn.backend", "when2warn.decision_layer", "when2warn.runtime_evidence", "openai", "requests")) for name in names))


if __name__ == "__main__":
    unittest.main()

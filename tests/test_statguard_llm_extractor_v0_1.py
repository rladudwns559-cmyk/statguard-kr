"""LLM extractor mapping with a fake model (no network). The model never supplies computed values."""
import unittest

from when2warn.statguard.core import load_csv_bytes
from when2warn.statguard.llm_extractor import SCHEMA, build_input, claims_from_output, verify_answer_llm

RAW = "지역,연도,방문자수,체류시간\nA,2023,1000,10\nA,2024,1178,12\nB,2023,800,8\nB,2024,960,9\n".encode()
DS = load_csv_bytes(RAW, dataset_id="t", units={"방문자수": "명"})


def claim(**kw):
    base = {"sentence": "s", "operation": "sum", "column": "방문자수", "filters": [], "reference_filters": [], "claimed_value": "3938", "claimed_unit": "명"}
    return dict(base, **kw)


def run(*claims):
    return verify_answer_llm(DS, "답변", lambda i, t, s: {"claims": list(claims)})


class LlmExtractor(unittest.TestCase):
    def test_verified_and_contradicted_use_engine_values(self):
        r = run(claim(), claim(operation="percent_change", filters=[{"column": "지역", "value": "A"}, {"column": "연도", "value": "2024"}],
                              reference_filters=[{"column": "지역", "value": "A"}, {"column": "연도", "value": "2023"}], claimed_value="23.0", claimed_unit="%"))
        self.assertEqual([c["status"] for c in r["claims"]], ["VERIFIED", "CONTRADICTED"])
        self.assertEqual(r["claims"][1]["computed"]["value"], "17.8")

    def test_unknown_values_and_columns_abstain(self):
        r = run(claim(filters=[{"column": "연도", "value": "2025"}]), claim(column="없는열"), claim(column="체류시간"),
                claim(operation="interpretive", claimed_value=None), claim(operation="unsupported_statistic"), claim(claimed_value="많음"))
        self.assertEqual([(c["status"], c["reason_code"]) for c in r["claims"]], [
            ("INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED"), ("UNCERTAIN", "COLUMN_NOT_IDENTIFIED"), ("INSUFFICIENT_EVIDENCE", "UNIT_NOT_CONFIRMED"),
            ("UNCERTAIN", "INTERPRETIVE_STATEMENT"), ("INSUFFICIENT_EVIDENCE", "UNSUPPORTED_OPERATION"), ("UNCERTAIN", "CLAIM_VALUE_NOT_IDENTIFIED")])

    def test_all_values_of_a_column_mean_all_rows_partial_range_abstains(self):
        everything = [{"column": "연도", "value": "2023"}, {"column": "연도", "value": "2024"}]
        self.assertEqual(run(claim(filters=everything))["claims"][0]["status"], "VERIFIED")
        partial = [{"column": "지역", "value": "A"}, {"column": "지역", "value": "B"}]
        self.assertEqual(run(claim(filters=partial, claimed_value="3938"))["claims"][0]["status"], "VERIFIED")
        three = load_csv_bytes("지역,값\nA,1\nB,2\nC,3\n".encode(), dataset_id="t", units={"값": "개"})
        out = claims_from_output(three, {"claims": [{"sentence": "s", "operation": "sum", "column": "값", "filters": [{"column": "지역", "value": "A"}, {"column": "지역", "value": "B"}],
                                                     "reference_filters": [], "claimed_value": "3", "claimed_unit": "개"}]})
        self.assertEqual(out[0]["reason_code"], "RANGE_FILTER_UNSUPPORTED")

    def test_statistics_targets(self):
        ds = load_csv_bytes(RAW, dataset_id="t", units={"방문자수": "명", "체류시간": "분"})
        groups = dict(filters=[{"column": "연도", "value": "2024"}], reference_filters=[{"column": "연도", "value": "2023"}])
        out = verify_answer_llm(ds, "답변", lambda i, t, s: {"claims": [
            claim(operation="correlation", column="방문자수", column2="체류시간", claimed_value="0.98", claimed_unit=None),
            claim(operation="max", filters=[{"column": "지역", "value": "A"}, {"column": "연도", "value": "2024"}], claimed_value="1178"),
            claim(operation="max", filters=[{"column": "지역", "value": "B"}, {"column": "연도", "value": "2024"}], claimed_value="1178"),
            claim(operation="t_test", column="체류시간", target="significance", significant=False, claimed_value=None, **groups),
            claim(operation="t_test", column="체류시간", target="p_value", comparator="<", claimed_value="0.05", **groups),
            claim(operation="stdev", column="방문자수", claimed_value="134.46")]})
        self.assertEqual([(c["status"], c["reason_code"]) for c in out["claims"]], [
            ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("CONTRADICTED", "EXTREME_ROW_CONFLICT"),
            ("VERIFIED", "SIGNIFICANCE_MATCHES_ALPHA_005"), ("CONTRADICTED", "NUMERIC_VALUE_CONFLICT"), ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION")])

    def test_prompt_lists_units_and_category_values_only(self):
        text = build_input(DS, "답변 본문")
        self.assertIn('{"방문자수": "명"}', text)
        self.assertIn("구분 열 '지역'의 값", text)
        self.assertTrue(SCHEMA["properties"]["claims"]["items"]["additionalProperties"] is False)


if __name__ == "__main__":
    unittest.main()

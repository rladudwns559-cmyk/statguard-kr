"""v0.4 statistics: engine values against the stdlib, and claim verdicts. No network."""
import statistics
import unittest
from decimal import Decimal
from pathlib import Path

from when2warn.statguard.claims import verify_answer
from when2warn.statguard.core import CalculationSpec, StatGuardError, execute, load_csv_bytes, t_two_sided_p

ROOT = Path(__file__).resolve().parents[1]
SEATTLE = load_csv_bytes((ROOT / "data/statguard_real_csv_v0.1/01_시애틀_2023_월별강수량.csv").read_bytes(), dataset_id="t", units={"강수량": "mm"})
RAIN = [78.5, 60.1, 65.3, 98.1, 23.8, 31.0, 2.3, 6.8, 87.3, 73.3, 147.0, 215.4]
VISITORS = load_csv_bytes("지역,연도,방문자수,체류시간\nA,2023,1000,10\nA,2024,1178,12\nB,2023,800,8\nB,2024,960,9\nC,2023,500,5\nC,2024,500,6\n".encode(),
                          dataset_id="t", units={"방문자수": "명", "체류시간": "분"})


def run(dataset, spec):
    return execute(dataset, CalculationSpec.from_mapping(spec))


def verdicts(dataset, text):
    return [(c["status"], c["reason_code"]) for c in verify_answer(dataset, text)["claims"]]


class Engine(unittest.TestCase):
    def test_descriptive_statistics_match_stdlib(self):
        r = run(SEATTLE, {"operation": "stdev", "column": "강수량"})
        self.assertAlmostEqual(float(r.value), statistics.stdev(RAIN), places=12)
        self.assertAlmostEqual(float(r.extra["population"]), statistics.pstdev(RAIN), places=12)
        self.assertAlmostEqual(float(run(SEATTLE, {"operation": "variance", "column": "강수량"}).value), statistics.variance(RAIN), places=9)
        self.assertEqual(run(SEATTLE, {"operation": "variance", "column": "강수량"}).unit, "mm²")
        self.assertEqual(run(SEATTLE, {"operation": "median", "column": "강수량"}).value, Decimal("69.3"))
        r = run(SEATTLE, {"operation": "max", "column": "강수량"})
        self.assertEqual((r.value, r.extra["rows"]), (Decimal("215.4"), [12]))

    def test_correlation_and_welch_t(self):
        r = run(VISITORS, {"operation": "correlation", "column": "방문자수", "column2": "체류시간"})
        self.assertAlmostEqual(float(r.value), statistics.correlation([1000, 1178, 800, 960, 500, 500], [10, 12, 8, 9, 5, 6]), places=12)
        self.assertEqual(r.unit, "")
        r = run(VISITORS, {"operation": "t_test", "column": "체류시간", "filters": {"연도": "2024"}, "reference_filters": {"연도": "2023"}})
        self.assertAlmostEqual(float(r.value), 0.5897678246, places=9)
        self.assertEqual(r.extra["method"], "WELCH_TWO_SIDED")
        self.assertAlmostEqual(t_two_sided_p(2.0, 10), 0.0733880, places=6)
        self.assertAlmostEqual(t_two_sided_p(2.228, 10), 0.05, places=3)

    def test_guards(self):
        for spec, code in (({"operation": "stdev", "column": "강수량", "filters": {"연월": "2023-01"}}, "INSUFFICIENT_ROWS"),
                           ({"operation": "correlation", "column": "강수량"}, "SECOND_COLUMN_REQUIRED"),
                           ({"operation": "sum", "column": "강수량", "column2": "강수량"}, "UNEXPECTED_SECOND_COLUMN"),
                           ({"operation": "t_test", "column": "체류시간"}, "REFERENCE_SELECTION_REQUIRED")):
            with self.assertRaises(StatGuardError) as ctx:
                run(VISITORS if spec["column"] == "체류시간" else SEATTLE, spec)
            self.assertEqual(ctx.exception.code, code)

    def test_existing_spec_shape_unchanged(self):
        r = run(SEATTLE, {"operation": "sum", "column": "강수량"})
        self.assertNotIn("column2", r.as_dict()["spec"])
        self.assertNotIn("extra", r.as_dict())


class Claims(unittest.TestCase):
    def test_stdev_accepts_either_definition_and_reports_which(self):
        r = verify_answer(SEATTLE, "2023년 월별 강수량의 표준편차는 60.6mm입니다. 표준편차는 58.0mm입니다. 표준편차는 70mm입니다.")
        self.assertEqual([c["status"] for c in r["claims"]], ["VERIFIED", "VERIFIED", "CONTRADICTED"])
        self.assertIn("SAMPLE_DEFINITION_MATCH", r["claims"][0]["notes"])
        self.assertIn("POPULATION_DEFINITION_MATCH", r["claims"][1]["notes"])

    def test_extremes_check_value_and_row(self):
        self.assertEqual(verdicts(SEATTLE, "2023년 12월 강수량이 215.4mm로 가장 많았습니다. 2023년 11월 강수량이 215.4mm로 가장 많았습니다. 2023년 7월 강수량이 2.3mm로 가장 적었습니다."),
                         [("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("CONTRADICTED", "EXTREME_ROW_CONFLICT"), ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION")])

    def test_correlation_claims(self):
        self.assertEqual(verdicts(VISITORS, "방문자수와 체류시간의 상관계수는 0.98입니다. 방문자수와 체류시간은 0.5의 상관을 보입니다. 체류시간의 상관계수는 0.3입니다."),
                         [("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("CONTRADICTED", "NUMERIC_VALUE_CONFLICT"), ("UNCERTAIN", "CORRELATION_COLUMNS_NOT_IDENTIFIED")])

    def test_t_test_significance_p_value_and_inequality(self):
        self.assertEqual(verdicts(VISITORS, "2023년과 2024년의 체류시간 차이는 통계적으로 유의하지 않습니다. 2023년과 2024년의 체류시간 차이는 통계적으로 유의합니다. "
                                            "2023년과 2024년 체류시간 차이의 p값은 0.59입니다. 2023년과 2024년 체류시간 차이는 p < 0.05로 유의합니다."),
                         [("VERIFIED", "SIGNIFICANCE_MATCHES_ALPHA_005"), ("CONTRADICTED", "SIGNIFICANCE_CONFLICT_ALPHA_005"),
                          ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("CONTRADICTED", "NUMERIC_VALUE_CONFLICT")])

    def test_trend_and_grouped_claims_still_abstain(self):
        self.assertEqual(verdicts(VISITORS, "방문자 증가는 통계적으로 유의한 추세입니다. 지역별 방문자수 표준편차는 250명입니다."),
                         [("UNCERTAIN", "INTERPRETIVE_STATEMENT"), ("UNCERTAIN", "GROUPED_STATISTIC_AMBIGUOUS")])
        self.assertEqual(verdicts(SEATTLE, "월별 강수량을 회귀분석한 기울기는 5.1mm입니다."), [("INSUFFICIENT_EVIDENCE", "UNSUPPORTED_OPERATION")])


if __name__ == "__main__":
    unittest.main()


class V05(unittest.TestCase):
    """v0.5: sum/ratio phrasings seen in large-table answers, and the duplicated closing line."""

    def test_sum_ratio_phrasing_and_final_line(self):
        daily = load_csv_bytes((ROOT / "experiments/statguard_benchmark_v0.2/datasets/06_시애틀_2023_일별기상.csv").read_bytes(), dataset_id="t",
                               units={"강수량": "mm", "최고기온": "℃", "최저기온": "℃"})
        r = verify_answer(daily, "2023년 일별 강수량을 모두 합한 연간 강수량은 888.4mm입니다. 2023년 12월 강수량은 연간 합계의 약 24.25%입니다. "
                                 "2023년 7월 일 최고기온 평균은 26.7℃입니다.\n최종값: 26.7 ℃")
        self.assertEqual([(c["operation"], c["status"]) for c in r["claims"]],
                         [("sum", "CONTRADICTED"), ("ratio_percent", "CONTRADICTED"), ("mean", "VERIFIED")])


class V07(unittest.TestCase):
    def test_counts_are_not_claims(self):
        r = verify_answer(VISITORS, "2024년 3개 지역의 체류시간 평균은 9분입니다. 지역 3곳의 2024년 방문자수 합계는 2,638명입니다.")
        self.assertEqual([c["status"] for c in r["claims"]], ["VERIFIED", "VERIFIED"])

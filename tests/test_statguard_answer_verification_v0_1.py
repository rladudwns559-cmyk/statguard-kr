"""AI-answer verification: rule-based claim extraction + 4-state verdicts. No provider/network."""
import base64
import hashlib
from pathlib import Path
import unittest

from when2warn.statguard.claims import extract_claims, verify_answer
from when2warn.statguard.core import StatGuardError, load_csv_bytes
from when2warn.statguard.local_bridge import calculate_request, preview_hash

ROOT = Path(__file__).resolve().parents[1]
REAL = ROOT / "data/statguard_real_csv_v0.1"
SAMPLE = "지역,연도,방문자수,체류시간\nA,2023,1000,10\nA,2024,1178,12\nB,2023,800,8\nB,2024,960,9\nC,2023,500,5\nC,2024,500,6\n".encode()
UNITS = {"방문자수": "명", "체류시간": "분"}


def run(raw, units, answer):
    return verify_answer(load_csv_bytes(raw, dataset_id="t", units=units), answer)


def statuses(result):
    return [(c["status"], c["reason_code"]) for c in result["claims"]]


class SampleAnswer(unittest.TestCase):
    def test_change_rate_conflict_and_level_values(self):
        r = run(SAMPLE, UNITS, "A지역 방문자수는 2023년 1,000명에서 2024년 1,178명으로 23.0% 증가했습니다.")
        first, *levels = r["claims"]
        self.assertEqual((first["status"], first["computed"]["value"]), ("CONTRADICTED", "17.8"))
        self.assertEqual(first["spec"]["filters"], {"지역": "A", "연도": "2024"})
        self.assertEqual(first["spec"]["reference_filters"], {"지역": "A", "연도": "2023"})
        self.assertEqual([c["status"] for c in levels], ["VERIFIED", "VERIFIED"])
        self.assertEqual(first["difference"]["unit"], "%p")

    def test_rounding_tolerance_follows_stated_precision(self):
        self.assertEqual(statuses(run(SAMPLE, UNITS, "A지역 방문자수는 2023년 대비 2024년에 17.8% 증가했습니다.")), [("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION")])
        self.assertEqual(statuses(run(SAMPLE, UNITS, "A지역 방문자수는 2023년 대비 2024년에 17.9% 증가했습니다.")), [("CONTRADICTED", "NUMERIC_VALUE_CONFLICT")])

    def test_sum_mean_lookup_and_ratio(self):
        r = run(SAMPLE, UNITS, "전체 방문자수 합계는 4,938명입니다. B지역의 2024년 체류시간 평균은 9분입니다. "
                               "A지역은 2024년 전체 방문자의 약 44.7%를 차지합니다. C지역 2023년 방문자수는 500명입니다.")
        self.assertEqual([c["operation"] for c in r["claims"]], ["sum", "mean", "ratio_percent", "lookup"])
        self.assertTrue(all(c["status"] == "VERIFIED" for c in r["claims"]))
        ratio = r["claims"][2]["spec"]
        self.assertEqual((ratio["filters"], ratio["reference_filters"]), ({"지역": "A", "연도": "2024"}, {"연도": "2024"}))

    def test_abstains_instead_of_guessing(self):
        r = run(SAMPLE, UNITS, "C지역의 2025년 방문자수는 520명입니다. 방문자 증가는 체류시간이 늘었기 때문입니다. "
                               "지역별 방문자수 표준편차는 250명입니다. A지역 값은 1,178입니다. 방문자수와 체류시간 평균은 10입니다.")
        self.assertEqual(statuses(r), [("INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED"), ("UNCERTAIN", "INTERPRETIVE_STATEMENT"),
                                       ("UNCERTAIN", "GROUPED_STATISTIC_AMBIGUOUS"), ("UNCERTAIN", "COLUMN_NOT_IDENTIFIED"),
                                       ("UNCERTAIN", "AMBIGUOUS_COLUMN")])
        self.assertTrue(all(c["computed"] is None for c in r["claims"]))

    def test_unit_mismatch_is_uncertain_not_contradicted(self):
        r = run(SAMPLE, UNITS, "전체 방문자수 합계는 4,938분입니다.")
        self.assertEqual(statuses(r), [("UNCERTAIN", "UNIT_MISMATCH")])
        r = run(SAMPLE, UNITS, "A지역 방문자수는 2023년 대비 2024년에 17.8%p 증가했습니다.")
        self.assertEqual(statuses(r), [("UNCERTAIN", "UNIT_MISMATCH")])

    def test_unconfirmed_unit_column_is_not_used(self):
        r = run(SAMPLE, {"방문자수": "명"}, "B지역의 2024년 체류시간 평균은 9분입니다.")
        self.assertEqual(statuses(r), [("INSUFFICIENT_EVIDENCE", "UNIT_NOT_CONFIRMED")])

    def test_summary_and_limits(self):
        r = run(SAMPLE, UNITS, "전체 방문자수 합계는 4,938명입니다.")
        self.assertEqual(r["summary"], {"VERIFIED": 1, "CONTRADICTED": 0, "UNCERTAIN": 0, "INSUFFICIENT_EVIDENCE": 0})
        self.assertEqual(r["scope"], "LINKED_CALCULATIONS_ONLY_NOT_WHOLE_ANSWER_TRUTH")
        with self.assertRaises(StatGuardError):
            extract_claims(load_csv_bytes(SAMPLE, dataset_id="t", units=UNITS), "가" * 6001)


class RealCsv(unittest.TestCase):
    def test_seattle_sum_and_month_lookup(self):
        r = run((REAL / "01_시애틀_2023_월별강수량.csv").read_bytes(), {"강수량": "mm"},
                "2023년 시애틀의 연간 강수량 합계는 1,000mm입니다. 2023년 11월 강수량은 147.0mm였습니다.")
        self.assertEqual([(c["status"], (c["computed"] or {}).get("value")) for c in r["claims"]], [("CONTRADICTED", "888.9"), ("VERIFIED", "147")])
        self.assertEqual(r["claims"][0]["difference"]["signed"], "111.1")

    def test_co2_mean(self):
        r = run((REAL / "02_마우나로아_2024_월별CO2.csv").read_bytes(), {"이산화탄소농도": "ppm"}, "2024년 이산화탄소농도의 평균은 424.6ppm입니다.")
        self.assertEqual(statuses(r), [("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION")])

    def test_population_change_with_reference_words(self):
        r = run((REAL / "03_대한민국_2022_2023_총인구.csv").read_bytes(), {"총인구": "명"},
                "총인구는 2022년 대비 2023년에 0.08% 증가했습니다. 2023년 총인구는 전년보다 0.5% 감소했습니다. 2023년 총인구는 약 5,171만 명입니다.")
        self.assertEqual([c["status"] for c in r["claims"]], ["VERIFIED", "CONTRADICTED", "VERIFIED"])
        self.assertEqual(r["claims"][1]["claimed"]["value"], "-0.5")
        self.assertEqual(r["claims"][2]["claimed"]["tolerance"], "5000")


class PeriodRanges(unittest.TestCase):
    """v0.2: a range is not read as its last year/month. v0.7.1: a partial range the data can express is computed
    over that set of values (these two tests asserted RANGE_FILTER_UNSUPPORTED before v0.7.1 — see
    experiments/statguard_ranges_v0.7.1/PROTOCOL.md 변경 기록)."""

    def test_full_partial_and_uncovered_year_ranges(self):
        raw = (ROOT / "experiments/statguard_benchmark_v0.1/datasets/04_대한민국_2014_2023_인구_실업률.csv").read_bytes()
        r = run(raw, {"총인구": "명", "실업률": "%"}, "2014~2023년 실업률 평균은 3.6%입니다. 2016~2020년 실업률 평균은 3.8%입니다. 2010~2023년 총인구 평균은 5,100만 명입니다.")
        self.assertEqual(statuses(r), [("CONTRADICTED", "NUMERIC_VALUE_CONFLICT"), ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("INSUFFICIENT_EVIDENCE", "DATA_NOT_COVERED")])
        self.assertEqual(r["claims"][0]["computed"]["value"], "3.4603")
        self.assertEqual(r["claims"][1]["spec"]["value_sets"], {"연도": ["2016", "2017", "2018", "2019", "2020"]})
        self.assertEqual(r["claims"][1]["computed"]["value"], "3.7608")
        self.assertIn("RANGE_AS_VALUE_SET", r["claims"][1]["notes"])

    def test_half_year_and_quarter_are_computed_full_year_months_pass(self):
        raw = (REAL / "01_시애틀_2023_월별강수량.csv").read_bytes()
        r = run(raw, {"강수량": "mm"}, "2023년 상반기(1~6월) 강수량 합계는 356.8mm입니다. 1~12월 강수량 합계는 888.9mm입니다.")
        self.assertEqual(statuses(r), [("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION"), ("VERIFIED", "WITHIN_ROUNDING_OF_STATED_PRECISION")])
        self.assertEqual(len(r["claims"][0]["spec"]["value_sets"]["연월"]), 6)
        q = run(raw, {"강수량": "mm"}, "2023년 3분기 강수량 합계는 100.0mm입니다.")
        self.assertEqual(statuses(q), [("CONTRADICTED", "NUMERIC_VALUE_CONFLICT")])
        self.assertEqual(q["claims"][0]["computed"]["value"], "96.4")

    def test_ranges_stay_held_where_they_cannot_be_computed(self):
        raw = (REAL / "01_시애틀_2023_월별강수량.csv").read_bytes()
        # a change rate over a range is not supported → still held
        r = run(raw, {"강수량": "mm"}, "2023년 상반기 대비 하반기 강수량은 49.1% 증가했습니다.")
        self.assertEqual(r["claims"][0]["status"], "UNCERTAIN")


class ValueSets(unittest.TestCase):
    def test_spec_without_value_sets_keeps_its_identifier(self):
        from when2warn.statguard.core import CalculationSpec, StatGuardError
        plain = CalculationSpec.from_mapping({"operation": "sum", "column": "값", "filters": {}})
        self.assertNotIn("value_sets", plain.as_dict())
        ranged = CalculationSpec.from_mapping({"operation": "sum", "column": "값", "filters": {}, "value_sets": {"연도": ["2023", "2024"]}})
        self.assertEqual(ranged.as_dict()["value_sets"], {"연도": ["2023", "2024"]})
        with self.assertRaises(StatGuardError):
            CalculationSpec.from_mapping({"operation": "percent_change", "column": "값", "filters": {}, "reference_filters": {}, "value_sets": {"연도": ["2023"]}})
        with self.assertRaises(StatGuardError):
            CalculationSpec.from_mapping({"operation": "sum", "column": "값", "filters": {"연도": "2023"}, "value_sets": {"연도": ["2023"]}})

    def test_value_set_selects_rows(self):
        r = run(SAMPLE, UNITS, "전체 방문자수 합계는 4,938명입니다.")
        self.assertEqual(r["claims"][0]["status"], "VERIFIED")
        from when2warn.statguard.core import CalculationSpec, execute
        ds = load_csv_bytes(SAMPLE, dataset_id="t", units=UNITS)
        spec = CalculationSpec.from_mapping({"operation": "sum", "column": "방문자수", "filters": {"연도": "2024"}, "value_sets": {"지역": ["A", "B"]}})
        self.assertEqual(str(execute(ds, spec).value), "2138")


class Bridge(unittest.TestCase):
    def payload(self, answer="전체 방문자수 합계는 4,938명입니다.", **extra):
        table = load_csv_bytes(SAMPLE, dataset_id="local-upload")
        return {"mode": "verify_answer", "request_id": "11111111-1111-4111-8111-111111111111",
                "csv_base64": base64.b64encode(SAMPLE).decode(), "source_sha256": hashlib.sha256(SAMPLE).hexdigest(),
                "preview_sha256": preview_hash(table.columns, table.rows), "encoding": "utf-8-sig",
                "units": dict(UNITS), "answer_text": answer, **extra}

    def test_bridge_round_trip(self):
        value = calculate_request(self.payload())
        self.assertTrue(value["ok"])
        self.assertEqual(value["verification"]["summary"]["VERIFIED"], 1)
        self.assertEqual(value["source_sha256"], hashlib.sha256(SAMPLE).hexdigest())

    def test_bridge_rejects_bad_requests(self):
        for payload, code in ((self.payload(answer=" "), "ANSWER_TEXT_REQUIRED"), (self.payload(answer="가" * 6001), "ANSWER_TEXT_LIMIT"),
                              (self.payload(units={}), "UNIT_CONFIRMATION_REQUIRED"), (self.payload(units={"없는열": "명"}), "INVALID_UNIT_METADATA"),
                              (self.payload(source_sha256="0" * 64), "SOURCE_MISMATCH"), (self.payload(extra=1), "INVALID_REQUEST")):
            value = calculate_request(payload)
            self.assertFalse(value["ok"])
            self.assertEqual(value["error"]["code"], code)


class ScopeSetByEarlierSentence(unittest.TestCase):
    """A sentence that points back to a part of the data must not be recomputed over every row."""

    YEARS = "연도,실업률\n2014,3.0\n2015,3.5\n2016,4.0\n2017,5.0\n".encode()
    MONTHS = ("월,강수량\n" + "".join(f"{m},{m * 10}\n" for m in range(1, 13))).encode()

    def last(self, raw, units, answer):
        claim = run(raw, units, answer)["claims"][-1]
        return claim["status"], claim["reason_code"]

    def test_several_years_listed_earlier_then_averaged(self):
        answer = "2014년 실업률은 3.0%, 2015년 실업률은 3.5%, 2016년 실업률은 4.0%입니다. 이를 단순 평균하면 3.5%입니다."
        self.assertEqual(self.last(self.YEARS, {"실업률": "%"}, answer), ("UNCERTAIN", "SCOPE_FROM_PREVIOUS_SENTENCE"))

    def test_partial_period_named_earlier_then_summed(self):
        answer = "상반기 강수량을 살펴보겠습니다. 이 기간 동안의 강수량 합계는 210mm입니다."
        self.assertEqual(self.last(self.MONTHS, {"강수량": "mm"}, answer), ("UNCERTAIN", "SCOPE_FROM_PREVIOUS_SENTENCE"))

    def test_every_year_listed_earlier_is_still_computed(self):
        answer = ("2014년 실업률은 3.0%, 2015년 실업률은 3.5%, 2016년 실업률은 4.0%, 2017년 실업률은 5.0%입니다. "
                  "이를 단순 평균하면 3.875%입니다.")
        self.assertEqual(self.last(self.YEARS, {"실업률": "%"}, answer)[0], "VERIFIED")

    def test_sentence_that_names_its_own_period_is_still_computed(self):
        answer = "2014년 실업률은 3.0%, 2015년 실업률은 3.5%입니다. 이를 포함한 2014~2016년 실업률의 평균은 3.5%입니다."
        self.assertEqual(self.last(self.YEARS, {"실업률": "%"}, answer)[0], "VERIFIED")

    def test_sentence_that_says_whole_data_is_still_computed(self):
        answer = "2014년 실업률은 3.0%, 2015년 실업률은 3.5%입니다. 전체 실업률의 평균은 3.875%입니다."
        self.assertEqual(self.last(self.YEARS, {"실업률": "%"}, answer)[0], "VERIFIED")


if __name__ == "__main__":
    unittest.main()

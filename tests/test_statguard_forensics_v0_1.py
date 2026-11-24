"""Error forensics: reproduce a contradicted number with a common calculation mistake. Deterministic, no provider/network."""
import base64
import hashlib
from pathlib import Path
import unittest

from when2warn.statguard.claims import verify_answer
from when2warn.statguard.core import load_csv_bytes
from when2warn.statguard.forensics import diagnose_answer, stated_counts
from when2warn.statguard.local_bridge import calculate_request, preview_hash

ROOT = Path(__file__).resolve().parents[1]
BENCH = ROOT / "experiments"
POP = "국가,인구\n가국,1200\n나국,3400\n다국,560\n라국,7810\n마국,2290\n바국,4470\n사국,980\n아국,6130\n".encode()
POP_UNITS = {"인구": "명"}
TOTAL = 1200 + 3400 + 560 + 7810 + 2290 + 4470 + 980 + 6130  # 26840


def diagnose(raw, units, answer):
    ds = load_csv_bytes(raw, dataset_id="t", units=units)
    return diagnose_answer(ds, verify_answer(ds, answer))


def contradicted(result):
    return [c for c in result["claims"] if c["status"] == "CONTRADICTED"]


class Synthetic(unittest.TestCase):
    def test_last_row_left_out_of_a_sum(self):
        r = diagnose(POP, POP_UNITS, f"8개 국가의 인구 합계는 {TOTAL - 6130:,}명입니다.")
        (c,) = contradicted(r)
        d = c["diagnosis"]
        self.assertEqual((d["kind"], d["rows"], d["confidence"], d["candidates"]), ("OMITTED_ROW", [8], "high", 1))
        self.assertIn("마지막 ‘아국’ 행", d["explanation"])
        self.assertIn("합계를", d["explanation"])
        self.assertEqual(r["forensics"], {"version": "statguard-forensics-v0.1", "contradicted": 1, "explained": 1})

    def test_median_given_for_a_mean(self):
        median = (2290 + 3400) / 2  # 2845
        r = diagnose(POP, POP_UNITS, f"8개 국가의 인구 평균은 {median:,.0f}명입니다.")
        d = contradicted(r)[0]["diagnosis"]
        self.assertEqual((d["kind"], d["title"]), ("WRONG_STATISTIC", "평균 대신 중앙값"))

    def test_divided_by_the_wrong_count(self):
        r = diagnose(POP, POP_UNITS, f"8개 국가의 인구 평균은 {TOTAL / 7:,.1f}명입니다.")
        d = contradicted(r)[0]["diagnosis"]
        self.assertEqual(d["kind"], "WRONG_COUNT")

    def test_unrelated_number_is_not_explained(self):
        r = diagnose(POP, POP_UNITS, "8개 국가의 인구 합계는 31,111명입니다.")
        (c,) = contradicted(r)
        self.assertNotIn("diagnosis", c)
        self.assertEqual(r["forensics"]["explained"], 0)

    def test_verified_claims_are_untouched(self):
        r = diagnose(POP, POP_UNITS, f"8개 국가의 인구 합계는 {TOTAL:,}명입니다.")
        self.assertEqual([c["status"] for c in r["claims"]], ["VERIFIED"])
        self.assertNotIn("diagnosis", r["claims"][0])

    def test_stated_counts(self):
        self.assertEqual(stated_counts("고소득 국가 60개의 평균"), {60})
        self.assertEqual(stated_counts("국가 46곳 실업률을 사용해 \\(n-1=45\\)로 나누어"), {46})


class RecordedAnswers(unittest.TestCase):
    """Real wrong answers from experiments/statguard_benchmark_v0.2·v0.3 (condition A, gpt-6-luna)."""

    def bench(self, version, file, units, answer):
        return diagnose((BENCH / f"statguard_benchmark_v{version}" / "datasets" / file).read_bytes(), units, answer)

    def test_wrong_total_propagates_into_the_ratio(self):
        r = self.bench("0.2", "06_시애틀_2023_일별기상.csv", {"강수량": "mm", "최고기온": "℃", "최저기온": "℃"},
                       "2023년 12월 강수량 합계는 215.4mm이고, 연간 강수량 합계는 888.4mm입니다. 따라서 12월 강수량은 연간 합계의 약 24.25%입니다.")
        ratio = [c for c in contradicted(r) if c["operation"] == "ratio_percent"][0]
        self.assertEqual(ratio["diagnosis"]["kind"], "PROPAGATED")
        self.assertIn("‘888.4mm’", ratio["diagnosis"]["explanation"])

    def test_one_country_left_out_of_the_mean(self):
        r = self.bench("0.3", "08_세계_국가별_2023_지표.csv", {"총인구": "명", "실업률": "%", "1인당GDP": "달러", "기대수명": "세"},
                       "고소득 국가 60개의 2023년 1인당 GDP를 단순 평균하면 약 44,871.10달러입니다.")
        d = contradicted(r)[0]["diagnosis"]
        self.assertEqual((d["kind"], d["confidence"], d["candidates"]), ("OMITTED_ROW", "high", 1))
        self.assertIn("Guyana", d["explanation"])
        self.assertIn("44,871.10달러", d["explanation"])
        self.assertIn("답변도 스스로 60개라고", d["explanation"])

    def test_two_rows_only_when_the_answer_states_the_count(self):
        units = {"총인구": "명", "실업률": "%", "1인당GDP": "달러", "기대수명": "세"}
        said = self.bench("0.3", "08_세계_국가별_2023_지표.csv", units, "유럽·중앙아시아 지역의 국가 46곳 실업률을 사용해 계산한 표본표준편차는 약 2.938%입니다.")
        self.assertEqual(contradicted(said)[0]["diagnosis"]["kind"], "OMITTED_ROWS")
        silent = self.bench("0.3", "08_세계_국가별_2023_지표.csv", units, "유럽·중앙아시아 지역의 실업률 표본표준편차는 약 2.938%입니다.")
        self.assertNotIn("diagnosis", contradicted(silent)[0])


class Bridge(unittest.TestCase):
    def test_verify_answer_response_carries_the_diagnosis(self):
        table = load_csv_bytes(POP, dataset_id="t")
        req = {"mode": "verify_answer", "request_id": "00000000-0000-4000-8000-000000000001",
               "csv_base64": base64.b64encode(POP).decode(), "source_sha256": hashlib.sha256(POP).hexdigest(),
               "preview_sha256": preview_hash(table.columns, table.rows), "encoding": "utf-8-sig", "units": POP_UNITS,
               "answer_text": f"8개 국가의 인구 합계는 {TOTAL - 6130:,}명입니다."}
        out = calculate_request(req)
        self.assertTrue(out["ok"])
        self.assertEqual(out["verification"]["claims"][0]["diagnosis"]["kind"], "OMITTED_ROW")


if __name__ == "__main__":
    unittest.main()

"""Inline arithmetic check (no CSV, no LLM): recompute calculations written out in an answer."""
import unittest

from when2warn.statguard.arithmetic import check_answer


def run(text):
    return [(c["expression"], c["stated"], c["status"]) for c in check_answer(text)["checks"]]


class InlineArithmetic(unittest.TestCase):
    def test_wrong_sum_is_inconsistent(self):
        (c,) = check_answer("전체 합계는 1000 + 1178 + 800 + 960 + 500 + 500 = 3938명입니다.")["checks"]
        self.assertEqual((c["status"], c["recomputed"], c["stated"]), ("INCONSISTENT", "4938", "3938"))

    def test_decimals_and_units_inside_the_expression(self):
        self.assertEqual(run("78.5 + 60.1 + 65.3 = 203.9mm입니다."), [("78.5 + 60.1 + 65.3", "203.9", "CONSISTENT")])
        self.assertEqual(run("총 강수량 = 888.9 + 644.4 + 1336.1 + 857.4 = 3726.8 mm"), [("888.9 + 644.4 + 1336.1 + 857.4", "3726.8", "CONSISTENT")])
        self.assertEqual(run("월평균은 532.1 mm / 6 = 88.68 mm입니다.")[0][2], "CONSISTENT")  # 88.6833… rounds to 88.68
        self.assertEqual(run("월평균은 532.1 / 6 = 88.86 mm입니다.")[0][2], "INCONSISTENT")

    def test_percentage_with_thousand_separators(self):
        self.assertEqual(run("증가율은 (965,960 / 50,746,659) × 100 ≈ 1.904%입니다.")[0][2], "INCONSISTENT")  # 1.903494… rounds to 1.903
        self.assertEqual(run("증가율은 (965,960 / 50,746,659) × 100 ≈ 1.90%입니다.")[0][2], "CONSISTENT")

    def test_latex_fraction(self):
        self.assertEqual(run(r"변화율은 \(\frac{(87.3 - 65.3)}{65.3} \times 100 = 33.07\%\)입니다.")[0][2], "INCONSISTENT")
        self.assertEqual(run(r"변화율은 \(\frac{(87.3 - 65.3)}{65.3} \times 100 = 33.69\%\)입니다.")[0][2], "CONSISTENT")

    def test_dates_ranges_and_plain_numbers_are_ignored(self):
        self.assertEqual(run("2023-12-31 기준 강수량은 0.0mm입니다. 7~12월은 6개월입니다."), [])
        self.assertEqual(run("연간 강수량은 888.9mm입니다."), [])

    def test_never_reads_a_fragment_of_a_longer_expression(self):
        text = "증감률(계산: (2023−2019)/2019 × 100) = −52,203 / 51,764,822 × 100 ≈ −0.10085%입니다."
        self.assertEqual(run(text), [("-52,203 / 51,764,822 × 100", "-0.10085", "CONSISTENT")])

    def test_expression_written_with_words_is_skipped(self):
        text = "변화율 = (2024년 방문자수(500) − 2023년 방문자수(500)) / 2023년 방문자수(500) × 100 = 0%."
        self.assertEqual(run(text), [])

    def test_chained_equalities(self):
        self.assertEqual(run("총 강수량 = 888.9 + 644.4 = 1533.3 mm"), [("888.9 + 644.4", "1533.3", "CONSISTENT")])

    def test_summary_counts(self):
        r = check_answer("1 + 1 = 2이고 2 + 2 = 5입니다.")
        self.assertEqual(r["summary"], {"checked": 2, "inconsistent": 1})


class Transport(unittest.TestCase):
    def test_bridge_mode_without_csv(self):
        from when2warn.statguard.local_bridge import calculate_request
        out = calculate_request({"mode": "check_arithmetic", "request_id": "r1", "answer_text": "1000 + 1178 = 2078명"})
        self.assertTrue(out["ok"])
        self.assertEqual(out["arithmetic"]["summary"], {"checked": 1, "inconsistent": 1})
        self.assertEqual(calculate_request({"mode": "check_arithmetic", "request_id": "r1", "answer_text": " "})["error"]["code"], "ANSWER_TEXT_REQUIRED")
        self.assertFalse(calculate_request({"mode": "check_arithmetic", "request_id": "r1", "answer_text": "1+1=2", "csv_base64": ""})["ok"])

    def test_public_endpoint_accepts_the_mode(self):
        import importlib.util
        import json
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location("statguard_cloud_handler_arith", root / "frontend/api/statguard.py")
        cloud = importlib.util.module_from_spec(spec); spec.loader.exec_module(cloud)
        status, body = cloud.process_body(json.dumps({"mode": "check_arithmetic", "request_id": "r2", "answer_text": "(426.6 / 3726.8) × 100 ≈ 11.4%"}).encode())
        self.assertEqual(status, 200)
        self.assertEqual(body["arithmetic"]["checks"][0]["status"], "CONSISTENT")


if __name__ == "__main__":
    unittest.main()

"""Python API and command line (no provider/network)."""
import contextlib
import io
from pathlib import Path
import unittest

from when2warn.statguard.__main__ import main
from when2warn.statguard.api import check_calculations, verify

ROOT = Path(__file__).resolve().parents[1]
DAILY = ROOT / "experiments/statguard_benchmark_v0.2/datasets/06_시애틀_2023_일별기상.csv"
UNITS = {"강수량": "mm", "최고기온": "℃", "최저기온": "℃"}


def run_cli(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = main(list(args))
    return code, out.getvalue()


class Api(unittest.TestCase):
    def test_verify_returns_verdicts_cause_and_text(self):
        r = verify(DAILY, "2023년 연간 강수량 합계는 888.4mm입니다. 2023년 12월 강수량 합계는 215.4mm입니다.", units=UNITS)
        self.assertEqual([c["status"] for c in r.claims], ["CONTRADICTED", "VERIFIED"])
        self.assertFalse(r.ok)
        self.assertIn("[계산 불일치] 2023년 연간 강수량 합계는 888.4mm입니다.", r.text())
        self.assertIn("왜 틀렸을까", r.text())  # 888.4 = 888.9 minus one 0.5 mm day

    def test_csv_text_and_bytes_are_accepted(self):
        text = "연도,값\n2023,10\n2024,20\n"
        for source in (text, text.encode()):
            self.assertEqual(verify(source, "전체 값 합계는 30건입니다.", units={"값": "건"}).summary["VERIFIED"], 1)

    def test_half_year_range_on_daily_data(self):
        r = verify(DAILY, "2023년 하반기(7~12월) 강수량 합계는 532.1mm입니다.", units=UNITS)
        self.assertIn("RANGE_AS_VALUE_SET", r.claims[0]["notes"])
        self.assertEqual(r.claims[0]["spec"]["value_sets"], {"월": ["7", "8", "9", "10", "11", "12"]})

    def test_check_calculations_needs_no_csv(self):
        self.assertEqual(check_calculations("78.5 + 60.1 = 140.7mm")["summary"], {"checked": 1, "inconsistent": 1})


class CommandLine(unittest.TestCase):
    def test_verify_and_check(self):
        code, out = run_cli("verify", "--csv", str(DAILY), "--unit", "강수량=mm", "--answer", "2023년 연간 강수량 합계는 888.4mm입니다.")
        self.assertEqual(code, 1)
        self.assertIn("계산 불일치", out)
        code, out = run_cli("check", "--answer", "1000 + 1178 = 2178명")
        self.assertEqual((code, out.strip()), (0, "계산 맞음 1000 + 1178 = 2178"))

    def test_bad_unit_argument(self):
        with self.assertRaises(SystemExit):
            run_cli("verify", "--csv", str(DAILY), "--unit", "강수량", "--answer", "x")


if __name__ == "__main__":
    unittest.main()

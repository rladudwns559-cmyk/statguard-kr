"""Command line. No provider, no network, nothing stored.

python -m when2warn.statguard verify --csv 자료.csv --unit 강수량=mm --answer "2023년 연간 강수량은 888.4mm입니다."
python -m when2warn.statguard verify --csv 자료.csv --unit 강수량=mm --answer-file 답변.txt --json
python -m when2warn.statguard check --answer "78.5 + 60.1 = 140.7mm"      # no CSV: written-out calculations only
python -m when2warn.statguard demo                                           # synthetic offline demo
"""
import argparse
import json
import sys
from pathlib import Path

from .core import StatGuardError
from .demo import readable_report, replay_fixtures


def _demo(args) -> int:
    try:
        report = replay_fixtures(Path(__file__).resolve().parents[3])
        if args.output_dir:
            # Derived demo outputs only. This is not the old evaluator persistence adapter.
            args.output_dir.mkdir(parents=True, exist_ok=False)
            with (args.output_dir / "demo_results.json").open("x", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            with (args.output_dir / "demo_readable_ko.md").open("x", encoding="utf-8") as f:
                f.write(readable_report(report))
            print(json.dumps({"passed_cases": report["passed_cases"], "case_count": report["case_count"], "output_dir": str(args.output_dir)}, ensure_ascii=False))
        else:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["passed_cases"] == 24 else 1
    except FileExistsError:
        print(json.dumps({"error": "EXISTING_DEMO_OUTPUT_REFUSED"}))
        return 2


def _answer(args) -> str:
    if args.answer_file:
        return Path(args.answer_file).read_text(encoding="utf-8")
    if args.answer is None:
        raise SystemExit("--answer 또는 --answer-file 이 필요합니다.")
    return args.answer


def _units(pairs: list[str]) -> dict[str, str]:
    units = {}
    for pair in pairs:
        column, sep, unit = pair.partition("=")
        if not sep or not column.strip() or not unit.strip():
            raise SystemExit(f"--unit 은 '열=단위' 형식이어야 합니다: {pair}")
        units[column.strip()] = unit.strip()
    return units


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m when2warn.statguard", description="StatGuard-KR: AI 답변 속 숫자를 CSV로 다시 계산해 검증")
    sub = parser.add_subparsers(dest="command", required=True)
    demo = sub.add_parser("demo", help="합성 오프라인 계산 데모")
    demo.add_argument("--output-dir", type=Path)
    verify = sub.add_parser("verify", help="CSV로 답변의 숫자를 검증 (오류 역추적·계산 검산 포함)")
    verify.add_argument("--csv", required=True, type=Path)
    verify.add_argument("--unit", action="append", default=[], metavar="열=단위", help="숫자 열의 단위. 여러 번 쓸 수 있음")
    verify.add_argument("--answer")
    verify.add_argument("--answer-file")
    verify.add_argument("--encoding", default="auto", choices=["auto", "utf-8-sig", "cp949"])
    verify.add_argument("--json", action="store_true", help="결과를 JSON으로 출력")
    check = sub.add_parser("check", help="CSV 없이 답변에 적힌 계산식만 검산")
    check.add_argument("--answer")
    check.add_argument("--answer-file")
    check.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "demo":
            return _demo(args)
        from .api import check_calculations, verify as verify_answer
        if args.command == "verify":
            report = verify_answer(args.csv, _answer(args), _units(args.unit), encoding=args.encoding)
            print(json.dumps({"verification": report.verification, "arithmetic": report.arithmetic}, ensure_ascii=False, indent=2) if args.json else report.text())
            return 0 if report.ok else 1
        result = check_calculations(_answer(args))
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for c in result["checks"]:
                print(("계산 틀림 " if c["status"] == "INCONSISTENT" else "계산 맞음 ") + f"{c['expression']} = {c['stated']}" + (f" → 다시 계산하면 {c['recomputed']}" if c["status"] == "INCONSISTENT" else ""))
            if not result["checks"]:
                print("답변에서 ‘식 = 결과’ 형태의 계산을 찾지 못했습니다.")
        return 0 if not result["summary"]["inconsistent"] else 1
    except StatGuardError as exc:
        print(json.dumps({"error": exc.code}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

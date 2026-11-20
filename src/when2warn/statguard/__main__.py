"""Local synthetic demo only. No live/provider mode exists."""
import argparse
import json
from pathlib import Path

from .core import StatGuardError
from .demo import readable_report, replay_fixtures


def main() -> int:
    parser = argparse.ArgumentParser(description="StatGuard 합성 오프라인 계산 검증")
    parser.add_argument("command", choices=["demo"])
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
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
    except StatGuardError as exc:
        print(json.dumps({"error": exc.code}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

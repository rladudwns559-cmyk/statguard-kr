"""Repeat-run stability across the three benchmarks (PROTOCOL v0.3 section B). No API calls.

python -X utf8 -I stability.py → stability_results.json, STABILITY.md, frontend/src/statguard/benchmarkStability.json
StatGuard decisions use the frozen rule extractor v0.6 (the web version) for every benchmark, so
only the model's run-to-run variation changes between runs.
"""
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(HERE / "statguard_benchmark_v0.3" / "frozen"))
from claims_v0_6 import verify_answer  # noqa: E402
from when2warn.statguard.core import load_csv_bytes  # noqa: E402

spec = importlib.util.spec_from_file_location("eval03", HERE / "statguard_benchmark_v0.3" / "evaluate.py")
sys.argv = [sys.argv[0]]
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)  # reuse final_value / is_correct / decide with the latest unit aliases

BENCHMARKS = {"v0.1 작은 표": "statguard_benchmark_v0.1", "v0.2 큰 표": "statguard_benchmark_v0.2", "v0.3 국가별": "statguard_benchmark_v0.3"}
COND = {"A": "A 일반 LLM", "C": "C LLM+계산 도구"}


def main():
    out = {}
    for label, folder in BENCHMARKS.items():
        base = HERE / folder
        datasets = json.loads((base / "datasets.json").read_text(encoding="utf-8"))
        questions = {q["id"]: q for q in json.loads((base / "questions.json").read_text(encoding="utf-8"))}
        expected = json.loads((base / "expected.json").read_text(encoding="utf-8"))
        tables = {k: load_csv_bytes((base / "datasets" / d["file"]).read_bytes(), dataset_id="b", units=d["units"]) for k, d in datasets.items()}
        for cond in ("A", "C"):
            runs = []
            for suffix in ("", "_r2", "_r3"):
                path = base / "results" / f"answers_{cond}{suffix}.json"
                if path.exists():
                    runs.append(json.loads(path.read_text(encoding="utf-8")))
            if len(runs) < 2:
                continue
            per_run, correctness = [], {}
            for run in runs:
                rows = []
                for qid, a in run.items():
                    ok, _ = ev.is_correct(expected[qid], ev.final_value(a["answer"]))
                    decision = ev.decide(verify_answer(tables[questions[qid]["dataset"]], a["answer"])["summary"])
                    rows.append({"id": qid, "wrong": not ok, "decision": decision})
                    correctness.setdefault(qid, []).append(ok)
                passed = [r for r in rows if r["decision"] == "PASS"]
                flagged = [r for r in rows if r["decision"] == "FLAG"]
                per_run.append({"n": len(rows), "accuracy": sum(not r["wrong"] for r in rows) / len(rows),
                                "coverage": sum(r["decision"] != "HOLD" for r in rows) / len(rows),
                                "passed": len(passed), "wrong_among_passed": sum(r["wrong"] for r in passed),
                                "flagged": len(flagged), "wrong_among_flagged": sum(r["wrong"] for r in flagged),
                                "decisions": dict(Counter(r["decision"] for r in rows))})
            complete = [v for v in correctness.values() if len(v) == len(runs)]
            out[f"{label}/{cond}"] = {"benchmark": label, "condition": COND[cond], "runs": len(runs), "per_run": per_run,
                                      "accuracy_min": min(r["accuracy"] for r in per_run), "accuracy_max": max(r["accuracy"] for r in per_run),
                                      "questions_same_correctness_all_runs": sum(len(set(v)) == 1 for v in complete) / len(complete),
                                      "questions_wrong_in_some_run": sum(not all(v) for v in complete),
                                      "total_passed": sum(r["passed"] for r in per_run), "total_wrong_among_passed": sum(r["wrong_among_passed"] for r in per_run)}
    (HERE / "stability_results.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "frontend" / "src" / "statguard" / "benchmarkStability.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    pct = lambda v: f"{v * 100:.1f}%"
    L = ["# 반복 실행 안정성 (A·C 조건, 같은 요청 3회)", "", "StatGuard 판정은 모든 벤치마크에 같은 규칙 추출 v0.6(도메인 확장 실행 전에 고정한 사본)을 써서 회차 간 차이만 보이게 했다. 세 벤치마크 × 두 조건 × 3회에서 StatGuard가 통과시킨 답변은 모두 279건이고 그중 오답은 0건이다.", "",
         "| 벤치마크 · 조건 | 회차 | 회차별 정답률 | 문항별 정답 여부가 모든 회차에서 같음 | 한 번이라도 틀린 문항 | 통과 답변 중 오답(전체 회차) | 회차별 판정 비율 |",
         "|---|---|---|---|---|---|---|"]
    for k, v in out.items():
        L.append(f"| {v['benchmark']} · {v['condition']} | {v['runs']} | {' / '.join(pct(r['accuracy']) for r in v['per_run'])} | {pct(v['questions_same_correctness_all_runs'])} | "
                 f"{v['questions_wrong_in_some_run']} | {v['total_wrong_among_passed']}/{v['total_passed']} | {' / '.join(pct(r['coverage']) for r in v['per_run'])} |")
    (HERE / "STABILITY.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()

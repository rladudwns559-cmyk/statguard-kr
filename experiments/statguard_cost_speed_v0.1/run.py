"""비용·속도 비교 (PROTOCOL.md). API 호출 없음.

python -X utf8 -I run.py   # results/summary.json, results/REPORT.md
"""
from __future__ import annotations

import importlib.util
import json
import platform
import statistics as st
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
PRICE_IN, PRICE_OUT = 0.10 / 1e6, 0.50 / 1e6


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


cmp = _load("run_comparison", EXP / "statguard_comparison_v0.1" / "run_comparison.py")
rc = cmp.rc
from when2warn.statguard.arithmetic import check_answer  # noqa: E402
from when2warn.statguard.core import load_csv_bytes  # noqa: E402
from when2warn.statguard.forensics import diagnose_answer  # noqa: E402


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def main():
    datasets = {}
    for bench, folder in (("v0.1", "statguard_benchmark_v0.1"), ("v0.2", "statguard_benchmark_v0.2"), ("v0.3", "statguard_benchmark_v0.3")):
        meta = json.loads((EXP / folder / "datasets.json").read_text(encoding="utf-8"))
        for m in meta.values():
            datasets[(bench, m["file"])] = ((EXP / folder / "datasets" / m["file"]).read_bytes(), m["units"])
    times = []
    for it in cmp.items():
        raw, units = datasets[(it["bench"], it["file"])]
        for model in [cmp.BASE_MODEL, *cmp.NEW_MODELS]:
            answer = cmp.answer_of(model, it, True)
            if answer is None:
                continue

            def once():
                started = time.perf_counter()
                ds = load_csv_bytes(raw, dataset_id="bench", units=units)
                diagnose_answer(ds, rc.verify_answer(ds, answer))
                check_answer(answer)
                return time.perf_counter() - started

            once()  # warm-up, discarded
            times.append(st.median(once() for _ in range(3)))
    usage = [json.loads(l) for l in (EXP / "statguard_comparison_v0.1/results/usage.jsonl").open(encoding="utf-8")]
    judge = [u for u in usage if u.get("tag", "").startswith("judge:gpt-6-luna") and u.get("latency_s") is not None]
    jl = [u["latency_s"] for u in judge]
    jcost = [(u.get("input_tokens") or 0) * PRICE_IN + (u.get("output_tokens") or 0) * PRICE_OUT for u in judge]
    comp = json.loads((EXP / "statguard_comparison_v0.1/results/summary.json").read_text(encoding="utf-8"))["q1"]
    out = {
        "machine": f"{platform.system()} {platform.release()}, Python {platform.python_version()}",
        "statguard": {"answers": len(times), "median_ms": round(st.median(times) * 1000, 2), "p95_ms": round(pct(times, .95) * 1000, 2),
                      "total_s": round(sum(times), 2), "usd_per_1000": 0.0,
                      "passed": comp["statguard"]["전체"]["pass"], "passed_wrong": comp["statguard"]["전체"]["passed_wrong"]},
        "llm_judge": {"calls": len(judge), "median_s": round(st.median(jl), 2), "p95_s": round(pct(jl, .95), 2), "total_s": round(sum(jl), 1),
                      "mean_input_tokens": round(st.mean(u.get("input_tokens") or 0 for u in judge)),
                      "mean_output_tokens": round(st.mean(u.get("output_tokens") or 0 for u in judge)),
                      "usd_per_1000": round(st.mean(jcost) * 1000, 3),
                      "passed": comp["judge_gpt-6-luna"]["전체"]["pass"], "passed_wrong": comp["judge_gpt-6-luna"]["전체"]["passed_wrong"]},
    }
    out["speedup_median"] = round(out["llm_judge"]["median_s"] * 1000 / out["statguard"]["median_ms"])
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    s, j = out["statguard"], out["llm_judge"]
    L = ["# 비용·속도 비교 결과 v0.1", "", f"조건은 PROTOCOL.md. StatGuard 측정 환경: {out['machine']}. API 호출 없음.", "",
         "| | StatGuard (LLM 없음) | LLM 심판 (gpt-6-luna) |", "|---|---|---|",
         f"| 답변 하나 검증 시간 (중앙값) | {s['median_ms']} ms | {j['median_s']} 초 |",
         f"| 95번째 백분위 | {s['p95_ms']} ms | {j['p95_s']} 초 |",
         f"| 답변 {s['answers']}개 전체 | {s['total_s']} 초 | {j['total_s']} 초 (호출 {j['calls']}회) |",
         f"| 답변 1,000개당 추정 비용 | $0 | ${j['usd_per_1000']} (평균 입력 {j['mean_input_tokens']:,} · 출력 {j['mean_output_tokens']:,} 토큰) |",
         f"| 같은 답 360개에서 통과 중 오답 | {s['passed_wrong']}/{s['passed']} | {j['passed_wrong']}/{j['passed']} |", "",
         f"중앙값 기준 StatGuard가 약 {out['speedup_median']:,}배 빠르다. StatGuard 시간은 이 PC의 계산 시간(네트워크 왕복 제외), LLM 심판 시간은 API 왕복 전체다. 비용은 사전 고정 단가로 낸 추정치다."]
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()

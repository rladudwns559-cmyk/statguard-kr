"""PROTOCOL 8장 분석: 큰 공개 모델 심판(qwen2.5:32b) 단독 vs StatGuard 최종값 규칙 vs 결합 방식. 모델 호출 없음.

(a) 이 실험의 답 636개(v0.7.1), (b) statguard_comparison_v0.1의 OpenAI 답 360개(v0.7 고정 사본, gpt-6-luna 심판과 나란히).
변경 기록대로 1,460행 표(07) 입력 63개는 심판 불가(HOLD)로 덮어쓴다(그중 59개는 입력이 잘린 채 판정됨 → 별도 보고).
또 노트북에서 먼저 만든 llama 답(results/llama_laptop_backup)과 서버 llama 답이 얼마나 같은지 보고한다.
python -X utf8 -I analyze_judge.py   → results/judge_analysis.json, results/JUDGE_REPORT.md
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
CTX = 16384  # 서버 Ollama가 실제로 자른 길이(잘린 판정의 prompt_tokens = 16,386). 주 지표에 쓰는 판정은 모두 이보다 짧아야 한다.


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(m)
    finally:
        sys.argv = argv
    return m


rl = _load("run_local", HERE / "run_local.py")
afr = _load("analyze_final_rule", EXP / "statguard_comparison_v0.1" / "analyze_final_rule.py")
cmp, rc = afr.cmp, afr.rc


def tally(rows):
    passed = [ok for d, ok in rows if d == "PASS"]
    pw = sum(not ok for ok in passed)
    wrong = [d for d, ok in rows if not ok]
    return {"n": len(rows), "pass": len(passed), "passed_wrong": pw, "upper95": round(rl.upper95(pw, len(passed)), 4) if passed else None,
            "wrong": len(wrong), "wrong_flagged": sum(d == "FLAG" for d in wrong), "false_alarm": sum(d == "FLAG" and ok for d, ok in rows),
            "hold": sum(d == "HOLD" for d, _ in rows)}


def main():
    inputs = {r["key"]: r for r in json.loads((HERE / "judge_inputs.json").read_text(encoding="utf-8"))}
    J = {}
    for line in (HERE / "results_server_llama" / "judge_results.jsonl").open(encoding="utf-8"):
        if line.strip():
            x = json.loads(line); J[x["key"]] = x
    long_keys = {k for k, r in inputs.items() if r["file"].startswith("07_")}
    truncated = {k: J[k] for k in long_keys if J.get(k, {}).get("prompt_tokens")}

    def judge_of(key):
        if key in long_keys:
            return "HOLD"
        x = J[key]
        assert x["prompt_tokens"] is not None and x["prompt_tokens"] < CTX, key
        return x["decision"]

    out = {"a": {}, "b": {}, "b_without_07": {}, "notes": {}}
    # (a) 636 answers of this benchmark
    rows = {}
    for it in rl.items():
        for m in rl.MODELS:
            a = rl.answer(m, it, offline=True)
            ok = rl.grade(it, a)
            fr = rl.final_rule(it, a, rl.verify_v071(it["dataset"], a))
            jd = judge_of(f"v04|{m}|{it['id']}")
            hy = fr if fr != "HOLD" else jd
            for name, d in (("judge", jd), ("statguard", fr), ("hybrid", hy)):
                rows.setdefault(("all", name), []).append((d, ok)); rows.setdefault((m, name), []).append((d, ok))
    out["a"] = {f"{m}|{n}": tally(r) for (m, n), r in rows.items()}

    # (b) 360 OpenAI answers, same answers as the earlier gpt-6-luna judge
    per = json.loads((EXP / "statguard_comparison_v0.1" / "results" / "summary.json").read_text(encoding="utf-8"))["per_question"]
    rb, rb7 = {}, {}
    for it in cmp.items():
        k = cmp.key_of(it)
        for m in [cmp.BASE_MODEL, *cmp.NEW_MODELS]:
            a = cmp.answer_of(m, it, True)
            ok = rc.grade(it, a)
            fr = afr.final_rule(it, a)
            key = f"cmp|{m}|{k}"
            jq = judge_of(key)
            jl = per[k][m].get("judge_gpt-6-luna")
            for name, d in (("judge_qwen32b", jq), ("judge_gpt-6-luna", jl), ("statguard", fr),
                            ("hybrid_qwen32b", fr if fr != "HOLD" else jq), ("hybrid_gpt-6-luna", fr if fr != "HOLD" else jl)):
                if d is None:
                    continue
                rb.setdefault(name, []).append((d, ok))
                if key not in long_keys:
                    rb7.setdefault(name, []).append((d, ok))
            if key in truncated:
                truncated[key] = {"decision": truncated[key]["decision"], "correct": ok}
    out["b"] = {n: tally(r) for n, r in rb.items()}
    out["b_without_07"] = {n: tally(r) for n, r in rb7.items()}
    tr = [v for v in truncated.values() if "correct" in v]
    out["notes"]["truncated_judged"] = {"n": len(tr), "decisions": dict(Counter(v["decision"] for v in tr)),
                                       "pass_wrong": sum(v["decision"] == "PASS" and not v["correct"] for v in tr),
                                       "pass": sum(v["decision"] == "PASS" for v in tr)}
    out["notes"]["long_inputs"] = len(long_keys)
    out["notes"]["judge_seconds_median"] = sorted(x["seconds"] for x in J.values() if x.get("seconds"))[len([1 for x in J.values() if x.get("seconds")]) // 2] if any(x.get("seconds") for x in J.values()) else None
    out["notes"]["judge_format_errors"] = sum(1 for x in J.values() if x.get("verdict") is None and not x.get("skipped") and x["key"] not in long_keys)

    # laptop vs server llama agreement (same request → same cache file name)
    backup = HERE / "results" / "llama_laptop_backup" / "cache"
    same, both, same_final, same_correct = 0, 0, 0, 0
    for it in rl.items():
        body = {"model": "llama3.1:8b", "messages": [{"role": "system", "content": rc.INSTRUCTIONS}, rl.user_msg(it)], "stream": False, "options": rl.OPTIONS}
        import hashlib
        d = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
        p_l, p_s = backup / f"{d}.json", HERE / "results_server_llama" / "cache" / f"{d}.json"
        if p_l.exists() and p_s.exists():
            al = (json.loads(p_l.read_text(encoding="utf-8")).get("message") or {}).get("content", "").strip()
            as_ = (json.loads(p_s.read_text(encoding="utf-8")).get("message") or {}).get("content", "").strip()
            both += 1; same += al == as_
            fl, fs = rl.ev.final_value(al), rl.ev.final_value(as_)
            same_final += (fl["kind"], str(fl.get("value"))) == (fs["kind"], str(fs.get("value")))
            same_correct += rl.grade(it, al) == rl.grade(it, as_)
    out["notes"]["llama_laptop_vs_server"] = {"both": both, "identical_text": same, "same_final_value": same_final, "same_correctness": same_correct}

    (HERE / "results" / "judge_analysis.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(out)


def row(name, t):
    return (f"| {name} | {t['pass']}/{t['n']} | **{t['passed_wrong']}** ({(t['upper95'] or 0) * 100:.1f}%) | "
            f"{t['wrong_flagged']}/{t['wrong']} | {t['false_alarm']} | {t['hold']} |")


def write_report(o):
    H = ["| 방식 | 통과 | 통과 중 오답 (95% 상한) | 오답 중 FLAG | 정답을 FLAG | 보류 |", "|---|---|---|---|---|---|"]
    N = {"judge": "심판 qwen2.5:32b 단독", "statguard": "StatGuard 최종값 규칙", "hybrid": "결합 (StatGuard → 보류만 심판)",
         "judge_qwen32b": "심판 qwen2.5:32b 단독", "judge_gpt-6-luna": "심판 gpt-6-luna 단독 (이전 실험)",
         "hybrid_qwen32b": "결합: StatGuard + qwen2.5:32b", "hybrid_gpt-6-luna": "결합: StatGuard + gpt-6-luna"}
    L = ["# 큰 공개 모델 심판과 결합 방식 (PROTOCOL 8장)", "",
         "심판 qwen2.5:32b는 외부 GPU 서버에서 실행. 1,460행 표(07) 입력 63개는 심판의 입력 한도를 넘어 HOLD(심판 불가)로 처리(변경 기록).", "",
         "## (a) 이 실험의 답 636개 (qwen2.5:7b·llama3.1:8b·gemma3:4b, StatGuard v0.7.1)", ""]
    for m in ["all", *rl.MODELS]:
        L += [f"**{'전체' if m == 'all' else m}**", "", *H] + [row(N[n], o["a"][f"{m}|{n}"]) for n in ("judge", "statguard", "hybrid")] + [""]
    for key, title in (("b", "## (b) OpenAI 모델 답 360개 (StatGuard v0.7 고정 사본)"), ("b_without_07", "## (b′) 같은 답에서 1,460행 표 63개를 뺀 297개")):
        L += [title, "", *H] + [row(N[n], o[key][n]) for n in ("judge_gpt-6-luna", "judge_qwen32b", "statguard", "hybrid_gpt-6-luna", "hybrid_qwen32b") if n in o[key]] + [""]
    t, ll = o["notes"]["truncated_judged"], o["notes"]["llama_laptop_vs_server"]
    L += ["## 참고", "",
          f"- 입력이 잘린 채 나온 판정 {t['n']}개(주 지표에서 제외): {t['decisions']}, ‘맞음’ {t['pass']}개 중 실제 오답 {t['pass_wrong']}개.",
          f"- 심판 응답 형식 오류(긴 입력 제외): {o['notes']['judge_format_errors']}개. 심판 응답 시간 중앙값: {o['notes']['judge_seconds_median']}초.",
          f"- llama3.1:8b 노트북 답 vs 서버 답(같은 설정): {ll['both']}문항 중 글자까지 같음 {ll['identical_text']}, 최종값 같음 {ll['same_final_value']}, 정답 여부 같음 {ll['same_correctness']}."]
    (HERE / "results" / "JUDGE_REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()

"""StatGuard 비교 실험 (PROTOCOL.md). Stdlib HTTP only; responses cached; key never logged.

python -X utf8 -I run_comparison.py pilot            # 모델별 3문항 시험(답변·심판)
python -X utf8 -I run_comparison.py run [--stage S]  # answers | judge | correct | all
python -X utf8 -I run_comparison.py report           # API 호출 없이 results/summary.json, REPORT.md
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
_spec = importlib.util.spec_from_file_location("run_correction", EXP / "statguard_correction_v0.1" / "run_correction.py")
rc = importlib.util.module_from_spec(_spec)
_argv = sys.argv; sys.argv = [_argv[0]]
try:
    _spec.loader.exec_module(rc)
finally:
    sys.argv = _argv
verify_answer = rc.verify_answer  # frozen rule extractor v0.7

BASE_MODEL = "gpt-6-luna"
NEW_MODELS = {"gpt-4o-mini": {"max_output_tokens": 2500},
              "gpt-5-mini": {"max_output_tokens": 8000, "reasoning": {"effort": "low"}}}
# gpt-6-luna judge: 8000 per PROTOCOL 변경 기록 (pilot hit max_output_tokens at 2500)
JUDGES = {"gpt-6-luna": {"max_output_tokens": 8000}, "gpt-5-mini": {"max_output_tokens": 8000, "reasoning": {"effort": "low"}}}
MAX_CALLS = 2500
BUDGET_USD = 2.00  # PROTOCOL 변경 기록: whole experiment incl. calls already made
PRICES = {"gpt-4o-mini": (0.15, 0.60), "gpt-4.1-mini": (0.40, 1.60), "gpt-5-mini": (0.25, 2.00), "gpt-6-luna": (0.10, 0.50)}
WORKERS = 8
CACHE = HERE / "results" / "cache"
USAGE = HERE / "results" / "usage.jsonl"
LOCK = threading.Lock()
JUDGE_INSTRUCTIONS = ("당신은 표 데이터 분석 답변을 검토하는 검증자입니다. CSV 자료, 질문, 다른 AI의 답변이 주어집니다. "
                      "CSV를 직접 확인해 답변의 최종값이 맞는지 판정하세요. 답변이 ‘판단불가’라고 했다면 그 판단이 맞는지 판정하세요. "
                      "최종값이 맞으면 ‘맞음’, 틀리면 ‘틀림’, 자료로 확인할 수 없으면 ‘판단불가’를 고르고, 이유를 한두 문장으로 적으세요.")
JUDGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["verdict", "reason"],
                "properties": {"verdict": {"type": "string", "enum": ["맞음", "틀림", "판단불가"]}, "reason": {"type": "string"}}}
VERDICT = {"맞음": "PASS", "틀림": "FLAG", "판단불가": "HOLD"}
_calls = None
_spent = None


def cost_of(u: dict) -> float:
    pi, po = PRICES[u["model"]]
    return (u.get("input_tokens") or 0) / 1e6 * pi + (u.get("output_tokens") or 0) / 1e6 * po


def spent() -> float:
    global _spent
    if _spent is None:
        _spent = sum(cost_of(json.loads(l)) for l in USAGE.open(encoding="utf-8")) if USAGE.exists() else 0.0
    return _spent


class BudgetReached(Exception):
    pass


def calls_so_far() -> int:
    global _calls
    if _calls is None:
        _calls = sum(1 for _ in USAGE.open(encoding="utf-8")) if USAGE.exists() else 0
    return _calls


def respond(model: str, body: dict, tag: str, offline: bool = False) -> dict | None:
    global _calls, _spent
    body = {"model": model, "store": False, **body}
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    if offline:
        return None
    with LOCK:
        if calls_so_far() >= MAX_CALLS:
            raise BudgetReached(f"call cap {MAX_CALLS} reached")
        if spent() >= BUDGET_USD:
            raise BudgetReached(f"budget ${BUDGET_USD} reached (est. ${spent():.3f})")
        _calls += 1
    data = json.dumps(body).encode()
    for attempt in range(4):
        request = urllib.request.Request("https://api.openai.com/v1/responses", data=data,
                                         headers={"Authorization": "Bearer " + rc.api_key(), "Content-Type": "application/json"})
        started = time.monotonic()
        try:
            response = json.load(urllib.request.urlopen(request, timeout=300))
            break
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read() or b"{}").get("error", {})
            if (error.code == 429 or error.code >= 500) and attempt < 3:
                time.sleep(5 * (attempt + 1)); continue
            with LOCK, USAGE.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"tag": tag, "model": model, "status": error.code, "error": detail.get("code") or detail.get("type")}) + "\n")
            raise RuntimeError(f"HTTP {error.code}: {detail.get('message', '')[:300]}")
        except (urllib.error.URLError, TimeoutError):
            if attempt < 3:
                time.sleep(5 * (attempt + 1)); continue
            raise
    usage = response.get("usage") or {}
    with LOCK:
        _spent = spent() + cost_of({"model": model, **usage})
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
        with USAGE.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"tag": tag, "model": model, "input_tokens": usage.get("input_tokens"),
                                "output_tokens": usage.get("output_tokens"),
                                "reasoning_tokens": (usage.get("output_tokens_details") or {}).get("reasoning_tokens"),
                                "latency_s": round(time.monotonic() - started, 2), "status": response.get("status")}) + "\n")
    return response


def key_of(it) -> str:
    return f"{it['bench']}{'' if it['set'] == 'main' else '_holdout'}:{it['id']}"


ITEMS = None


def items() -> list[dict]:
    global ITEMS
    if ITEMS is None:
        ITEMS = list(rc.items())
    return ITEMS


def user_msg(it) -> dict:
    return {"role": "user", "content": f"파일: {it['file']}\nCSV:\n{it['csv']}\n\n질문: {it['question']}"}


def answer_of(model: str, it, offline: bool) -> str | None:
    if model == BASE_MODEL:
        return it["answer"]
    r = respond(model, {"instructions": rc.INSTRUCTIONS, "input": [user_msg(it)], **NEW_MODELS[model]}, f"answer:{model}:{key_of(it)}", offline)
    return None if r is None else rc.output_text(r)


def judge(judge_model: str, it, answer: str, answer_model: str, offline: bool) -> dict | None:
    content = f"파일: {it['file']}\nCSV:\n{it['csv']}\n\n질문: {it['question']}\n\n검토할 답변:\n{answer}"
    body = {"instructions": JUDGE_INSTRUCTIONS, "input": [{"role": "user", "content": content}],
            "text": {"format": {"type": "json_schema", "name": "verdict", "strict": True, "schema": JUDGE_SCHEMA}}, **JUDGES[judge_model]}
    r = respond(judge_model, body, f"judge:{judge_model}:{answer_model}:{key_of(it)}", offline)
    if r is None:
        return None
    try:
        out = json.loads(rc.output_text(r))
        return {"decision": VERDICT[out["verdict"]], "reason": out["reason"]}
    except (ValueError, KeyError):
        return {"decision": "HOLD", "reason": "(심판 응답 형식 오류)", "invalid": True}


def correct(model: str, it, answer: str, cond: str, offline: bool) -> list[dict]:
    """Same procedure as statguard_correction_v0.1 run_condition, sent to the model that wrote the answer."""
    convo = [user_msg(it)]
    trail = []
    for rnd in range(rc.ROUNDS + 1):
        result = verify_answer(it["dataset"], answer)
        decision = rc.decide(result["summary"])
        step = {"round": rnd, "decision": decision, "correct": rc.grade(it, answer), "answer": answer}
        trail.append(step)
        if rnd == rc.ROUNDS or not rc.needs_fix(it["ev"], answer, decision):
            break
        feedback = rc.RECHECK if cond == "R" else rc.statguard_feedback(result)
        convo = convo + [{"role": "assistant", "content": answer}, {"role": "user", "content": feedback}]
        r = respond(model, {"instructions": rc.INSTRUCTIONS, "input": convo, **NEW_MODELS[model]}, f"{cond}:{model}:{key_of(it)}:{rnd + 1}", offline)
        if r is None:
            step["pending"] = True
            break
        answer = rc.output_text(r)
    return trail


def pmap(fn, xs):
    with ThreadPoolExecutor(WORKERS) as pool:
        return list(pool.map(fn, xs))


def stage_answers(selected, offline=False):
    for m in NEW_MODELS:
        res = pmap(lambda it: answer_of(m, it, offline), selected)
        print(m, "answers", sum(r is not None for r in res), "/", len(selected), flush=True)


def stage_judge(selected, offline=False, judges=None):
    for jm in judges or JUDGES:
        for am in [BASE_MODEL, *NEW_MODELS]:
            def one(it):
                a = answer_of(am, it, True)
                return None if a is None else judge(jm, it, a, am, offline)
            res = pmap(one, selected)
            print("judge", jm, "on", am, Counter(r["decision"] for r in res if r), flush=True)


def stage_correct(selected, offline=False):
    for m in NEW_MODELS:
        def one(it):
            a = answer_of(m, it, True)
            return None if a is None else (correct(m, it, a, "R", offline), correct(m, it, a, "S", offline))
        res = pmap(one, selected)
        print(m, "corrected", sum(r is not None for r in res), flush=True)


# ---------- report ----------

def upper95(k: int, n: int) -> float:
    """Clopper–Pearson one-sided-in-each-tail 95% upper limit (alpha/2 = 0.025), bisection on the binomial CDF."""
    if n == 0:
        return 1.0
    if k >= n:
        return 1.0
    from math import comb
    cdf = lambda p: sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))
    lo, hi = k / n, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if cdf(mid) > 0.025 else (lo, mid)
    return hi


def final_sig(ev, answer: str):
    f = ev.final_value(answer)
    return (f["kind"], str(f.get("value")), f.get("unit")) if f["kind"] == "VALUE" else (f["kind"],)


def self_consistency(it) -> str | None:
    if it["set"] != "main":
        return None
    folder = {"v0.1": "statguard_benchmark_v0.1", "v0.2": "statguard_benchmark_v0.2", "v0.3": "statguard_benchmark_v0.3"}[it["bench"]]
    sigs = []
    for suffix in ("", "_r2", "_r3"):
        a = json.loads((EXP / folder / "results" / f"answers_A{suffix}.json").read_text(encoding="utf-8")).get(it["id"])
        if a is None:
            return None
        sigs.append(final_sig(it["ev"], a["answer"]))
    return "PASS" if sigs[0][0] != "FORMAT_ERROR" and len(set(sigs)) == 1 else "HOLD"


def tally(rows: list[tuple[str, bool]]) -> dict:
    n = len(rows)
    passed = [c for d, c in rows if d == "PASS"]
    wrong = [d for d, c in rows if not c]
    pw = sum(not c for c in passed)
    return {"n": n, "correct": sum(c for _, c in rows), "wrong": len(wrong), "pass": len(passed), "passed_wrong": pw,
            "passed_wrong_rate": round(pw / len(passed), 4) if passed else None, "passed_wrong_upper95": round(upper95(pw, len(passed)), 4) if passed else None,
            "wrong_flagged": sum(d == "FLAG" for d in wrong), "wrong_held": sum(d == "HOLD" for d in wrong),
            "false_alarm": sum(d == "FLAG" and c for d, c in rows), "hold": sum(d == "HOLD" for d, _ in rows),
            "coverage": round(len(passed) / n, 4) if n else None}


def cmd_report():
    its = items()
    models = [BASE_MODEL, *NEW_MODELS]
    pending = Counter()
    per = {}
    for it in its:
        k = key_of(it)
        per[k] = {}
        for m in models:
            a = answer_of(m, it, True)
            if a is None:
                pending["answer:" + m] += 1; continue
            row = {"correct": rc.grade(it, a), "final": final_sig(it["ev"], a)[0], "statguard": rc.decide(verify_answer(it["dataset"], a)["summary"])}
            for jm in JUDGES:
                j = judge(jm, it, a, m, True)
                if j is None:
                    pending[f"judge:{jm}:{m}"] += 1
                else:
                    row["judge_" + jm] = j["decision"]
                    row.setdefault("judge_invalid", 0)
                    row["judge_invalid"] += bool(j.get("invalid"))
            if m == BASE_MODEL:
                row["self_consistency"] = self_consistency(it)
            else:
                cr = correct(m, it, a, "R", True), correct(m, it, a, "S", True)
                if any(t.get("pending") for t in cr[0] + cr[1]):
                    pending["correct:" + m] += 1
                row["R"] = [{"round": t["round"], "decision": t["decision"], "correct": t["correct"]} for t in cr[0]]
                row["S"] = [{"round": t["round"], "decision": t["decision"], "correct": t["correct"]} for t in cr[1]]
            per[k][m] = row
    verifiers = ["statguard"] + ["judge_" + j for j in JUDGES]
    q1 = {}
    for v in verifiers + ["self_consistency"]:
        q1[v] = {}
        for m in models + ["전체"]:
            rows = [(r[v], r["correct"]) for k in per for mm, r in per[k].items() if (m == "전체" or mm == m) and r.get(v)]
            if rows:
                q1[v][m] = tally(rows)
    # same 88 main-set answers of gpt-6-luna for a like-for-like comparison with self-consistency
    main_base = [per[k][BASE_MODEL] for k in per if BASE_MODEL in per[k] and per[k][BASE_MODEL].get("self_consistency")]
    q1_main88 = {v: tally([(r[v], r["correct"]) for r in main_base if r.get(v)]) for v in verifiers + ["self_consistency"]}
    q2 = {}
    at = lambda tr, r: tr[min(r, len(tr) - 1)]
    for m in NEW_MODELS:
        rows = [per[k][m] for k in per if m in per[k] and "S" in per[k][m]]
        g = {"n": len(rows), "A": sum(r["correct"] for r in rows), "format_error": sum(r["final"] == "FORMAT_ERROR" for r in rows),
             "statguard": dict(Counter(r["statguard"] for r in rows)), "targeted": sum(len(r["S"]) > 1 for r in rows)}
        for cond in ("R", "S"):
            for rnd in (1, 2):
                g[f"{cond}{rnd}"] = {"correct": sum(at(r[cond], rnd)["correct"] for r in rows),
                                     "fixed": sum((not r[cond][0]["correct"]) and at(r[cond], rnd)["correct"] for r in rows),
                                     "broken": sum(r[cond][0]["correct"] and not at(r[cond], rnd)["correct"] for r in rows),
                                     "passed_wrong": sum(at(r[cond], rnd)["decision"] == "PASS" and not at(r[cond], rnd)["correct"] for r in rows)}
        flagged = [r for r in rows if r["statguard"] == "FLAG"]
        g["flagged"] = {"n": len(flagged), "R1_fixed": sum(at(r["R"], 1)["correct"] for r in flagged), "S1_fixed": sum(at(r["S"], 1)["correct"] for r in flagged),
                        "A_correct": sum(r["correct"] for r in flagged)}
        q2[m] = g
    usage = [json.loads(l) for l in USAGE.open(encoding="utf-8")] if USAGE.exists() else []
    by_model = {}
    for u in usage:
        b = by_model.setdefault(u.get("model"), {"calls": 0, "input_tokens": 0, "output_tokens": 0, "errors": 0})
        b["calls"] += 1; b["input_tokens"] += u.get("input_tokens") or 0; b["output_tokens"] += u.get("output_tokens") or 0
        b["errors"] += "error" in u
    summary = {"meta": {"questions": len(its), "models": models, "judges": list(JUDGES), "verifier": "rule v0.7 (frozen)",
                        "pending": dict(pending)}, "q1": q1, "q1_main88_gpt6luna": q1_main88, "q2": q2, "usage": by_model, "per_question": per}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(summary)
    print(json.dumps({"pending": dict(pending), "q1_all": {v: q1[v].get("전체") for v in q1}, "q2": {m: {k: q2[m][k] for k in ("n", "A", "targeted", "R1", "S1")} for m in q2}}, ensure_ascii=False, indent=1))


NAMES = {"statguard": "StatGuard (재계산)", "judge_gpt-6-luna": "LLM 심판 gpt-6-luna", "judge_gpt-5-mini": "LLM 심판 gpt-5-mini (추론)", "self_consistency": "자기 일관성 (3회 일치)"}


def write_report(s: dict):
    pct = lambda a, n: f"{a}/{n} ({a / n * 100:.1f}%)" if n else "-"
    L = ["# StatGuard 비교 실험 결과 v0.1", "", "조건은 PROTOCOL.md(실행 전 고정). 검증기 규칙 v0.7(고정 사본).", "",
         f"미완료: {s['meta']['pending'] or '없음'}", "",
         "## Q1. 검증 방식별: 통과시킨 답 중 오답 (답변 모델 4종 × 120문항 전체)", "",
         "| 방식 | 판정한 답 | 통과 | 통과 중 오답 (95% 상한) | 오답 중 지적 | 오답 중 보류 | 정답을 틀렸다고 함 | 보류 |", "|---|---|---|---|---|---|---|---|"]
    for v, by in s["q1"].items():
        if "전체" not in by or v == "self_consistency":
            continue
        t = by["전체"]
        L.append(f"| {NAMES[v]} | {t['n']} | {t['pass']} | **{t['passed_wrong']}** ({t['passed_wrong_upper95'] * 100:.1f}%) | {t['wrong_flagged']}/{t['wrong']} | {t['wrong_held']}/{t['wrong']} | {t['false_alarm']} | {t['hold']} |")
    L += ["", "### 답변 모델별 통과 중 오답", "", "| 답변 모델 | " + " | ".join(NAMES[v] for v in s["q1"] if v != "self_consistency") + " |",
          "|---|" + "---|" * (len(s["q1"]) - 1)]
    for m in s["meta"]["models"]:
        cells = []
        for v, by in s["q1"].items():
            if v == "self_consistency":
                continue
            t = by.get(m)
            cells.append(f"{t['passed_wrong']}/{t['pass']}" if t else "-")
        L.append(f"| {m} | " + " | ".join(cells) + " |")
    L += ["", "### gpt-6-luna 본 세트 88문항 (자기 일관성과 같은 조건)", "", "| 방식 | 통과 | 통과 중 오답 | 오답 중 지적 | 보류 |", "|---|---|---|---|---|"]
    for v, t in s["q1_main88_gpt6luna"].items():
        L.append(f"| {NAMES[v]} | {t['pass']}/{t['n']} | {t['passed_wrong']} | {t['wrong_flagged']}/{t['wrong']} | {t['hold']} |")
    L += ["", "## Q2. 답변 모델별 StatGuard와 교정", "",
          "| 모델 | 원래 정답 | 형식 오류 | StatGuard 판정 | 교정 대상 | R 1R | S 1R | R 2R | S 2R | 통과 중 오답(S 2R) |", "|---|---|---|---|---|---|---|---|---|---|"]
    for m, g in s["q2"].items():
        L.append(f"| {m} | {pct(g['A'], g['n'])} | {g['format_error']} | {g['statguard']} | {g['targeted']} | {pct(g['R1']['correct'], g['n'])} | {pct(g['S1']['correct'], g['n'])} | "
                 f"{pct(g['R2']['correct'], g['n'])} | {pct(g['S2']['correct'], g['n'])} | {g['S2']['passed_wrong']} |")
    L += ["", "| 모델 | 계산 불일치로 잡힌 답 | 그중 R 1R 후 정답 | 그중 S 1R 후 정답 | 고침/망침 R 1R | 고침/망침 S 1R |", "|---|---|---|---|---|---|"]
    for m, g in s["q2"].items():
        f = g["flagged"]
        L.append(f"| {m} | {f['n']} | {f['R1_fixed']} | {f['S1_fixed']} | {g['R1']['fixed']}/{g['R1']['broken']} | {g['S1']['fixed']}/{g['S1']['broken']} |")
    L += ["", "## 비용 (모델별 호출·토큰)", "", "| 모델 | 호출 | 입력 토큰 | 출력 토큰 | 오류 |", "|---|---|---|---|---|"]
    for m, u in s["usage"].items():
        L.append(f"| {m} | {u['calls']} | {u['input_tokens']:,} | {u['output_tokens']:,} | {u['errors']} |")
    (HERE / "results" / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def cmd_export():
    """Compact copy of results/summary.json for the website (no per-question rows)."""
    s = json.loads((HERE / "results" / "summary.json").read_text(encoding="utf-8"))
    keep = ("n", "pass", "passed_wrong", "passed_wrong_upper95", "wrong", "wrong_flagged", "wrong_held", "false_alarm", "hold", "coverage", "correct")
    out = {"models": s["meta"]["models"], "judges": s["meta"]["judges"],
           "verifiers": {v: {m: {k: t[k] for k in keep} for m, t in by.items()} for v, by in s["q1"].items()},
           "main88": {v: {k: t[k] for k in keep} for v, t in s["q1_main88_gpt6luna"].items()},
           "models_q2": {m: {"n": g["n"], "A": g["A"], "format_error": g["format_error"], "statguard": g["statguard"], "targeted": g["targeted"],
                             "R1": g["R1"]["correct"], "S1": g["S1"]["correct"], "R2": g["R2"]["correct"], "S2": g["S2"]["correct"],
                             "S1_fixed": g["S1"]["fixed"], "S1_broken": g["S1"]["broken"], "R1_fixed": g["R1"]["fixed"], "R1_broken": g["R1"]["broken"],
                             "S2_passed_wrong": g["S2"]["passed_wrong"], "flagged": g["flagged"]} for m, g in s["q2"].items()}}
    path = HERE.parents[1] / "frontend" / "src" / "statguard" / "benchmarkComparison.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", path.name)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["pilot", "run", "report", "export"])
    p.add_argument("--stage", default="all", choices=["answers", "judge", "correct", "all"])
    a = p.parse_args()
    if a.cmd == "report":
        cmd_report()
    elif a.cmd == "export":
        cmd_export()
    else:
        sel = items()
        if a.cmd == "pilot":
            pick = {"v0.1": None, "v0.2": None, "v0.3": None}
            sel = [it for it in sel if it["set"] == "main" and pick.get(it["bench"]) is None and not pick.__setitem__(it["bench"], it["id"])]
        try:
            if a.stage in ("answers", "all"):
                stage_answers(sel)
            if a.stage in ("judge", "all"):
                stage_judge(sel, judges=["gpt-6-luna"])
            if a.stage in ("correct", "all") and a.cmd == "run":
                stage_correct(sel)
            if a.stage in ("judge", "all"):
                stage_judge(sel, judges=["gpt-5-mini"])
        except BudgetReached as stop:
            print("STOPPED:", stop, flush=True)
        print(f"calls {calls_so_far()} est. ${spent():.3f}", flush=True)

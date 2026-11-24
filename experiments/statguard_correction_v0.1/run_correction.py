"""StatGuard 자동 교정 실험 (PROTOCOL.md). Stdlib HTTP only; responses cached; key never logged.

python -X utf8 -I run_correction.py run [--limit N] [--only ID ...]   # R·S 교정 실행(1·2라운드)
python -X utf8 -I run_correction.py report                            # API 호출 없이 results/summary.json, REPORT.md
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(HERE / "frozen"))
from when2warn.statguard.core import load_csv_bytes  # noqa: E402
from claims_v0_7 import verify_answer  # noqa: E402  (frozen before this experiment)

MODEL = "gpt-6-luna"
MAX_CALLS = 400
PRICE_IN, PRICE_OUT = 0.10 / 1e6, 0.50 / 1e6
CACHE = HERE / "results" / "cache"
USAGE = HERE / "results" / "usage.jsonl"
ROUNDS = 2
INSTRUCTIONS = ("당신은 표 데이터 분석 도우미입니다. 한국어 2~4문장으로 답하고, 마지막 줄에 반드시 '최종값: <숫자> <단위>' 형식으로 적으세요. "
                "제공된 자료만으로 답할 수 없거나 원인·유의성처럼 이 자료의 계산으로 판단할 수 없는 질문이면 마지막 줄에 '최종값: 판단불가'라고 적으세요.")
FORMAT = "마지막 줄의 ‘최종값’ 형식을 지키세요."
RECHECK = "방금 답변을 CSV로 다시 확인한 뒤, 같은 형식으로 답변을 다시 작성하세요. " + FORMAT
SETS = [("v0.1", "statguard_benchmark_v0.1", ""), ("v0.1", "statguard_benchmark_v0.1", "_holdout"),
        ("v0.2", "statguard_benchmark_v0.2", ""), ("v0.2", "statguard_benchmark_v0.2", "_holdout"),
        ("v0.3", "statguard_benchmark_v0.3", "")]


def _reasons() -> dict[str, str]:
    """Korean reason texts as they were sent to the model in this experiment (frozen copy of the website's
    answerClient.ts REASONS at the time of the run). Reading the live file would change the feedback text — and so
    the cache keys — whenever the website wording changes (it did for RANGE_FILTER_UNSUPPORTED in v0.7.1)."""
    return json.loads((HERE / "frozen" / "reasons_ko.json").read_text(encoding="utf-8"))


REASONS = _reasons()


def _evaluator(folder: str):
    spec = importlib.util.spec_from_file_location("eval_" + folder.replace(".", "_"), EXP / folder / "evaluate.py")
    module = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.argv = argv
    return module


def api_key() -> str:
    import os
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        for line in (ROOT / ".env.retrieval-live.private").read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        raise SystemExit("OPENAI_API_KEY not configured")
    return key


def calls_so_far() -> int:
    return sum(1 for _ in USAGE.open(encoding="utf-8")) if USAGE.exists() else 0


def respond(body: dict, tag: str, offline: bool = False) -> dict | None:
    body = {"model": MODEL, "store": False, **body}
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    if offline:
        return None
    if calls_so_far() >= MAX_CALLS:
        raise SystemExit(f"call cap {MAX_CALLS} reached")
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=json.dumps(body).encode(),
                                     headers={"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"})
    started = time.monotonic()
    try:
        response = json.load(urllib.request.urlopen(request, timeout=120))
    except urllib.error.HTTPError as error:
        detail = json.loads(error.read() or b"{}").get("error", {})
        USAGE.parent.mkdir(parents=True, exist_ok=True)
        with USAGE.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"tag": tag, "status": error.code, "error": detail.get("code") or detail.get("type")}) + "\n")
        raise SystemExit(f"HTTP {error.code}: {detail.get('message', '')[:300]}")
    usage = response.get("usage") or {}
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
    with USAGE.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"tag": tag, "model": response.get("model"), "input_tokens": usage.get("input_tokens"),
                            "output_tokens": usage.get("output_tokens"), "latency_s": round(time.monotonic() - started, 2),
                            "status": response.get("status")}) + "\n")
    return response


def output_text(response: dict) -> str:
    return "".join(c.get("text", "") for item in response.get("output", []) if item.get("type") == "message"
                   for c in item.get("content", []) if c.get("type") == "output_text").strip()


def decide(summary: dict) -> str:
    return "FLAG" if summary["CONTRADICTED"] else "PASS" if summary["VERIFIED"] else "HOLD"


def statguard_feedback(result: dict) -> str:
    """Only what StatGuard itself computed from the CSV; never the benchmark's expected value."""
    claims = result["claims"]
    if decide(result["summary"]) == "FLAG":
        lines = ["같은 CSV로 다시 계산해 답변의 수치를 검증했습니다."]
        for c in claims:
            if c["status"] == "CONTRADICTED":
                comp = c["computed"]
                lines.append(f"- 불일치: “{c['sentence']}” 답변의 수치 {c['claimed']['text']} / CSV 재계산 값 {comp['value']} {comp['unit']}"
                             f" / 계산식 {comp['expression']} / 사용한 행 {len(comp['usage']['used_rows'])}개")
            elif c["status"] == "VERIFIED":
                lines.append(f"- 확인됨: “{c['sentence']}”")
        lines.append("검증 결과를 반영해 답변을 고쳐 같은 형식으로 다시 작성하세요. " + FORMAT)
        return "\n".join(lines)
    reasons = []
    for c in claims:
        text = REASONS.get(c["reason_code"], c["reason_code"])
        if text not in reasons:
            reasons.append(text)
    lines = ["답변의 수치를 CSV 계산과 연결해 검증할 수 없었습니다."]
    lines += [f"- {r}" for r in reasons] or ["- 답변에서 검증할 수 있는 수치 주장을 찾지 못했습니다."]
    lines.append("어떤 열·기간·계산인지 문장에 드러나게, 숫자를 다시 확인해 같은 형식으로 다시 작성하세요. " + FORMAT)
    return "\n".join(lines)


def needs_fix(ev, answer: str, decision: str) -> bool:
    if decision == "PASS":
        return False
    return ev.final_value(answer)["kind"] != "ABSTAIN"


def items():
    for bench, folder, set_ in SETS:
        base = EXP / folder
        ev = _evaluator(folder)
        datasets = json.loads((base / "datasets.json").read_text(encoding="utf-8"))
        questions = {q["id"]: q for q in json.loads((base / f"questions{set_}.json").read_text(encoding="utf-8"))}
        expected = json.loads((base / f"expected{set_}.json").read_text(encoding="utf-8"))
        answers = json.loads((base / "results" / f"answers{set_}_A.json").read_text(encoding="utf-8"))
        for qid, a in answers.items():
            ds_meta = datasets[questions[qid]["dataset"]]
            raw = (base / "datasets" / ds_meta["file"]).read_bytes()
            yield {"bench": bench, "set": "holdout" if set_ else "main", "id": qid, "ev": ev, "question": questions[qid]["question"],
                   "file": ds_meta["file"], "csv": raw.decode("utf-8-sig").strip(),
                   "dataset": load_csv_bytes(raw, dataset_id="bench", units=ds_meta["units"]),
                   "expected": expected[qid], "answer": a["answer"]}


def grade(it, answer: str) -> bool:
    return it["ev"].is_correct(it["expected"], it["ev"].final_value(answer))[0]


def run_condition(it, cond: str, offline: bool) -> list[dict]:
    """Returns the per-round trail for condition R or S (round 0 = original A answer)."""
    user = {"role": "user", "content": f"파일: {it['file']}\nCSV:\n{it['csv']}\n\n질문: {it['question']}"}
    convo, answer = [user], it["answer"]
    trail = []
    for rnd in range(ROUNDS + 1):
        result = verify_answer(it["dataset"], answer)
        decision = decide(result["summary"])
        step = {"round": rnd, "answer": answer, "decision": decision, "correct": grade(it, answer)}
        trail.append(step)
        if rnd == ROUNDS or not needs_fix(it["ev"], answer, decision):
            break
        feedback = RECHECK if cond == "R" else statguard_feedback(result)
        convo = convo + [{"role": "assistant", "content": answer}, {"role": "user", "content": feedback}]
        response = respond({"instructions": INSTRUCTIONS, "input": convo, "max_output_tokens": 2500},
                           f"{cond}:{it['bench']}{'' if it['set'] == 'main' else '_holdout'}:{it['id']}:{rnd + 1}", offline)
        if response is None:
            step["pending"] = True
            break
        step["feedback"] = feedback
        answer = output_text(response)
    return trail


def cmd_run(limit: int | None, only: list[str] | None, offline: bool = False) -> dict:
    out = {}
    n = 0
    for it in items():
        key = f"{it['bench']}{'' if it['set'] == 'main' else '_holdout'}:{it['id']}"
        if only and it["id"] not in only and key not in only:
            continue
        if limit is not None and n >= limit:
            break
        n += 1
        out[key] = {"bench": it["bench"], "set": it["set"], "id": it["id"],
                    "R": run_condition(it, "R", offline), "S": run_condition(it, "S", offline)}
        if not offline:
            r, s = out[key]["R"], out[key]["S"]
            print(key, "| A", "O" if r[0]["correct"] else "X", r[0]["decision"],
                  "| R", "".join("O" if t["correct"] else "X" for t in r), "| S", "".join("O" if t["correct"] else "X" for t in s), flush=True)
    return out


def at_round(trail: list[dict], rnd: int) -> dict:
    return trail[min(rnd, len(trail) - 1)]


def cmd_report():
    data = cmd_run(None, None, offline=True)
    pending = [k for k, v in data.items() if any(t.get("pending") for t in v["R"] + v["S"])]
    groups = {"전체": list(data.values())}
    for b in ("v0.1", "v0.2", "v0.3"):
        groups[b] = [v for v in data.values() if v["bench"] == b]
    groups["본 세트"] = [v for v in data.values() if v["set"] == "main"]
    groups["별도 검증 세트"] = [v for v in data.values() if v["set"] == "holdout"]
    summary = {"meta": {"questions": len(data), "pending": len(pending), "rounds": ROUNDS, "verifier": "rule v0.7 (frozen)",
                        "model": MODEL}, "groups": {}, "per_question": {}}
    for name, rows in groups.items():
        g = {"n": len(rows), "A": sum(at_round(v["S"], 0)["correct"] for v in rows),
             "targeted": sum(len(v["S"]) > 1 for v in rows)}
        for cond in ("R", "S"):
            for rnd in (1, 2):
                after = [at_round(v[cond], rnd) for v in rows]
                before = [at_round(v[cond], 0) for v in rows]
                g[f"{cond}{rnd}"] = {"correct": sum(t["correct"] for t in after),
                                     "fixed": sum((not b["correct"]) and a["correct"] for b, a in zip(before, after)),
                                     "broken": sum(b["correct"] and not a["correct"] for b, a in zip(before, after)),
                                     "decisions": dict(Counter(t["decision"] for t in after)),
                                     "passed_wrong": sum(t["decision"] == "PASS" and not t["correct"] for t in after)}
        # by what StatGuard said about the original answer
        for d in ("FLAG", "HOLD"):
            sub = [v for v in rows if len(v["S"]) > 1 and v["S"][0]["decision"] == d]
            g[f"targeted_{d}"] = {"n": len(sub), "A": sum(v["S"][0]["correct"] for v in sub),
                                  "R1": sum(at_round(v["R"], 1)["correct"] for v in sub), "S1": sum(at_round(v["S"], 1)["correct"] for v in sub)}
        summary["groups"][name] = g
    for k, v in data.items():
        summary["per_question"][k] = {c: [{"round": t["round"], "decision": t["decision"], "correct": t["correct"]} for t in v[c]] for c in ("R", "S")}
    usage = [json.loads(l) for l in USAGE.open(encoding="utf-8")] if USAGE.exists() else []
    tin = sum(u.get("input_tokens") or 0 for u in usage); tout = sum(u.get("output_tokens") or 0 for u in usage)
    summary["usage"] = {"calls": len(usage), "input_tokens": tin, "output_tokens": tout, "estimated_usd": round(tin * PRICE_IN + tout * PRICE_OUT, 4)}
    (HERE / "results" / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(summary, data)
    print(json.dumps({k: summary["groups"]["전체"][k] for k in ("n", "A", "targeted", "R1", "S1", "R2", "S2")}, ensure_ascii=False))
    print("pending", len(pending), "usage", summary["usage"])


def write_report(summary: dict, data: dict):
    g = summary["groups"]
    pct = lambda a, n: f"{a}/{n} ({a / n * 100:.1f}%)" if n else "-"
    lines = ["# StatGuard 자동 교정 실험 결과 v0.1", "",
             f"모델 {summary['meta']['model']}, 검증기 {summary['meta']['verifier']}, 최대 {summary['meta']['rounds']}라운드. 조건은 PROTOCOL.md(실행 전 고정).", "",
             "## 정답률 (조건 A 답변에서 출발)", "",
             "| 묶음 | 문항 | A 원래 | R 단순 재확인 1R | S StatGuard 근거 1R | R 2R | S 2R | 교정 대상 |", "|---|---|---|---|---|---|---|---|"]
    for name, x in g.items():
        lines.append(f"| {name} | {x['n']} | {pct(x['A'], x['n'])} | {pct(x['R1']['correct'], x['n'])} | {pct(x['S1']['correct'], x['n'])} | "
                     f"{pct(x['R2']['correct'], x['n'])} | {pct(x['S2']['correct'], x['n'])} | {x['targeted']} |")
    t = g["전체"]
    lines += ["", "## 고침·망침 (전체, 1라운드 / 2라운드)", "",
              "| 조건 | 오답→정답 | 정답→오답 | 통과(PASS) 답변 중 오답 |", "|---|---|---|---|"]
    for c in ("R", "S"):
        lines.append(f"| {'R 단순 재확인' if c == 'R' else 'S StatGuard 근거'} | {t[c + '1']['fixed']} / {t[c + '2']['fixed']} | {t[c + '1']['broken']} / {t[c + '2']['broken']} | {t[c + '1']['passed_wrong']} / {t[c + '2']['passed_wrong']} |")
    lines += ["", "## 원래 답변에 대한 StatGuard 판정별 (전체, 1라운드 정답 수)", "", "| 원래 판정 | 대상 | A | R | S |", "|---|---|---|---|---|"]
    for d in ("FLAG", "HOLD"):
        x = t[f"targeted_{d}"]
        lines.append(f"| {d} | {x['n']} | {x['A']} | {x['R1']} | {x['S1']} |")
    u = summary["usage"]
    lines += ["", f"비용: 호출 {u['calls']}회, 입력 {u['input_tokens']:,} / 출력 {u['output_tokens']:,} 토큰, 추정 ${u['estimated_usd']} (사전 고정 단가, 청구액 아님).",
              "", "## 문항별 (A → R1·R2 / S1·S2, O 정답 X 오답, 괄호는 StatGuard 판정)", "", "| 문항 | R | S |", "|---|---|---|"]
    fmt = lambda tr: " → ".join(("O" if s["correct"] else "X") + f"({s['decision']})" for s in tr)
    for k, v in data.items():
        if len(v["S"]) > 1 or len(v["R"]) > 1:
            lines.append(f"| {k} | {fmt(v['R'])} | {fmt(v['S'])} |")
    (HERE / "results" / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["run", "report", "plan"])
    p.add_argument("--limit", type=int)
    p.add_argument("--only", nargs="*")
    a = p.parse_args()
    if a.cmd == "run":
        cmd_run(a.limit, a.only)
    elif a.cmd == "plan":
        c = Counter()
        for it in items():
            d = decide(verify_answer(it["dataset"], it["answer"])["summary"])
            c[(it["bench"], d, needs_fix(it["ev"], it["answer"], d), grade(it, it["answer"]))] += 1
        print(json.dumps({f"{b} {d} {'교정대상' if t else '유지'} {'정답' if ok else '오답'}": n for (b, d, t, ok), n in sorted(c.items())}, ensure_ascii=False, indent=0))
        print("targets", sum(n for k, n in c.items() if k[2]), "of", sum(c.values()))
    else:
        cmd_report()

"""Big open-model judge (PROTOCOL 8장): qwen2.5:32b grades each answer as 맞음/틀림/판단불가. Runs on the GPU server.

python3 -X utf8 -I experiments/statguard_benchmark_v0.4_local/judge_local.py pilot   # 3 answers
python3 -X utf8 -I experiments/statguard_benchmark_v0.4_local/judge_local.py run     # all (judge_inputs.json + llama answers)
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import platform
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
JUDGE = "qwen2.5:32b"
OPTIONS = {"num_ctx": 32768, "temperature": 0, "seed": 7, "num_predict": 512}
INSTRUCTIONS = ("당신은 표 데이터 분석 답변을 검토하는 검증자입니다. CSV 자료, 질문, 다른 AI의 답변이 주어집니다. "
                "CSV를 직접 확인해 답변의 최종값이 맞는지 판정하세요. 답변이 ‘판단불가’라고 했다면 그 판단이 맞는지 판정하세요. "
                "최종값이 맞으면 ‘맞음’, 틀리면 ‘틀림’, 자료로 확인할 수 없으면 ‘판단불가’를 고르고, 이유를 한두 문장으로 적으세요.")
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["verdict", "reason"],
          "properties": {"verdict": {"type": "string", "enum": ["맞음", "틀림", "판단불가"]}, "reason": {"type": "string"}}}
# 변경 기록(PROTOCOL 8장, 2026-11-25): 1,460행 표(07_미국4개도시) 입력은 약 4만 토큰으로 심판의 학습 길이(32,768)를 넘어 Ollama가 HTTP 500을 낸다.
# 이런 입력(CSV·질문·답변 합계 30,000자 초과, 실제로는 07 표 63개만 해당: 최소 38,995자, 나머지 최대 12,327자)은 보내지 않고 HOLD(심판 불가)로 기록한다.
MAX_CHARS = 30000
CACHE = HERE / "results" / "judge_cache"
OUT = HERE / "results" / "judge_results.jsonl"


def inputs() -> list[dict]:
    rows = json.loads((HERE / "judge_inputs.json").read_text(encoding="utf-8"))
    spec = importlib.util.spec_from_file_location("run_local", HERE / "run_local.py")
    rl = importlib.util.module_from_spec(spec); argv = sys.argv; sys.argv = [argv[0]]
    try:
        spec.loader.exec_module(rl)
    finally:
        sys.argv = argv
    for it in rl.items():  # llama3.1:8b answers made on this server
        a = rl.answer("llama3.1:8b", it, offline=True)
        if a is not None:
            rows.append({"key": f"v04|llama3.1:8b|{it['id']}", "file": it["file"], "csv": it["csv"], "question": it["question"], "answer": a})
    return rows


def judge(row: dict) -> dict:
    if sum(len(row[k]) for k in ("file", "csv", "question", "answer")) > MAX_CHARS:
        return {"key": row["key"], "verdict": None, "decision": "HOLD", "prompt_tokens": None, "seconds": None,
                "machine": platform.node(), "judge": JUDGE, "skipped": "input_exceeds_judge_context"}
    content = f"파일: {row['file']}\nCSV:\n{row['csv']}\n\n질문: {row['question']}\n\n검토할 답변:\n{row['answer']}"
    body = {"model": JUDGE, "messages": [{"role": "system", "content": INSTRUCTIONS}, {"role": "user", "content": content}],
            "stream": False, "format": SCHEMA, "options": OPTIONS}
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    if path.exists():
        response = json.loads(path.read_text(encoding="utf-8"))
        seconds = None
    else:
        started = time.monotonic()
        request = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        response = json.load(urllib.request.urlopen(request, timeout=1800))
        seconds = round(time.monotonic() - started, 2)
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")
    try:
        verdict = json.loads((response.get("message") or {}).get("content", ""))["verdict"]
        decision = {"맞음": "PASS", "틀림": "FLAG", "판단불가": "HOLD"}[verdict]
    except Exception:
        verdict, decision = None, "HOLD"
    return {"key": row["key"], "verdict": verdict, "decision": decision, "prompt_tokens": response.get("prompt_eval_count"),
            "seconds": seconds, "machine": platform.node(), "judge": JUDGE}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    rows = inputs()
    if cmd == "pilot":
        rows = rows[:1] + rows[len(rows) // 2:len(rows) // 2 + 1] + rows[-1:]
    done = set()
    if OUT.exists() and cmd == "run":
        done = {json.loads(l)["key"] for l in OUT.open(encoding="utf-8")}
    t0 = time.monotonic()
    for n, row in enumerate(rows, 1):
        if row["key"] in done:
            continue
        try:
            r = judge(row)
        except Exception as e:  # 다른 서버 오류는 기록하지 않고 넘어감 → 같은 명령을 다시 실행하면 그 문항만 다시 시도
            print(f"error {row['key']}: {type(e).__name__} {str(e)[:120]}", file=sys.stderr, flush=True)
            continue
        if cmd == "run":
            with OUT.open("a", encoding="utf-8") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        else:
            print(r)
        if n % 25 == 0 or n == len(rows):
            print(f"judge {n}/{len(rows)} {time.monotonic() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()

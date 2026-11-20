"""StatGuard-KR benchmark runner (PROTOCOL.md). Stdlib HTTP only; responses cached; key never logged.

python run_experiment.py answers A [--limit N]   # baseline answers (A, B, C)
python run_experiment.py extract-llm A           # LLM claim extractor on condition answers
python run_experiment.py perturb                 # injected-error set (rule + LLM extractor)
python run_experiment.py usage                   # token/cost summary
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "src"))
from when2warn.statguard.core import CalculationSpec, StatGuardError, decimal_text, execute, load_csv_bytes  # noqa: E402
from when2warn.statguard.llm_extractor import verify_answer_llm  # noqa: E402

MODEL = "gpt-6-luna"
MAX_CALLS = 700  # raised for repeat runs (PROTOCOL v0.3 B)
REPEAT = int(os.environ.get("STATGUARD_REPEAT", "1"))
RUN = "" if REPEAT == 1 else f"_r{REPEAT}"
PRICE_IN, PRICE_OUT = 0.10 / 1e6, 0.50 / 1e6
CACHE = HERE / "results" / "cache"
USAGE = HERE / "results" / "usage.jsonl"
ANSWER_RULE = "한국어 2~4문장으로 답하고, 마지막 줄에 반드시 '최종값: <숫자> <단위>' 형식으로 적으세요. 제공된 자료만으로 답할 수 없거나 원인·유의성처럼 이 자료의 계산으로 판단할 수 없는 질문이면 마지막 줄에 '최종값: 판단불가'라고 적으세요."
TOOL = {"type": "function", "name": "calculate", "strict": True,
        "description": "CSV에서 통계를 정확히 계산한다. filters는 선택 범위, reference_filters는 증감률의 기준 시점·비율의 분모 범위·t-검정의 둘째 집단. stdev/variance는 표본(n-1)과 모집단 값을 함께, t_test는 Welch 양측 t·p를 돌려준다. correlation은 column과 column2의 피어슨 상관계수.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["operation", "column", "column2", "filters", "reference_filters"], "properties": {
            "operation": {"type": "string", "enum": ["sum", "mean", "percent_change", "ratio_percent", "stdev", "variance", "median", "max", "min", "correlation", "t_test"]},
            "column": {"type": "string"},
            "column2": {"type": ["string", "null"]},
            "filters": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["column", "value"], "properties": {"column": {"type": "string"}, "value": {"type": "string"}}}},
            "reference_filters": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["column", "value"], "properties": {"column": {"type": "string"}, "value": {"type": "string"}}}}}}}


def api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        env = ROOT / ".env.retrieval-live.private"
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        raise SystemExit("OPENAI_API_KEY not configured")
    return key


def calls_so_far() -> int:
    return sum(1 for _ in USAGE.open(encoding="utf-8")) if USAGE.exists() else 0


def respond(body: dict, tag: str) -> dict:
    """POST /v1/responses with a content-addressed cache and a hard call cap."""
    body = {"model": MODEL, "store": False, **body}
    # Repeat runs (STATGUARD_REPEAT=2,3…) use a different cache key so the model is really called again;
    # the request body sent to the API is identical to run 1.
    key = dict(body, _repeat=REPEAT) if REPEAT > 1 else body
    digest = hashlib.sha256(json.dumps(key, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    path = CACHE / f"{digest}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
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


SET = ""  # "" = main set, "_holdout" = hold-out set


def load():
    datasets = json.loads((HERE / "datasets.json").read_text(encoding="utf-8"))
    questions = json.loads((HERE / f"questions{SET}.json").read_text(encoding="utf-8"))
    return datasets, questions


def csv_text(ds) -> str:
    return (HERE / "datasets" / ds["file"]).read_bytes().decode("utf-8-sig").strip()


def dataset_obj(ds):
    return load_csv_bytes((HERE / "datasets" / ds["file"]).read_bytes(), dataset_id="bench", units=ds["units"])


def run_tool(ds, args: dict) -> str:
    pairs = lambda xs: {p["column"]: p["value"] for p in xs}
    try:
        mapping = {"operation": args["operation"], "column": args["column"], "filters": pairs(args["filters"]),
                   "reference_filters": pairs(args["reference_filters"]) if args["operation"] in ("percent_change", "ratio_percent", "t_test") else None}
        if args["operation"] == "correlation":
            mapping["column2"] = args.get("column2")
        result = execute(dataset_obj(ds), CalculationSpec.from_mapping(mapping))
        return json.dumps({"value": decimal_text(result.value), "unit": result.unit, "expression": result.expression,
                           "used_row_count": len(result.usage.used_rows), "extra": result.extra}, ensure_ascii=False)
    except (StatGuardError, KeyError, TypeError) as error:
        return json.dumps({"error": getattr(error, "code", "INVALID_ARGUMENTS")})


def answer(condition: str, q: dict, ds: dict) -> dict:
    context = f"파일: {ds['file']}\nCSV:\n{csv_text(ds)}"
    if condition in ("B", "C"):
        context += f"\n\n자료 설명: {ds['description']}\n열 단위: {json.dumps(ds['units'], ensure_ascii=False)}"
    instructions = "당신은 표 데이터 분석 도우미입니다. " + ANSWER_RULE
    if condition == "C":
        instructions += " 수치는 반드시 calculate 도구로 계산한 값을 사용하세요."
    items = [{"role": "user", "content": f"{context}\n\n질문: {q['question']}"}]
    body = {"instructions": instructions, "input": items, "max_output_tokens": 2500}
    tool_log = []
    if condition == "C":
        body["tools"] = [TOOL]
    for step in range(5):
        response = respond(dict(body, input=list(items)), f"{condition}:{q['id']}:{step}")
        calls = [o for o in response.get("output", []) if o.get("type") == "function_call"]
        if condition != "C" or not calls or step == 4:
            break
        for item in response["output"]:
            items.append(item)
        for c in calls:
            out = run_tool(ds, json.loads(c["arguments"]))
            tool_log.append({"arguments": json.loads(c["arguments"]), "output": json.loads(out)})
            items.append({"type": "function_call_output", "call_id": c["call_id"], "output": out})
    return {"id": q["id"], "condition": condition, "answer": output_text(response), "tool_calls": tool_log, "status": response.get("status")}


def cmd_answers(condition: str, limit: int | None, only: list[str] | None):
    datasets, questions = load()
    out_path = HERE / "results" / f"answers{SET}_{condition}{RUN}.json"
    done = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    selected = [q for q in questions if not only or q["id"] in only][:limit]
    for q in selected:
        done[q["id"]] = answer(condition, q, datasets[q["dataset"]])
        out_path.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
        print(q["id"], "|", done[q["id"]]["answer"].splitlines()[-1] if done[q["id"]]["answer"] else "(빈 응답)")


def llm_call(tag):
    def call(instructions, input_text, schema):
        body = {"instructions": instructions, "input": input_text, "max_output_tokens": 3000,
                "text": {"format": {"type": "json_schema", "name": "claims", "strict": True, "schema": schema}}}
        return json.loads(output_text(respond(body, tag)) or '{"claims": []}')
    return call


def cmd_extract_llm(condition: str, only: list[str] | None):
    datasets, questions = load()
    answers = json.loads((HERE / "results" / f"answers{SET}_{condition}.json").read_text(encoding="utf-8"))
    out_path = HERE / "results" / f"statguard_llm{SET}_{condition}.json"
    out = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    for q in questions:
        if q["id"] not in answers or (only and q["id"] not in only):
            continue
        ds = dataset_obj(datasets[q["dataset"]])
        out[q["id"]] = verify_answer_llm(ds, answers[q["id"]]["answer"], llm_call(f"extract:{condition}:{q['id']}"))
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(q["id"], out[q["id"]]["summary"])


_TEMPLATES = [(r"몇 %p 하락했나요\?$", "{v}%p 하락했습니다."), (r"몇 % 증가했나요\?$", "{v}% 증가했습니다."), (r"몇 % 변했나요\?$", "{v}% 변했습니다."),
              (r"몇 (\S+?)인가요\?$", "{v}{u}입니다."), (r"얼마인가요\?$", "{v}{u}입니다.")]


def statement(q: dict, value: str, unit: str) -> str | None:
    for pattern, template in _TEMPLATES:
        if re.search(pattern, q["question"]):
            return re.sub(pattern, template.format(v=value, u=unit), q["question"])
    return None


def cmd_perturb(use_llm: bool):
    from decimal import Decimal
    from fractions import Fraction
    sys.path.insert(0, str(HERE))
    from build_expected import compute, rows  # independent recomputation for the swap error
    datasets, questions = load()
    expected = json.loads((HERE / "expected.json").read_text(encoding="utf-8"))
    from when2warn.statguard.claims import verify_answer
    items = []
    for q in questions:
        e = expected[q["id"]]
        if not (e["answerable"] and e["statguard_supported"]):
            continue
        true = Decimal(e["value"])
        shown = lambda d: format(d.quantize(Decimal("0.0001")) if abs(d) < 0.1 else d.quantize(Decimal("0.01")) if abs(d) < 1000 else d.quantize(Decimal("1")), "f")
        variants = [("correct", shown(true)), ("scaled_10pct", shown(true * Decimal("1.1") if true else Decimal("0.5")))]
        if q["calc"]["op"] == "percent_change":
            swapped = compute(rows(datasets[q["dataset"]]), dict(q["calc"], filters=q["calc"]["reference"], reference=q["calc"]["filters"]))
            variants.append(("swapped_base", shown(swapped if isinstance(swapped, Decimal) else Decimal(swapped.numerator) / Decimal(swapped.denominator))))
        for kind, value in variants:
            text = statement(q, value, e["unit"])
            if text:
                items.append({"id": q["id"], "kind": kind, "label": "correct" if kind == "correct" else "error", "text": text})
    results = []
    for it in items:
        q = next(q for q in questions if q["id"] == it["id"])
        ds = dataset_obj(datasets[q["dataset"]])
        rule = verify_answer(ds, it["text"])
        row = dict(it, rule=rule["summary"], rule_claims=[(c["status"], c["reason_code"]) for c in rule["claims"]])
        if use_llm:
            llm = verify_answer_llm(ds, it["text"], llm_call(f"perturb:{it['id']}:{it['kind']}"))
            row.update(llm=llm["summary"], llm_claims=[(c["status"], c["reason_code"]) for c in llm["claims"]])
        results.append(row)
        print(it["id"], it["kind"], it["text"], "| rule:", row["rule_claims"], "| llm:", row.get("llm_claims"))
    (HERE / "results" / "perturbation.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


def cmd_usage():
    rows = [json.loads(l) for l in USAGE.open(encoding="utf-8")] if USAGE.exists() else []
    tin = sum(r.get("input_tokens") or 0 for r in rows)
    tout = sum(r.get("output_tokens") or 0 for r in rows)
    print(f"calls={len(rows)} input_tokens={tin} output_tokens={tout} est_cost=${tin * PRICE_IN + tout * PRICE_OUT:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["answers", "extract-llm", "perturb", "usage"])
    parser.add_argument("condition", nargs="?", default="A")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--set", choices=["main", "holdout"], default="main")
    args = parser.parse_args()
    SET = "_holdout" if args.set == "holdout" else ""
    if args.command == "answers":
        cmd_answers(args.condition, args.limit, args.only)
    elif args.command == "extract-llm":
        cmd_extract_llm(args.condition, args.only)
    elif args.command == "perturb":
        cmd_perturb(not args.no_llm)
    else:
        cmd_usage()

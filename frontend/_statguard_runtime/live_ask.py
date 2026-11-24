"""DEMO ONLY: ask an LLM about a CSV, so its answer can be verified on screen.

Used by the local launcher with `--live`, and by the password-protected public demo
endpoint (frontend/api/statguard_ask.py, byte-identical copy in _statguard_runtime).
The verification itself never calls an LLM.
stdin: {"csv_base64", "encoding", "question"[, "mode"][, "previous_answer", "feedback"]}  stdout: {"ok", "answer", "model", "usage"} or {"ok": false, "error": {"code"}}
The API key comes only from the OPENAI_API_KEY environment variable of this child process.
Same prompt as benchmark condition A (CSV + question, no tools), so the demo shows the
unaided model answer that StatGuard then checks.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import sys
import urllib.error
import urllib.request

MODEL = "gpt-6-luna"
MAX_QUESTION_CHARS = 500
MAX_CSV_BYTES = 200_000
MAX_PREVIOUS_ANSWER_CHARS = 6000
MAX_FEEDBACK_CHARS = 4000
INSTRUCTIONS = ("당신은 표 데이터 분석 도우미입니다. 한국어 2~4문장으로 답하고, 마지막 줄에 반드시 '최종값: <숫자> <단위>' 형식으로 적으세요. "
                "제공된 자료만으로 답할 수 없거나 원인·유의성처럼 이 자료의 계산으로 판단할 수 없는 질문이면 마지막 줄에 '최종값: 판단불가'라고 적으세요.")
# "report" mode: the model writes a short analysis report (several numbers) that StatGuard then checks number by number.
REPORT_INSTRUCTIONS = ("당신은 데이터 분석가입니다. 제공된 CSV만 근거로 한국어 분석 보고서를 2~3개 문단으로 작성하세요. "
                       "핵심 수치 4~6개를 포함하고, 각 수치가 어떤 열·기간·계산(합계·평균·증감률·최댓값 등)인지 문장에 밝히세요. "
                       "수치에는 반드시 단위를 붙이고, 마크다운 강조(**) 같은 서식은 쓰지 마세요. 자료로 알 수 없는 원인은 단정하지 마세요.")
MODES = ("answer", "report")


def _error(code: str) -> dict:
    return {"ok": False, "error": {"code": code}}


def build_request(csv_text: str, question: str, filename: str = "upload.csv", previous_answer: str | None = None,
                  feedback: str | None = None, mode: str = "answer") -> dict:
    """A correction request continues the same conversation: question → the model's previous answer → StatGuard's evidence."""
    turns = [{"role": "user", "content": f"파일: {filename}\nCSV:\n{csv_text.strip()}\n\n질문: {question.strip()}"}]
    if previous_answer is not None:
        turns += [{"role": "assistant", "content": previous_answer.strip()}, {"role": "user", "content": feedback.strip()}]
    instructions = REPORT_INSTRUCTIONS if mode == "report" else INSTRUCTIONS
    return {"model": MODEL, "store": False, "instructions": instructions, "max_output_tokens": 2500, "input": turns}


def output_text(response: dict) -> str:
    return "".join(c.get("text", "") for item in response.get("output", []) if item.get("type") == "message"
                   for c in item.get("content", []) if c.get("type") == "output_text").strip()


def ask(payload: object, post=None, timeout: float = 90) -> dict:
    base = {"csv_base64", "encoding", "question"}
    if not isinstance(payload, dict) or set(payload) - {"mode"} not in (base, base | {"previous_answer", "feedback"}):
        return _error("INVALID_REQUEST")
    mode = payload.get("mode", "answer")
    if mode not in MODES:
        return _error("INVALID_REQUEST")
    correcting = "feedback" in payload
    if correcting:
        if not all(isinstance(payload[k], str) and payload[k].strip() for k in ("previous_answer", "feedback")):
            return _error("INVALID_REQUEST")
        if len(payload["previous_answer"]) > MAX_PREVIOUS_ANSWER_CHARS or len(payload["feedback"]) > MAX_FEEDBACK_CHARS:
            return _error("CORRECTION_TOO_LONG")
    question = payload["question"]
    if not isinstance(question, str) or not question.strip():
        return _error("QUESTION_REQUIRED")
    if len(question) > MAX_QUESTION_CHARS:
        return _error("QUESTION_TOO_LONG")
    if payload["encoding"] not in ("utf-8-sig", "cp949"):
        return _error("UNSUPPORTED_ENCODING")
    try:
        data = base64.b64decode(payload["csv_base64"], validate=True)
    except (ValueError, binascii.Error, TypeError):
        return _error("INVALID_CSV_BASE64")
    if len(data) > MAX_CSV_BYTES:
        return _error("CSV_TOO_LARGE_FOR_LIVE_ASK")
    try:
        csv_text = data.decode(payload["encoding"])
    except UnicodeDecodeError:
        return _error("CSV_DECODE_FAILED")
    body = build_request(csv_text, question, previous_answer=payload.get("previous_answer"), feedback=payload.get("feedback"), mode=mode)
    if post is None:
        key = os.environ.get("OPENAI_API_KEY", "")
        if not key:
            return _error("LIVE_ASK_NOT_CONFIGURED")

        def post(request_body):
            req = urllib.request.Request("https://api.openai.com/v1/responses", data=json.dumps(request_body).encode(),
                                         headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
            return json.load(urllib.request.urlopen(req, timeout=timeout))
    try:
        response = post(body)
    except urllib.error.HTTPError as error:
        return _error(f"PROVIDER_HTTP_{error.code}")
    except Exception:
        return _error("PROVIDER_UNAVAILABLE")
    answer = output_text(response)
    if not answer:
        return _error("EMPTY_ANSWER")
    usage = response.get("usage") or {}
    return {"ok": True, "answer": answer[:6000], "model": response.get("model", MODEL),
            "usage": {"input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens")}}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        raw = sys.stdin.buffer.read(400_001)
        result = _error("REQUEST_TOO_LARGE") if len(raw) > 400_000 else ask(json.loads(raw.decode("utf-8")))
    except Exception:
        result = _error("INVALID_REQUEST")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

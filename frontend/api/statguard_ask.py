"""Password-protected public demo: ask the model about the uploaded CSV; the page then verifies the answer.

Enabled only when both OPENAI_API_KEY and STATGUARD_DEMO_PASSWORD are set in the Vercel project
(removing either variable turns the feature off). The verification itself never calls an LLM.
Limits: same-origin requests only, constant-time password check, a per-instance question cap,
a per-instance lockout after repeated wrong passwords, one question at a time per instance,
question <= 500 characters and CSV <= 200 KB. No request-body logging and no storage.
A hard spending cap belongs in the OpenAI project's usage limits; per-instance counters are not global.
"""
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import hmac
import json
import os
import re
import sys
import time
from threading import BoundedSemaphore, Lock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _statguard_runtime.live_ask import MODEL, ask

MAX_REQUEST_BYTES = 300_000
MAX_QUESTIONS_PER_INSTANCE = 20
MAX_WRONG_PASSWORDS_PER_INSTANCE = 10
PROVIDER_TIMEOUT_SECONDS = 50
_HOST = re.compile(r"when2warn-public-beta(?:-[a-z0-9-]+)?\.vercel\.app\Z")
_active = BoundedSemaphore(1)
_lock = Lock()
_state = {"asked": 0, "wrong": 0}


def error(code):
    return {"ok": False, "error": {"code": code}}


def configured():
    return bool(os.environ.get("OPENAI_API_KEY")) and bool(os.environ.get("STATGUARD_DEMO_PASSWORD"))


def status():
    remaining = max(0, MAX_QUESTIONS_PER_INSTANCE - _state["asked"])
    return {"ok": True, "enabled": configured(), "requires_password": True, "model": MODEL, "remaining": remaining}


def validate_headers(headers):
    host = headers.get("Host", "").lower()
    if not _HOST.fullmatch(host) or headers.get("Origin") != "https://" + host:
        return 403, error("CLOUD_ORIGIN_REQUIRED")
    if headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
        return 403, error("CLOUD_ORIGIN_REQUIRED")
    if headers.get("X-StatGuard-Client") != "cloud-v0.1":
        return 403, error("CLOUD_CLIENT_REQUIRED")
    if headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
        return 415, error("JSON_REQUIRED")
    lengths = headers.get_all("Content-Length", [])
    if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,8}", lengths[0]):
        return 400, error("INVALID_CONTENT_LENGTH")
    length = int(lengths[0])
    if length > MAX_REQUEST_BYTES:
        return 413, error("REQUEST_TOO_LARGE")
    if length == 0:
        return 400, error("INVALID_REQUEST")
    return None


def process_body(raw, post=None):
    """Returns (status, response). `post` is injectable for tests; production uses the real provider call."""
    if not configured():
        return 503, error("LIVE_ASK_DISABLED")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return 400, error("INVALID_REQUEST")
    if not isinstance(payload, dict) or set(payload) != {"csv_base64", "encoding", "question", "password"}:
        return 400, error("INVALID_REQUEST")
    password = payload.pop("password")
    with _lock:
        if _state["wrong"] >= MAX_WRONG_PASSWORDS_PER_INSTANCE:
            return 429, error("DEMO_LOCKED")
    expected = os.environ.get("STATGUARD_DEMO_PASSWORD", "")
    if not isinstance(password, str) or not hmac.compare_digest(password.encode("utf-8"), expected.encode("utf-8")):
        with _lock:
            _state["wrong"] += 1
        time.sleep(1)
        return 401, error("DEMO_PASSWORD_INVALID")
    with _lock:
        if _state["asked"] >= MAX_QUESTIONS_PER_INSTANCE:
            return 429, error("LIVE_ASK_LIMIT")
        _state["asked"] += 1
    result = ask(payload, post=post, timeout=PROVIDER_TIMEOUT_SECONDS)
    if not result.get("ok"):
        code = result.get("error", {}).get("code", "")
        if code in ("QUESTION_REQUIRED", "QUESTION_TOO_LONG", "UNSUPPORTED_ENCODING", "INVALID_CSV_BASE64",
                    "CSV_TOO_LARGE_FOR_LIVE_ASK", "CSV_DECODE_FAILED", "INVALID_REQUEST"):
            with _lock:
                _state["asked"] -= 1  # rejected before any provider call
            return 400, result
        return 502, result
    return 200, {**result, "remaining": max(0, MAX_QUESTIONS_PER_INSTANCE - _state["asked"])}


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        # Never print submitted data, passwords, exceptions or request headers.
        return

    def _send(self, status_code, response):
        body = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self._send(200, status())

    def do_POST(self):
        rejection = validate_headers(self.headers)
        if rejection:
            self._send(*rejection)
            return
        if not _active.acquire(blocking=False):
            self._send(429, error("LIVE_ASK_BUSY"))
            return
        try:
            length = int(self.headers["Content-Length"])
            raw = self.rfile.read(length)
            if len(raw) != length:
                self._send(400, error("INCOMPLETE_REQUEST"))
                return
            self._send(*process_body(raw))
        except Exception:
            self._send(500, error("LIVE_ASK_ERROR"))
        finally:
            _active.release()

    def do_OPTIONS(self):
        self._send(403, error("CLOUD_ORIGIN_REQUIRED"))

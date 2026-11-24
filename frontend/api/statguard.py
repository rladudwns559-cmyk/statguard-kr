"""Same-origin bounded HTTP transport for the unchanged StatGuard engine.

No provider, authentication data, database, request-body logging or file storage.
The generated runtime files are byte-identical to the canonical Python sources.
"""
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import json
import re
import sys
from threading import BoundedSemaphore

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _statguard_runtime.local_bridge import (BRIDGE_VERSION, MAX_REQUEST_BYTES,
    _unique_pairs, calculate_request)

MAX_RESPONSE_BYTES = 750_000
_active = BoundedSemaphore(2)
_HOST = re.compile(r"when2warn-public-beta(?:-[a-z0-9-]+)?\.vercel\.app\Z")


def error(code):
    return {"ok": False, "bridge_version": BRIDGE_VERSION, "error": {"code": code}}


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


def process_body(raw):
    if len(raw) > MAX_REQUEST_BYTES:
        return 413, error("REQUEST_TOO_LARGE")
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(payload, dict) or payload.get("mode") not in ("calculate", "compare", "verify_answer", "check_arithmetic"):
            return 400, error("INVALID_REQUEST")
        response = calculate_request(payload)
        # The bridge also exposes a read-only capabilities response, but POST
        # only accepts calculation/comparison modes on this public transport.
        if not isinstance(payload, dict) or payload.get("mode") not in ("calculate", "compare", "verify_answer", "check_arithmetic"):
            return 400, error("INVALID_REQUEST")
        if len(json.dumps(response, ensure_ascii=False).encode("utf-8")) > MAX_RESPONSE_BYTES:
            return 413, error("ENGINE_RESPONSE_LIMIT")
        return (200 if response.get("ok") else 422), response
    except Exception:
        return 400, error("INVALID_REQUEST")


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        # Never print paths, submitted data, exceptions or request headers.
        return

    def _send(self, status, response):
        body = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
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
        self._send(200, {**calculate_request({"mode": "capabilities"}),
            "transport": "SAME_ORIGIN_CLOUD", "max_request_bytes": MAX_REQUEST_BYTES})

    def do_POST(self):
        rejection = validate_headers(self.headers)
        if rejection:
            self._send(*rejection)
            return
        if not _active.acquire(blocking=False):
            self._send(429, error("ENGINE_BUSY"))
            return
        try:
            length = int(self.headers["Content-Length"])
            raw = self.rfile.read(length)
            if len(raw) != length:
                self._send(400, error("INCOMPLETE_REQUEST"))
                return
            self._send(*process_body(raw))
        except Exception:
            self._send(500, error("CLOUD_CALCULATION_ERROR"))
        finally:
            _active.release()

    def do_OPTIONS(self):
        # Cross-origin browser requests do not receive permissive CORS headers.
        self._send(403, error("CLOUD_ORIGIN_REQUIRED"))

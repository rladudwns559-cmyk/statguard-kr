"""Explicit opt-in synthetic connection check. No remote command execution."""
import os
from urllib.parse import urlsplit
import httpx


class When2WarnClient:
    def __init__(self, base_url, api_key, *, transport=None):
        url = urlsplit(base_url)
        if url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")):
            raise ValueError("HTTPS required except for loopback development")
        if url.username or url.password or url.query or url.fragment:
            raise ValueError("Base URL cannot contain credentials or query")
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=15,
            headers={"X-WHEN2WARN-API-Key": api_key}, follow_redirects=False, transport=transport)

    def _post(self, path, payload):
        try:
            result = self._client.post(path, json=payload)
        except httpx.HTTPError:
            raise RuntimeError("Agent API connection failed") from None
        if not result.is_success:
            # Never echo request headers or response bodies into caller logs.
            raise RuntimeError(f"Agent API rejected request (HTTP {result.status_code})")
        return result.json()

    def create_run(self, **values):
        return self._post("/api/v1/agent/runs", values)

    def send_event(self, run_id, event):
        from urllib.parse import quote
        return self._post("/api/v1/agent/runs/"+quote(run_id,safe="")+"/events", event)

    def request_decision(self, run_id, **values):
        from urllib.parse import quote
        return self._post("/api/v1/agent/runs/"+quote(run_id,safe="")+"/decisions", values)

    def close(self):
        self._client.close()


def run_demo(client):
    run = client.create_run(source_host="explicit-synthetic-quickstart", agent_id="quickstart",
                            metadata={"synthetic": True})
    rid = run["run_id"]
    client.send_event(rid, {"event_id":"call-1","event_index":0,"actor":"agent",
        "event_type":"action_requested","decision_group":1,"action_name":"read_demo",
        "arguments":{"item":"public-demo"}})
    client.send_event(rid, {"event_id":"result-1","event_index":1,"actor":"tool",
        "event_type":"action_result","decision_group":1,"action_name":"read_demo",
        "parent_event_id":"call-1","observation":'{"status":"success","message":"demo item read"}',
        "group_complete":True})
    return rid, client.request_decision(rid)


if __name__ == "__main__":
    import argparse
    parser=argparse.ArgumentParser(description="Creates one synthetic run only when explicitly requested.")
    parser.add_argument("--demo",action="store_true",help="Create one synthetic run in the key's project")
    if not parser.parse_args().demo:
        parser.error("--demo is required to create a run")
    from getpass import getpass
    key=os.environ.get("WHEN2WARN_API_KEY") or getpass("프로젝트 API 키 (입력은 표시되지 않습니다): ")
    client=When2WarnClient(os.environ.get("WHEN2WARN_BASE_URL", "https://when2warn-api.onrender.com"),key)
    key=""
    try:
        rid,decision=run_demo(client)
        print("✓ WHEN2WARN connected")
        print("✓ Run created:",rid)
        print("✓ Event received")
        print("Decision:",decision["decision"],"(recommendation only)")
        print("Dashboard에서 확인하기: https://when2warn-public-beta.vercel.app/runs/"+rid)
    finally:
        client.close()

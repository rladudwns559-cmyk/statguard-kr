"""Local live-demo ask module with a fake provider (no network, no key)."""
import base64
import unittest

from when2warn.statguard.live_ask import MODEL, ask, build_request

CSV = "지역,방문자수\nA,1000\n".encode()


def payload(**kw):
    return {"csv_base64": base64.b64encode(CSV).decode(), "encoding": "utf-8-sig", "question": "합계는?", **kw}


class LiveAsk(unittest.TestCase):
    def test_answer_text_and_usage_from_fake_provider(self):
        seen = {}
        def post(body):
            seen.update(body)
            return {"model": MODEL, "usage": {"input_tokens": 10, "output_tokens": 5},
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "합계는 1,000명입니다.\n최종값: 1000 명"}]}]}
        r = ask(payload(), post=post)
        self.assertTrue(r["ok"])
        self.assertIn("최종값", r["answer"])
        self.assertEqual((seen["model"], seen["store"]), (MODEL, False))
        self.assertIn("A,1000", seen["input"][0]["content"])

    def test_rejections_do_not_call_provider(self):
        def post(body):
            raise AssertionError("must not be called")
        for bad, code in ((payload(question=" "), "QUESTION_REQUIRED"), (payload(question="가" * 501), "QUESTION_TOO_LONG"),
                          (payload(encoding="latin-1"), "UNSUPPORTED_ENCODING"), (payload(csv_base64="%%%"), "INVALID_CSV_BASE64"),
                          (dict(payload(), extra=1), "INVALID_REQUEST")):
            self.assertEqual(ask(bad, post=post)["error"]["code"], code)

    def test_missing_key_is_reported(self):
        import os
        saved = os.environ.pop("OPENAI_API_KEY", None)
        try:
            self.assertEqual(ask(payload())["error"]["code"], "LIVE_ASK_NOT_CONFIGURED")
        finally:
            if saved is not None:
                os.environ["OPENAI_API_KEY"] = saved

    def test_prompt_matches_benchmark_condition_a(self):
        self.assertIn("최종값: 판단불가", build_request("a,b\n1,2", "질문")["instructions"])


if __name__ == "__main__":
    unittest.main()

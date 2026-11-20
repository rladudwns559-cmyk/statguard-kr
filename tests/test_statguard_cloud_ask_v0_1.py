"""Password-protected public demo endpoint (frontend/api/statguard_ask.py). No network: the provider call is injected."""
import base64
import importlib.util
import json
import os
import sys
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'frontend'))
spec = importlib.util.spec_from_file_location('statguard_cloud_ask', ROOT / 'frontend/api/statguard_ask.py')
cloud = importlib.util.module_from_spec(spec); spec.loader.exec_module(cloud)

CSV = base64.b64encode('지역,연도,방문자수\nA,2023,1000\nA,2024,1178\n'.encode('utf-8-sig')).decode()
ENV = {'OPENAI_API_KEY': 'test-only-not-a-real-key', 'STATGUARD_DEMO_PASSWORD': 'demo-pass-123'}


def body(**changes):
    values = {'csv_base64': CSV, 'encoding': 'utf-8-sig', 'question': 'A지역 증가율은?', 'password': 'demo-pass-123'}
    values.update(changes)
    return json.dumps({k: v for k, v in values.items() if v is not None}).encode()


def reply(_request):
    return {'model': 'gpt-6-luna', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '증가율은 17.8%입니다.\n최종값: 17.8 %'}]}],
            'usage': {'input_tokens': 10, 'output_tokens': 5}}


def headers(**changes):
    values = {'Host': 'when2warn-public-beta.vercel.app', 'Origin': 'https://when2warn-public-beta.vercel.app',
              'X-StatGuard-Client': 'cloud-v0.1', 'Content-Type': 'application/json', 'Content-Length': '100'}
    values.update(changes)
    result = Message()
    for k, v in values.items():
        if v is not None:
            result[k] = v
    return result


class CloudAsk(unittest.TestCase):
    def setUp(self):
        cloud._state.update(asked=0, wrong=0)

    def test_runtime_copy_is_byte_identical(self):
        self.assertEqual((ROOT / 'src/when2warn/statguard/live_ask.py').read_bytes(), (ROOT / 'frontend/_statguard_runtime/live_ask.py').read_bytes())

    def test_off_unless_both_key_and_password_are_configured(self):
        for env in ({}, {'OPENAI_API_KEY': 'x'}, {'STATGUARD_DEMO_PASSWORD': 'y'}):
            with patch.dict(os.environ, env, clear=True):
                self.assertFalse(cloud.status()['enabled'])
                self.assertEqual(cloud.process_body(body(), post=reply)[0], 503)
        with patch.dict(os.environ, ENV, clear=True):
            status = cloud.status()
            self.assertTrue(status['enabled']); self.assertTrue(status['requires_password'])
            self.assertNotIn('test-only', json.dumps(status)); self.assertNotIn('demo-pass', json.dumps(status))

    def test_correct_password_returns_the_model_answer(self):
        with patch.dict(os.environ, ENV, clear=True):
            code, result = cloud.process_body(body(), post=reply)
        self.assertEqual(code, 200); self.assertTrue(result['ok'])
        self.assertIn('17.8%', result['answer']); self.assertEqual(result['remaining'], cloud.MAX_QUESTIONS_PER_INSTANCE - 1)

    def test_wrong_or_missing_password_never_reaches_the_provider_and_locks_after_repeats(self):
        calls = []
        with patch.dict(os.environ, ENV, clear=True), patch.object(cloud.time, 'sleep'):
            self.assertEqual(cloud.process_body(body(password=None), post=lambda r: calls.append(r))[0], 400)
            for _ in range(cloud.MAX_WRONG_PASSWORDS_PER_INSTANCE):
                code, result = cloud.process_body(body(password='nope'), post=lambda r: calls.append(r))
                self.assertEqual(code, 401); self.assertEqual(result['error']['code'], 'DEMO_PASSWORD_INVALID')
            code, result = cloud.process_body(body(), post=reply)
        self.assertEqual(code, 429); self.assertEqual(result['error']['code'], 'DEMO_LOCKED'); self.assertEqual(calls, [])

    def test_per_instance_question_cap(self):
        with patch.dict(os.environ, ENV, clear=True):
            for _ in range(cloud.MAX_QUESTIONS_PER_INSTANCE):
                self.assertEqual(cloud.process_body(body(), post=reply)[0], 200)
            code, result = cloud.process_body(body(), post=reply)
        self.assertEqual(code, 429); self.assertEqual(result['error']['code'], 'LIVE_ASK_LIMIT')

    def test_invalid_input_does_not_use_up_a_question(self):
        with patch.dict(os.environ, ENV, clear=True):
            code, result = cloud.process_body(body(question=' '), post=reply)
        self.assertEqual(code, 400); self.assertEqual(result['error']['code'], 'QUESTION_REQUIRED'); self.assertEqual(cloud._state['asked'], 0)

    def test_extra_fields_and_provider_errors(self):
        with patch.dict(os.environ, ENV, clear=True):
            extra = json.loads(body()); extra['model'] = 'other'
            self.assertEqual(cloud.process_body(json.dumps(extra).encode(), post=reply)[0], 400)

            def broken(_request):
                raise OSError('down')
            code, result = cloud.process_body(body(), post=broken)
        self.assertEqual(code, 502); self.assertEqual(result['error']['code'], 'PROVIDER_UNAVAILABLE')

    def test_only_same_origin_cloud_client_requests(self):
        self.assertIsNone(cloud.validate_headers(headers()))
        self.assertEqual(cloud.validate_headers(headers(Origin='https://evil.example'))[0], 403)
        self.assertEqual(cloud.validate_headers(headers(**{'X-StatGuard-Client': 'local-v0.1'}))[0], 403)
        self.assertEqual(cloud.validate_headers(headers(**{'Content-Length': str(cloud.MAX_REQUEST_BYTES + 1)}))[0], 413)
        self.assertEqual(cloud.validate_headers(headers(**{'Content-Type': 'text/plain'}))[0], 415)


if __name__ == '__main__':
    unittest.main()

"""The version shown on the website must be the extractor version that actually runs, and the
Vercel runtime copy must be byte-identical to the source (no stale engine in deployment)."""
import hashlib
import json
import re
import unittest
from pathlib import Path

from when2warn.statguard.claims import EXTRACTOR_VERSION

ROOT = Path(__file__).resolve().parents[1]


class VersionSync(unittest.TestCase):
    def test_site_version_matches_extractor(self):
        chrome = (ROOT / "frontend/src/statguard/StatGuardChrome.tsx").read_text(encoding="utf-8")
        shown = re.search(r"STATGUARD_VERSION = '([^']+)'", chrome).group(1)
        self.assertEqual("statguard-rule-extractor-" + shown, EXTRACTOR_VERSION)

    def test_runtime_bundle_matches_sources_and_manifest(self):
        manifest = json.loads((ROOT / "frontend/_statguard_runtime/upstream_sha256.json").read_text(encoding="utf-8"))
        for name in ("core.py", "claims.py", "local_bridge.py", "forensics.py"):
            src = (ROOT / "src/when2warn/statguard" / name).read_bytes()
            self.assertEqual(src, (ROOT / "frontend/_statguard_runtime" / name).read_bytes(), name)
            self.assertEqual(hashlib.sha256(src).hexdigest(), manifest[name], name)


if __name__ == "__main__":
    unittest.main()

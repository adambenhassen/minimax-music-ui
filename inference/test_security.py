import asyncio
import hmac
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import httpx


def _load_server():
    inference_dir = str(Path(__file__).resolve().parent)
    if inference_dir not in sys.path:
        sys.path.insert(0, inference_dir)

    soundfile = ModuleType("soundfile")
    torch = ModuleType("torch")
    diffusers = ModuleType("diffusers")
    diffusers.ComponentsManager = type("ComponentsManager", (), {})
    diffusers.ModularPipeline = type("ModularPipeline", (), {})

    with patch.dict(sys.modules, {"soundfile": soundfile, "torch": torch, "diffusers": diffusers}):
        import server

    return server


server = _load_server()


class InferenceSecurityTests(TestCase):
    def setUp(self):
        self.original_args = server.ARGS
        self.original_ready = server.STATE["ready"]
        server.ARGS = SimpleNamespace(api_key="secret")
        server.STATE["ready"] = False

    def tearDown(self):
        server.ARGS = self.original_args
        server.STATE["ready"] = self.original_ready

    def _speech(self, headers=None):
        return self._request(
            "POST",
            "/v1/audio/speech",
            headers=headers or {},
            json={"input": "[Verse]", "instructions": "ambient", "seed": 7},
        )

    def _request(self, method, path, **kwargs):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=server.app), base_url="http://testserver"
            ) as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(send())

    def test_never_adds_access_control_allow_origin(self):
        origin = {"Origin": "https://evil.example"}
        responses = [
            self._request("GET", "/health", headers=origin),
            self._request("GET", "/v1/models", headers=origin),
            self._request(
                "OPTIONS",
                "/v1/audio/speech",
                headers={
                    **origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            ),
            self._speech(origin),
        ]

        for response in responses:
            with self.subTest(status=response.status_code):
                self.assertNotIn("access-control-allow-origin", response.headers)

    def test_accepts_bearer_and_x_api_key_headers(self):
        for headers in (
            {"Authorization": "Bearer secret"},
            {"X-API-Key": "secret"},
        ):
            with self.subTest(headers=headers):
                self.assertEqual(self._speech(headers).status_code, 503)

    def test_api_key_remains_optional(self):
        server.ARGS.api_key = None

        self.assertEqual(self._speech().status_code, 503)

    def test_rejects_wrong_or_missing_api_key_with_401(self):
        self.assertEqual(self._speech({"Authorization": "Bearer wrong"}).status_code, 401)
        self.assertEqual(self._speech().status_code, 401)

    def test_compares_api_key_with_constant_time_primitive(self):
        with patch.object(hmac, "compare_digest", wraps=hmac.compare_digest) as compare_digest:
            response = self._speech({"Authorization": "Bearer wrong"})

        self.assertEqual(response.status_code, 401)
        compare_digest.assert_called_once_with(b"wrong", b"secret")

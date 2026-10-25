import asyncio
import contextlib
import hmac
import io
import queue
import sys
import threading
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import anyio
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


class _DisconnectedRequest:
    async def is_disconnected(self):
        return True


class _DisconnectAfterFirstCheck:
    def __init__(self):
        self.checks = 0

    async def is_disconnected(self):
        self.checks += 1
        return self.checks > 1


class InferenceSpeechCancellationTests(TestCase):
    def setUp(self):
        self.original_args = server.ARGS
        self.original_ready = server.STATE["ready"]
        self.original_status = server.STATE["status"]
        self.original_hooks = server.STATE["hooks"]
        self.original_queue = server.QUEUE
        self.original_pipe = server.PIPE
        self.original_current_job = server.CURRENT["job"]
        server.ARGS = SimpleNamespace(api_key="secret", offload=False, host="127.0.0.1", port=7862)
        server.STATE["ready"] = True
        server.QUEUE = queue.Queue()
        server.PIPE = None
        server.CURRENT["job"] = None

    def tearDown(self):
        server.ARGS = self.original_args
        server.STATE["ready"] = self.original_ready
        server.STATE["status"] = self.original_status
        server.STATE["hooks"] = self.original_hooks
        server.QUEUE = self.original_queue
        server.PIPE = self.original_pipe
        server.CURRENT["job"] = self.original_current_job

    def _payload(self):
        return {"input": "[Verse]", "instructions": "ambient", "seed": 7}

    def _headers(self):
        return {"Authorization": "Bearer secret"}

    def _direct_speech(self, request, payload=None):
        async def send():
            return await server.speech(
                server.SpeechRequest(**(payload or self._payload())),
                request=request,
                authorization="Bearer secret",
                x_api_key=None,
            )

        return asyncio.run(send())

    def test_disconnect_cancels_a_queued_non_streaming_job(self):
        response = self._direct_speech(_DisconnectedRequest())
        job = server.QUEUE.get_nowait()

        self.assertEqual(response.status_code, 499)
        self.assertTrue(job["cancelled"])

    def test_disconnect_during_render_wait_cancels_within_one_second(self):
        started = time.monotonic()
        response = self._direct_speech(_DisconnectAfterFirstCheck())
        elapsed = time.monotonic() - started
        job = server.QUEUE.get_nowait()

        self.assertEqual(response.status_code, 499)
        self.assertLess(elapsed, 1.0)
        self.assertTrue(job["cancelled"])
        with self.assertRaises(server._Cancelled):
            server._check_cancel(job)

    def test_worker_skips_a_queued_job_cancelled_by_its_client(self):
        job = {
            "cancelled": True,
            "event": threading.Event(),
            "events": None,
            "lock": threading.Lock(),
            "completed": False,
        }

        class StopWorker(Exception):
            pass

        class OneJobQueue:
            def __init__(self):
                self.jobs = [job]

            def get(self):
                if self.jobs:
                    return self.jobs.pop()
                raise StopWorker()

            def task_done(self):
                pass

        pipe = SimpleNamespace(load_components=lambda **kwargs: None, to=lambda device: None)
        server.QUEUE = OneJobQueue()
        with (
            patch.object(server.ModularPipeline, "from_pretrained", return_value=pipe, create=True),
            patch.object(server, "_install_progress_hooks"),
            patch.object(server.torch, "bfloat16", object(), create=True),
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaises(StopWorker),
        ):
            server._worker()

        self.assertTrue(job["event"].is_set())

    def test_non_streaming_job_returns_wav_and_seed_when_it_finishes(self):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=server.app), base_url="http://testserver"
            ) as client:
                response_task = asyncio.create_task(
                    client.post("/v1/audio/speech", headers=self._headers(), json=self._payload())
                )
                while server.QUEUE.empty():
                    await asyncio.sleep(0.005)
                job = server.QUEUE.get_nowait()
                job["wav"] = b"RIFF test wav"
                server.QUEUE.task_done()
                job["event"].set()
                return await response_task, job

        response, job = asyncio.run(send())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"RIFF test wav")
        self.assertEqual(response.headers["x-seed"], "7")
        self.assertFalse(job["cancelled"])

    def test_streaming_request_still_returns_an_event_stream(self):
        response = self._direct_speech(
            _DisconnectedRequest(), {**self._payload(), "stream": True}
        )
        job = server.QUEUE.get_nowait()

        self.assertTrue(response.headers["content-type"].startswith("text/event-stream"))
        self.assertEqual(response.headers["x-seed"], "7")
        self.assertIsNotNone(job["events"])

    def test_failed_non_streaming_job_still_returns_500_with_the_error(self):
        async def send():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=server.app), base_url="http://testserver"
            ) as client:
                response_task = asyncio.create_task(
                    client.post("/v1/audio/speech", headers=self._headers(), json=self._payload())
                )
                while server.QUEUE.empty():
                    await asyncio.sleep(0.005)
                job = server.QUEUE.get_nowait()
                job["error"] = "ValueError: render failed"
                server.QUEUE.task_done()
                job["event"].set()
                return await response_task

        response = asyncio.run(send())

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "ValueError: render failed")

    def test_pending_non_streaming_job_does_not_block_other_requests(self):
        async def send():
            limiter = anyio.to_thread.current_default_thread_limiter()
            original_tokens = limiter.total_tokens
            limiter.total_tokens = 1
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=server.app), base_url="http://testserver"
                ) as client:
                    speech_task = asyncio.create_task(
                        client.post("/v1/audio/speech", headers=self._headers(), json=self._payload())
                    )
                    while server.QUEUE.empty():
                        await asyncio.sleep(0.005)
                    another_speech_task = asyncio.create_task(
                        client.post("/v1/audio/speech", headers=self._headers(), json=self._payload())
                    )
                    queue_deadline = asyncio.get_running_loop().time() + 0.2
                    while server.QUEUE.qsize() < 2 and asyncio.get_running_loop().time() < queue_deadline:
                        await asyncio.sleep(0.005)
                    another_speech_queued = server.QUEUE.qsize() == 2
                    health_task = asyncio.create_task(client.get("/health"))
                    models_task = asyncio.create_task(client.get("/v1/models"))
                    done, _ = await asyncio.wait(
                        {health_task, models_task}, timeout=0.2, return_when=asyncio.ALL_COMPLETED
                    )
                    responsive = len(done) == 2 and another_speech_queued
                    while not server.QUEUE.empty():
                        job = server.QUEUE.get_nowait()
                        job["wav"] = b"RIFF test wav"
                        server.QUEUE.task_done()
                        job["event"].set()
                    await speech_task
                    await health_task
                    await models_task
                    if not another_speech_queued:
                        while server.QUEUE.empty():
                            await asyncio.sleep(0.005)
                        job = server.QUEUE.get_nowait()
                        job["wav"] = b"RIFF test wav"
                        server.QUEUE.task_done()
                        job["event"].set()
                    await another_speech_task
                    return responsive
            finally:
                limiter.total_tokens = original_tokens

        self.assertTrue(asyncio.run(send()))

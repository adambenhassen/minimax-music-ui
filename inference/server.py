"""MiniMax Music 3 on a single GPU, behind the same HTTP API MiniMax's own server exposes.

Upstream serves this model with `sgl-omni serve --model-path MiniMaxAI/MiniMax-Music3`, which
needs two CUDA GPUs. This script serves the identical request shape from the diffusers pipeline,
which fits on one card (~24 GB), so a client written against either works against both:

    POST /v1/audio/speech
        {"model": "minimax_ttm",
         "input": "[Verse]\\n...",              # lyrics, section tags on their own lines
         "instructions": "Global Metadata: ...", # style description
         "response_format": "wav",
         "seed": 7,
         "max_new_tokens": 750,                  # length in 25 fps frames; 9000 = 360 s cap
         "stream": false}
    -> 44.1 kHz stereo 16-bit WAV bytes

    POST /v1/audio/speech with "stream": true   (this server only; upstream rejects it)
    -> text/event-stream: `progress` {stage: semantic|denoise, done, total, secondsRendered},
       `audio` {pcm: base64 int16 stereo, samples, sampleRate, channels} per denoised window,
       then `done` {seed, sampleRate, channels} or `error` {message}. Disconnecting cancels the job.

    GET /v1/models   -> the one model
    GET /health      -> 200 {"status":"ready","capabilities":["stream"]} once loaded, 503 while loading

Requests are rendered one at a time; generation is ~3x slower than realtime on an RTX 3090.

    pip install "diffusers @ git+https://github.com/huggingface/diffusers" torch soundfile fastapi uvicorn
    python server.py --host 127.0.0.1 --port 7862
"""
import argparse
import base64
import io
import json
import queue
import threading
import time
import uuid

import soundfile as sf
import torch
from diffusers import ComponentsManager, ModularPipeline
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

REPO = "MiniMaxAI/MiniMax-Music3"
FRAME_RATE = 25          # acoustic frames per second — the unit max_new_tokens counts in
MAX_FRAMES = 9_000       # the model's hard cap: 360 s
DEFAULT_FRAMES = 1_500   # 60 s, when a request omits max_new_tokens

STATE = {"ready": False, "status": "loading pipeline", "hooks": False}
QUEUE = queue.Queue()
PIPE = None
ARGS = None
CAPABILITIES = ["stream"]   # extras beyond upstream's API; the UI probes /health for them
CURRENT = {"job": None}     # the job on the GPU right now; the hooks below read it
SEMANTIC_EVERY = 25         # frames between semantic progress events (= 1 s of audio)


class _Cancelled(Exception):
    """Raised inside the pipeline when the streaming client went away."""


def _emit(job, event, payload):
    if job is not None and job["events"] is not None:
        job["events"].put((event, payload))


def _check_cancel(job):
    if job is not None and job["cancelled"]:
        raise _Cancelled()


def _install_progress_hooks(pipe):
    """Best-effort taps into the diffusers pipeline for real progress + per-window audio.
    Only streaming jobs (CURRENT["job"] with an event queue) see any effect."""
    from diffusers.modular_pipelines.minimax_music3 import decoders as _dec
    from diffusers.modular_pipelines.minimax_music3 import denoise as _dn

    def lm_hook(module, args, kwargs, output):  # one call = prefill, then one per generated frame
        job = CURRENT["job"]
        if job is None:
            return
        _check_cancel(job)
        job["frames"] += 1
        n = job["frames"] - 1
        if n % SEMANTIC_EVERY == 0 or n >= job["max_frames"]:
            _emit(job, "progress", {"stage": "semantic", "done": min(n, job["max_frames"]),
                                    "total": job["max_frames"], "secondsRendered": 0.0})

    pipe.language_model.model.register_forward_hook(lm_hook, with_kwargs=True)

    Loop = _dn.MiniMaxMusic3ChunkLoopWrapper
    orig_progress_bar, orig_loop_step = Loop.progress_bar, Loop.loop_step

    class _Bar:  # stands in for tqdm: the denoise loop calls .update() once per step
        def __init__(self, total):
            self.n, self.total = 0, total

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def update(self, k=1):
            self.n += k
            job = CURRENT["job"]
            _emit(job, "progress", {"stage": "denoise", "done": self.n, "total": self.total,
                                    "secondsRendered": job["seconds"] if job else 0.0})

    def progress_bar(self, iterable=None, total=None):
        job = CURRENT["job"]
        if job is None or job["events"] is None or total is None:
            return orig_progress_bar(self, iterable=iterable, total=total)
        return _Bar(total)

    def loop_step(self, components, block_state, k):
        job = CURRENT["job"]
        _check_cancel(job)
        components, block_state = orig_loop_step(self, components, block_state, k=k)
        if job is not None and job["events"] is not None:
            latents = block_state.latent_chunks[-1]
            last = k == len(block_state.chunk_starts) - 1
            hop = components.latent_hop_length
            with torch.no_grad():
                wav = components.vocoder(latents.to(components.vocoder.dtype))
            left = 0 if k == 0 else _dec._CROP_LEFT_LATENT * hop
            right = 0 if last else _dec._CROP_RIGHT_LATENT * hop
            wav = wav[..., left : wav.shape[-1] - right].float().clamp(-1.0, 1.0)[0]  # (channels, samples)
            pcm = (wav.T.cpu().numpy() * 32767.0).astype("<i2").tobytes()
            job["seconds"] += wav.shape[-1] / components.sampling_rate
            job["pcm"].append(pcm)
            _emit(job, "audio", {"pcm": base64.b64encode(pcm).decode("ascii"), "samples": int(wav.shape[-1]),
                                 "sampleRate": int(components.sampling_rate), "channels": int(wav.shape[0])})
        return components, block_state

    Loop.progress_bar, Loop.loop_step = progress_bar, loop_step


class SpeechRequest(BaseModel):
    """Upstream's request body. Unknown fields are ignored, so an OpenAI-shaped client that
    sends `voice`, `speed` and friends still works."""

    model: str = Field("minimax_ttm", description="Ignored; one model is served.")
    input: str = Field(..., description="Lyrics. Section tags such as [Verse]/[Chorus] on their own lines.")
    instructions: str = Field("", description="Music description: genre, BPM, key, vocals, arrangement.")
    response_format: str = Field("wav", description="wav")
    seed: int | None = Field(None, description="Omit for a random seed; the one used comes back in X-Seed.")
    max_new_tokens: int | None = Field(
        None, description="Length in 25 fps frames: 750 = 30 s, cap 9000 = 360 s. Default 1500 = 60 s."
    )
    stream: bool = Field(False, description="true (this server only) streams SSE progress + PCM windows; upstream accepts only false.")


def _worker():
    """Loads the pipeline, then renders queued requests one at a time on the GPU."""
    global PIPE
    try:
        print("loading pipeline (~30 s warm, minutes cold; holds ~24 GB VRAM) ...", flush=True)
        if ARGS.offload:
            manager = ComponentsManager()
            manager.enable_auto_cpu_offload(device="cuda")
            PIPE = ModularPipeline.from_pretrained(REPO, components_manager=manager)
        else:
            PIPE = ModularPipeline.from_pretrained(REPO)
        PIPE.load_components(dtype=torch.bfloat16)
        if not ARGS.offload:
            PIPE.to("cuda")
        try:
            _install_progress_hooks(PIPE)
            STATE["hooks"] = True
        except Exception as exc:  # diffusers internals moved; streaming still works, just without live progress
            print("WARNING: progress hooks not installed (%s); stream=true will only deliver the final audio" % exc, flush=True)
        STATE["ready"], STATE["status"] = True, "ready"
        print("ready on http://%s:%d — %d Hz stereo" % (ARGS.host, ARGS.port, PIPE.sampling_rate), flush=True)
    except BaseException as exc:
        STATE["status"] = "load failed: %s" % exc
        print("FATAL: pipeline load failed: %s" % exc, flush=True)
        raise

    while True:
        job = QUEUE.get()
        if job["cancelled"]:  # streaming client left while queued
            job["event"].set()
            QUEUE.task_done()
            continue
        CURRENT["job"] = job
        try:
            t0 = time.time()
            print("[%s] %.0f s, seed %d%s" % (job["id"], job["duration"], job["seed"], " (stream)" if job["events"] else ""), flush=True)
            audio = PIPE(
                prompt=job["instructions"],
                lyrics=job["lyrics"],
                audio_duration=job["duration"],
                generator=torch.Generator("cuda").manual_seed(job["seed"]),
                output="audios",
            )[0]
            if hasattr(audio, "cpu"):  # some builds return a tensor, others a numpy array
                audio = audio.float().cpu().numpy()
            if job["events"] is not None and not job["pcm"]:  # hooks missing: ship the whole clip in one event
                pcm = (audio.T * 32767.0).astype("<i2").tobytes()
                _emit(job, "audio", {"pcm": base64.b64encode(pcm).decode("ascii"), "samples": int(audio.shape[-1]),
                                     "sampleRate": int(PIPE.sampling_rate), "channels": int(audio.shape[0])})
            buf = io.BytesIO()
            sf.write(buf, audio.T, PIPE.sampling_rate, format="WAV", subtype="PCM_16")
            job["wav"] = buf.getvalue()
            _emit(job, "done", {"seed": job["seed"], "sampleRate": int(PIPE.sampling_rate), "channels": int(audio.shape[0])})
            print("[%s] done in %.0f s" % (job["id"], time.time() - t0), flush=True)
        except _Cancelled:
            job["error"] = "cancelled"
            print("[%s] cancelled by client" % job["id"], flush=True)
        except BaseException as exc:
            job["error"] = "%s: %s" % (type(exc).__name__, exc)
            _emit(job, "error", {"message": job["error"]})
            print("[%s] failed: %s" % (job["id"], exc), flush=True)
        finally:
            CURRENT["job"] = None
            if job["events"] is not None:
                job["events"].put(None)
            job["event"].set()
            QUEUE.task_done()


app = FastAPI(title="MiniMax Music 3", description="Text-to-music on one GPU, upstream's API.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    """503 until the model is on the GPU, so process supervisors can wait it out."""
    if not STATE["ready"]:
        raise HTTPException(503, STATE["status"])
    return {"status": "ready", "model": REPO, "capabilities": CAPABILITIES}


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": "minimax_ttm", "object": "model", "owned_by": "minimax"}]}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest, authorization: str = Header(None), x_api_key: str = Header(None)):
    if ARGS.api_key:
        supplied = x_api_key or (authorization or "").removeprefix("Bearer ").strip()
        if supplied != ARGS.api_key:
            raise HTTPException(401, "bad or missing API key")
    if req.response_format != "wav":
        raise HTTPException(422, "response_format %r is not supported; only 'wav'" % req.response_format)
    # the pipeline raises on either being blank — an instrumental still needs a [Instrumental] tag
    if not req.input.strip():
        raise HTTPException(422, "input (lyrics) is empty; use a bare [Instrumental] tag for no vocals")
    if not req.instructions.strip():
        raise HTTPException(422, "instructions (music description) is empty")
    if not STATE["ready"]:
        raise HTTPException(503, STATE["status"])

    frames = max(1, min(int(req.max_new_tokens or DEFAULT_FRAMES), MAX_FRAMES))
    job = {
        "id": uuid.uuid4().hex[:8],
        "instructions": req.instructions,
        "lyrics": req.input,
        "duration": frames / FRAME_RATE,
        "seed": int(req.seed) if req.seed is not None else int(torch.randint(0, 2**31 - 1, (1,)).item()),
        "wav": None,
        "error": None,
        "event": threading.Event(),
        "events": queue.Queue() if req.stream else None,
        "cancelled": False,
        "frames": 0,
        "max_frames": frames,
        "seconds": 0.0,
        "pcm": [],
    }
    QUEUE.put(job)
    if req.stream:
        def events():
            try:
                while True:
                    try:
                        ev = job["events"].get(timeout=15)
                    except queue.Empty:
                        yield ": keepalive\n\n"  # lets us notice a vanished client while queued
                        continue
                    if ev is None:
                        return
                    name, payload = ev
                    yield "event: %s\ndata: %s\n\n" % (name, json.dumps(payload))
            finally:
                job["cancelled"] = True  # client gone or stream finished: either way stop rendering

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"X-Seed": str(job["seed"]), "Cache-Control": "no-cache"})
    job["event"].wait()  # synchronous, as upstream: the response body is the audio
    if job["error"]:
        raise HTTPException(500, job["error"])
    return Response(job["wav"], media_type="audio/wav", headers={"X-Seed": str(job["seed"])})


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="127.0.0.1", help="bind address; 0.0.0.0 exposes it beyond localhost")
    ap.add_argument("--port", type=int, default=7862)
    ap.add_argument("--api-key", help="require this key in Authorization: Bearer <key> or X-API-Key")
    ap.add_argument("--offload", action="store_true", help="CPU-offload weights (~22 GB VRAM, slower)")
    ARGS = ap.parse_args()

    if ARGS.host != "127.0.0.1" and not ARGS.api_key:
        print("WARNING: bound to %s with no --api-key; anyone who can reach this port can use the GPU" % ARGS.host)

    threading.Thread(target=_worker, daemon=True).start()

    import uvicorn

    uvicorn.run(app, host=ARGS.host, port=ARGS.port, log_level="info")

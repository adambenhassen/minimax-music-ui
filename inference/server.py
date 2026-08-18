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

    GET /v1/models   -> the one model
    GET /health      -> 200 once the pipeline is loaded, 503 while it is loading

Requests are rendered one at a time; generation is ~3x slower than realtime on an RTX 3090.

    pip install "diffusers @ git+https://github.com/huggingface/diffusers" torch soundfile fastapi uvicorn
    python server.py --host 127.0.0.1 --port 7862
"""
import argparse
import io
import queue
import threading
import time
import uuid

import soundfile as sf
import torch
from diffusers import ComponentsManager, ModularPipeline
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

REPO = "MiniMaxAI/MiniMax-Music3"
FRAME_RATE = 25          # acoustic frames per second — the unit max_new_tokens counts in
MAX_FRAMES = 9_000       # the model's hard cap: 360 s
DEFAULT_FRAMES = 1_500   # 60 s, when a request omits max_new_tokens

STATE = {"ready": False, "status": "loading pipeline"}
QUEUE = queue.Queue()
PIPE = None
ARGS = None


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
    stream: bool = Field(False, description="Only false is supported, as upstream.")


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
        STATE["ready"], STATE["status"] = True, "ready"
        print("ready on http://%s:%d — %d Hz stereo" % (ARGS.host, ARGS.port, PIPE.sampling_rate), flush=True)
    except BaseException as exc:
        STATE["status"] = "load failed: %s" % exc
        print("FATAL: pipeline load failed: %s" % exc, flush=True)
        raise

    while True:
        job = QUEUE.get()
        try:
            t0 = time.time()
            print("[%s] %.0f s, seed %d" % (job["id"], job["duration"], job["seed"]), flush=True)
            audio = PIPE(
                prompt=job["instructions"],
                lyrics=job["lyrics"],
                audio_duration=job["duration"],
                generator=torch.Generator("cuda").manual_seed(job["seed"]),
                output="audios",
            )[0]
            if hasattr(audio, "cpu"):  # some builds return a tensor, others a numpy array
                audio = audio.float().cpu().numpy()
            buf = io.BytesIO()
            sf.write(buf, audio.T, PIPE.sampling_rate, format="WAV", subtype="PCM_16")
            job["wav"] = buf.getvalue()
            print("[%s] done in %.0f s" % (job["id"], time.time() - t0), flush=True)
        except BaseException as exc:
            job["error"] = "%s: %s" % (type(exc).__name__, exc)
            print("[%s] failed: %s" % (job["id"], exc), flush=True)
        finally:
            job["event"].set()
            QUEUE.task_done()


app = FastAPI(title="MiniMax Music 3", description="Text-to-music on one GPU, upstream's API.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    """503 until the model is on the GPU, so process supervisors can wait it out."""
    if not STATE["ready"]:
        raise HTTPException(503, STATE["status"])
    return {"status": "ready", "model": REPO}


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": "minimax_ttm", "object": "model", "owned_by": "minimax"}]}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest, authorization: str = Header(None), x_api_key: str = Header(None)):
    if ARGS.api_key:
        supplied = x_api_key or (authorization or "").removeprefix("Bearer ").strip()
        if supplied != ARGS.api_key:
            raise HTTPException(401, "bad or missing API key")
    if req.stream:
        raise HTTPException(400, "stream=true is not supported; the model is non-streaming")
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
    }
    QUEUE.put(job)
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

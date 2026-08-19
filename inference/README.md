# Single-GPU inference server

`server.py` serves MiniMax-Music3 from the diffusers pipeline on **one** CUDA GPU (~24 GB VRAM), behind the same HTTP API as MiniMax's own `sgl-omni serve` (which needs two GPUs). The UI works against either.

```bash
pip install -r requirements.txt
python server.py --host 127.0.0.1 --port 7862
# then point the UI at http://127.0.0.1:7862
```

### Model download

The weights (`MiniMaxAI/MiniMax-Music3`, tens of GB) are **not** in this repo. On first start the script pulls them from the Hugging Face Hub into the HF cache (`~/.cache/huggingface/hub`, or `$HF_HOME`) — expect the first launch to take a while and `/health` to return 503 until it's done. To fetch ahead of time, or on a machine with a slow link:

```bash
pip install -U "huggingface_hub[cli]"
huggingface-cli download MiniMaxAI/MiniMax-Music3
# optional: HF_HOME=/big/disk/hf python server.py ...   (put the cache elsewhere)
# optional: HF_HUB_OFFLINE=1 python server.py ...       (after the download; no network needed)
```

If the Hub asks you to accept the model's terms, do that on the model page and log in with `huggingface-cli login` first.

| Route | |
|---|---|
| `POST /v1/audio/speech` | `{model, input (lyrics), instructions (style), response_format: "wav", seed?, max_new_tokens (25 fps frames, ≤ 9000), stream: false}` → 44.1 kHz stereo 16-bit WAV, seed used in `X-Seed` |
| `POST /v1/audio/speech` + `stream: true` | *this server only* — `text/event-stream`: `progress {stage: semantic\|denoise, done, total, secondsRendered}`, `audio {pcm (base64 int16 stereo), samples, sampleRate, channels}` per denoised ~8 s window, then `done {seed}` or `error {message}`; disconnecting cancels the render |
| `GET /v1/models` | the one model (`minimax_ttm`) |
| `GET /health` | `200 {"status":"ready","capabilities":["stream"]}` once loaded, 503 while loading |

The UI probes `/health` for `capabilities` and uses `stream: true` for live progress and play-while-rendering; anything written against upstream's plain contract keeps working unchanged.

Options: `--offload` (CPU-offload weights, ~22 GB VRAM, slower), `--api-key <key>` (required in `Authorization: Bearer` or `X-API-Key`; set it if you bind to anything other than 127.0.0.1). Renders run one at a time, ~3× slower than realtime on an RTX 3090.

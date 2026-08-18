# Single-GPU inference server

`server.py` serves MiniMax-Music3 from the diffusers pipeline on **one** CUDA GPU (~24 GB VRAM), behind the same HTTP API as MiniMax's own `sgl-omni serve` (which needs two GPUs). The UI works against either.

```bash
pip install -r requirements.txt
python server.py --host 127.0.0.1 --port 7862
# then point the UI at http://127.0.0.1:7862
```

| Route | |
|---|---|
| `POST /v1/audio/speech` | `{model, input (lyrics), instructions (style), response_format: "wav", seed?, max_new_tokens (25 fps frames, ≤ 9000), stream: false}` → 44.1 kHz stereo 16-bit WAV, seed used in `X-Seed` |
| `GET /v1/models` | the one model (`minimax_ttm`) |
| `GET /health` | 200 once loaded, 503 while loading |

Options: `--offload` (CPU-offload weights, ~22 GB VRAM, slower), `--api-key <key>` (required in `Authorization: Bearer` or `X-API-Key`; set it if you bind to anything other than 127.0.0.1). Renders run one at a time, ~3× slower than realtime on an RTX 3090.

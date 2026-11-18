# STAR AI private GPU worker (optional)

This Docker Compose example deploys an **open-weight Qwen3.5 model** with vLLM on a GPU host and connects it to the existing Railway `star-ai-gateway` over a named Cloudflare Tunnel.

### Prerequisites
- A GPU host you control (or rent after reviewing hourly price), Docker Engine + Docker Compose v2 + NVIDIA Container Toolkit. Verify `nvidia-smi` and `docker run --rm --gpus all nvidia/cuda:... nvidia-smi` with a valid supported CUDA image. Never expose Docker socket.
- Enough GPU VRAM for the chosen model, weights and KV cache. This starter defaults to **Qwen/Qwen3.5-9B** with a 4K context. GPU fit is **not guaranteed**; choose a smaller compatible Qwen model for limited memory, or a quantized stronger model on larger GPUs. For the 35B-A3B model, check the exact quantization and compatibility before deployment.
- Cloudflare Zero Trust named Tunnel, a domain you control, an Access application with a **Service Auth** policy allowing only a specific service token.
- A distinct long vLLM bearer key, not a Kimi or OpenAI API key.

### Step 1 — Start the private model on your GPU host

```bash
cd deploy/selfhosted-gpu
cp .env.example .env
# Edit .env privately with your actual keys and tunnel token.
chmod 600 .env
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

**Do not run the example with placeholder secrets.** Docker Compose will mount the model weights in a named persistent Docker volume; the vLLM inference process has **no host-published port**.

The compose image tag is a versioned vLLM example; verify its support for your NVIDIA driver/CUDA and the chosen Qwen model. Pin a verified image digest for production. The Cloudflare image uses `latest` in this starter; pin its digest after initial validation.

### Step 2 — Restrict access

In Cloudflare Zero Trust, map the named Tunnel hostname `inference.yourdomain.com` to `http://inference:8000` (the same Docker Compose network). Create a self-hosted Access application for this hostname; configure a service-token-only **Service Auth** policy with no public bypass. Obtain the Client ID and Client Secret. Treat these as server-side secrets.

Do not add an unauthenticated public DNS origin directly to vLLM. `--api-key`/ `VLLM_API_KEY` protects the model's `/v1` routes, **not every diagnostic/metrics endpoint**. Cloudflare Access protects the entire exposed hostname.

### Step 3 — Activate on Railway (only after Step 2 works)

In the existing Railway project **linux-terminal → star-ai-gateway → Variables**, set:

```ini
AI_PROVIDER=selfhosted
AI_ENABLED=1
AI_MODEL=star-selfhost
AI_SELFHOST_URL=https://inference.yourdomain.com/v1/chat/completions
AI_SELFHOST_ALLOWED_HOST=inference.yourdomain.com
AI_SELFHOST_API_KEY=<same secret as VLLM_API_KEY on GPU server>
AI_SELFHOST_CF_CLIENT_ID=<your Cloudflare Access service token Client ID>
AI_SELFHOST_CF_CLIENT_SECRET=<your Cloudflare Access service token Client Secret>
```

Replace `yourdomain.com` with your own verified domain. Keep the existing `AI_GATEWAY_TOKEN` matched between Railway Terminal and Gateway and do **not** put GPU keys in Terminal or frontend variables. Store the Cloudflare token in Railway's private variable editor.

### Step 4 — Verify a real response

The existing terminal page can check gateway readiness after login. That check only proves the gateway has valid configuration; it does **not** prove the GPU model is answering. Ask the model a short harmless question and validate its answer. Review Railway/GPU logs for errors, and monitor GPU hourly usage and costs.

No autonomous terminal command execution is enabled: model responses are advisory; existing owner-approved tool execution remains separate.

### Stop costs when finished

```bash
docker compose --env-file .env down
```

Do **not** add `-v` unless you intentionally want to delete cached model weights. Stop/destroy GPU rental separately through the host provider's billing console; Docker shutdown alone may not stop VM billing.

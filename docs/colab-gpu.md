# Google Colab GPU — STAR AI with Qwen3.5

[Launch the notebook in Colab](https://colab.research.google.com/github/abdulstarzeki001-sketch/linux-terminal/blob/main/colab/STAR_AI_Qwen35_GPU_Colab.ipynb)

## Purpose

This notebook runs an open-weight **Qwen3.5 model on a managed Colab GPU**, not via Kimi or OpenAI paid APIs. It uses Ollama's loopback-only API for interactive notebook sessions. The model is chosen based on detected GPU free memory:

| Detected free GPU VRAM | Default model (quantized) |
| --- | --- |
| >= 14 GiB approximately | `qwen3.5:9b` |
| >= 8 GiB approximately | `qwen3.5:4b` |
| Lower | `qwen3.5:2b` |

Model selection is an estimate, not a guarantee: workload context length, model quantization, and other processes also use VRAM.

## Start

1. Open the notebook in your **own Google account**.
2. Runtime → Change runtime type → GPU, then Save.
3. Run all cells. Allow the official Ollama installer and the model-weight download (several GB).
4. Look for the **real model reply** and check `ollama ps` GPU/CPU processing mode.
5. Change `question` in the chat cell and rerun it to chat.

## Costs and limitations

- **Do not buy Colab Pro before checking available free/PAYG GPU quota and the current price shown in your account.** Colab subscriptions and compute units are charged/allocated separately from hosted model APIs. This repo does not purchase a subscription.
- Managed Colab GPUs are **not guaranteed** and runtimes are **temporary**. Restarting may require reinstalling/downloading model weights; do not store secrets or critical datasets in the temporary filesystem.
- The Ollama listener is pinned to `127.0.0.1:11434`. There is **no publicly reachable API endpoint**. Do not use Colab as a persistent web service, a tunneling/proxy relay or a way to bypass Colab's runtime rules.
- The existing Railway `star-ai-gateway` **cannot connect directly to this local Colab runtime**. For production, provision a dedicated GPU VM or supported Colab-on-your-VM environment with access control, and use `deploy/selfhosted-gpu/` as the separate service deployment template.
- No API keys are required in this notebook; prompts and logs run inside the rented Google runtime. Model weights download from Ollama, which requires Internet access.
- Colab managed runtimes prohibit other activities beyond interactive compute; review the official [Colab FAQ](https://research.google.com/colaboratory/faq.html) and terms before use.

## Troubleshooting

- `No NVIDIA GPU found`: change Runtime type to GPU and check quota.
- `model requires more memory` or sluggish inference: change `MODEL = "qwen3.5:4b"`, rerun the pull and chat cells, or reduce `num_ctx`.
- Colab VM disconnected: rerun cells after reconnecting; cached data may be gone.
- `ollama ps` reports CPU instead of GPU: inspect `nvidia-smi` and driver compatibility; do not assume GPU execution.

Sources: [Google Colab FAQ](https://research.google.com/colaboratory/faq.html) · [Ollama Linux installation](https://docs.ollama.com/linux) · [Ollama chat API](https://docs.ollama.com/api/chat) · [Qwen3.5 Ollama models](https://ollama.com/library/qwen3.5)

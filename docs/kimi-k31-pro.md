# STAR AI — Kimi K3.1 Pro integration

The isolated `star-ai-gateway` Railway service can use Kimi K3.1 Pro without giving provider credentials to the browser or Linux terminal process.

## Google Colab notebook

Use [Kimi K3.1 Pro STAR AI on Colab](https://colab.research.google.com/github/abdulstarzeki001-sketch/linux-terminal/blob/main/colab/Kimi_K31_Pro_STAR_AI.ipynb). The notebook calls the hosted Kimi API. Colab Pro and a GPU are not required for this API setup; provider API billing is separate.

## Opt-in Railway configuration

Create a Kimi API key in your own account at https://platform.kimi.ai/. **Never paste the key in issues, chats, source files or Colab outputs.**

In Railway **linux-terminal → star-ai-gateway → Variables**, configure these values:

```ini
AI_ENABLED=1
AI_PROVIDER=kimi
AI_MODEL=kimi-k3.1-pro
AI_API_KEY=<enter Kimi API key using Railway's private variable editor>
AI_MAX_PER_HOUR=30
```

Keep the existing long, matched `AI_GATEWAY_TOKEN` on the terminal and gateway services unchanged. Do not configure `AI_API_KEY` on the terminal service. The gateway has no public domain: requests come only through Railway private networking.

The default `AI_PROVIDER` (unset) is `openai`. This preserves the existing OpenAI Responses API behavior until a valid Kimi API key is available and the owner explicitly switches providers. Do not set `AI_PROVIDER=kimi` with an OpenAI key.

The supported model IDs are `kimi-k3.1-pro` and `kimi-k3.1-pro-highspeed`. The upstream base URL is pinned in code to `https://api.moonshot.ai/v1/chat/completions`, rather than accepting arbitrary URLs. Output is limited, provider errors are sanitized, and no shell or tool execution is enabled by the AI assistant.

## Verify

1. Check CI on the pull request: `node --test test/*.test.js`, JS syntax checks, and the gateway Docker build.
2. After a reviewed merge and provider key configuration, check the existing authenticated Terminal AI Status button. Its health probe verifies configuration, not the key's validity.
3. Send a short question through the authenticated STAR AI chat. Confirm a real answer arrives before considering the integration working.
4. Check Railway gateway logs for safe categorized errors; do not disclose raw keys or customer prompts.

**Operational constraint:** Colab cannot host this very large model on its ordinary GPU quota. The hosted Kimi API does the inference. Your Railway terminal does **not** get autonomous command execution from this change.

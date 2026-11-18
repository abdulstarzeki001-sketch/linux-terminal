# STAR AI: owner-controlled self-hosted AI

This adds an **opt-in** `selfhosted` provider to the existing private Railway `star-ai-gateway`. No provider key is sent to the terminal or browser. The OpenAI/Kimi integrations are preserved.

## Why

Hosted APIs enforce their provider's policies, terms and quotas. Running your own open-weight model gives the owner more operational control; it **does not** eliminate hardware limits, training-time refusals or applicable laws. Do not disable login, command-approval gates, audit logging or security boundaries in STAR AI.

## Recommended engine

A GPU server separate from Railway, running an OpenAI Chat Completions-compatible authenticated inference engine such as vLLM. Qwen3.5-35B-A3B with a supported 4-bit quantization is a practical starting point; hardware and model compatibility must be checked before committing GPU rental costs. A 48GB GPU is a reasonable initial target, not a guaranteed requirement. Start with a short context, e.g. 8K; increase only after measuring actual VRAM use.

Ollama offers `qwen3.5:35b` for local use, but its native HTTP endpoint does not enforce bearer authentication. **Never expose unprotected Ollama publicly.** Put a mutually authenticated proxy in front of it, or use vLLM with `--api-key`.

## Secure network topology

```
Browser -- authenticated WebSocket --> Railway terminal
                                         |
                                  private Railway network
                                         |
                                  star-ai-gateway
                                         |
                     HTTPS + separate bearer auth + exact hostname
                                         |
                        cloudflared tunnel / TLS reverse proxy
                                         |
                            GPU host: vLLM (private port)
```

Only the owner operates the GPU server and the network proxy. Protect the hostname with an authenticated TLS gateway. Do not expose the plain vLLM/Ollama port to the internet. For deployment with Cloudflare, use the included `deploy/selfhosted-gpu/compose.yml` and map the named tunnel hostname to `http://inference:8000` on the Compose network. Require a Cloudflare Access Service Auth policy for the entire hostname.

## Railway configuration (AFTER external GPU endpoint works)

In **linux-terminal → star-ai-gateway → Variables**, add:

```ini
AI_PROVIDER=selfhosted
AI_ENABLED=1
AI_MODEL=star-selfhost
AI_SELFHOST_URL=https://inference.your-domain.example/v1/chat/completions
AI_SELFHOST_ALLOWED_HOST=inference.your-domain.example
AI_SELFHOST_API_KEY=<distinct, strong inference server bearer token>
AI_SELFHOST_CF_CLIENT_ID=<your Access service token Client ID>
AI_SELFHOST_CF_CLIENT_SECRET=<your Access service token Client Secret>
```

`inference.your-domain.example` is a **placeholder**, not a functioning address. Replace with your real trusted HTTPS inference hostname in both variables. The gateway refuses HTTP, IP addresses, mismatched hostnames, embedded credentials, query strings and any paths other than `/v1/chat/completions`. Use a token dedicated to this service. The configured `AI_API_KEY` used by the Kimi/OpenAI providers is **never** sent to the self-hosted endpoint.

Keep `AI_GATEWAY_TOKEN`, `AI_GATEWAY_URL` and terminal authentication unchanged. This model adapter is advisory: it does **not** authorize AI to execute shell commands. The owner must approve terminal operations separately.

## Validation

1. In your authorized GPU environment, start the chosen model with an OpenAI-compatible chat endpoint, an explicit served model name `star-selfhost`, bearer authentication, and low context length.
2. Confirm `curl` from an authorized client reaches the HTTPS hostname and obtains a chat reply with the dedicated bearer token. Do not print the token in logs.
3. Check CI on the branch (Node tests, syntax checks, gateway Docker image).
4. Set Railway variables and redeploy only after the endpoint is ready; check authenticated terminal AI Status, then send a harmless sample prompt.
5. Compare logs for safe error categories and monitor costs/resource usage. Do not confuse `/health` readiness with a real model reply.

## Security limitations

The current URL guard validates scheme, exact owner-configured hostname, host type and endpoint path. TLS protects transit. Configure DNS and Cloudflare Tunnel with control of the domain. When both `AI_SELFHOST_CF_CLIENT_ID` and `AI_SELFHOST_CF_CLIENT_SECRET` are set, the gateway also sends Cloudflare Access service-token headers only to the pinned self-hosted hostname. A partial pair is rejected. These tokens are required when you put the inference hostname behind a Cloudflare Access Service Auth policy. Preserve the independent vLLM bearer token.

Full Kimi K3.1 Pro self-hosting requires an unusually large multi-GPU cluster; it is not a practical 48GB single-GPU candidate.

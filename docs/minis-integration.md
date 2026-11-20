# STAR AI ↔ Minis: deployment guide

Status: proposed integration, NOT deployed to public internet.

## Railway
1. Verify the existing private star-ai-gateway has AI_ENABLED=1 and a working AI_MODEL / upstream key. Backend may have third-party API costs.
2. Generate a unique long random secret and set STAR_MINIS_API_KEY on that service (minimum 32 chars). Never reuse AI_GATEWAY_TOKEN or AI_API_KEY.
3. Only after reviewing the code, configure a Railway HTTPS domain for the gateway. Never expose a raw Ollama port.
4. Test GET /v1/models with Authorization: Bearer <STAR_MINIS_API_KEY>; it should return model ID star-ai.
5. Test POST /v1/chat/completions with a short text conversation and the same Bearer key.

## Minis on iPhone
Select: Add Provider > OpenAI / Compatible API > API Key.
Name: STAR AI ULTRA
Base URL: https://YOUR-HTTPS-DOMAIN/v1
If Minis automatically adds /v1, enter just https://YOUR-HTTPS-DOMAIN instead.
API Key: STAR_MINIS_API_KEY, copied securely from your password manager or Railway.
Model ID: star-ai

## Capabilities and limits
- Provides OpenAI-style model listing, JSON chat completion, and one-chunk SSE with DONE after inference. SSE is not real-time token streaming.
- Plain system/user/assistant text only: up to 32 messages and 4000 combined prompt characters.
- No MCP tools, persistent agent memory, GitHub actions, or Qwen GPU hosting are provided by this lightweight compatibility layer.
- Current upstream provider and real model are determined by the Railway AI_MODEL configuration; star-ai is an alias, not proof of Qwen.
- Separate long secret; 20 requests/hour and 2 concurrent requests by default, overridable via STAR_MINIS_MAX_PER_HOUR.
- Fail closed when upstream provider is not configured.
- No deployment or external domain has been created by this change.

Tests: node --test test/minis-api.test.js

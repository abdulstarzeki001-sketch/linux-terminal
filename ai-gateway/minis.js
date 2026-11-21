'use strict';
// OpenAI chat-completions facade for the existing private STAR AI Gateway.
// This does not add GPU hosting or bypass upstream provider requirements.
const crypto = require('node:crypto');
const MODEL_ID = 'star-ai';
const MAX_BODY_BYTES = 65536;
const MAX_PROMPT = 4000;

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || right.length < 32) return false;
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}
function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
function apiError(res, status, code, message) {
  json(res, status, {error: {message, type: 'api_error', code}});
}
function normalizePrompt(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 32) return null;
  let hasUser = false;
  const parts = [];
  for (const message of messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim()) return null;
    if (message.role === 'user') hasUser = true;
    parts.push(message.role.toUpperCase() + ': ' + message.content);
  }
  if (!hasUser) return null;
  const prompt = parts.join('\n\n') + '\n\nASSISTANT:';
  return prompt.length <= MAX_PROMPT ? prompt : null;
}
function createMinisHandler({env = process.env, ask, complete, configured}) {
  if ((typeof ask !== 'function' && typeof complete !== 'function') || typeof configured !== 'function')
    throw new TypeError('ask or complete and configured must be functions');
  let since = Date.now(), count = 0, active = 0;
  return async (req, res) => {
    const path = req.url?.split('?')[0];
    if (path !== '/v1/models' && path !== '/v1/chat/completions') {
      apiError(res, 404, 'not_found', 'Endpoint not found'); return;
    }
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    if (!safeEqual(bearer, env.STAR_MINIS_API_KEY)) {
      apiError(res, 401, 'unauthorized', 'Invalid Minis API key'); return;
    }
    if (!configured()) {
      apiError(res, 503, 'model_unavailable', 'STAR AI model provider is not configured'); return;
    }
    if (path === '/v1/models') {
      if (req.method !== 'GET') {
        apiError(res, 405, 'method_not_allowed', 'Use GET'); return;
      }
      json(res, 200, {object: 'list', data: [{id: MODEL_ID, object: 'model', created: 0, owned_by: 'star-ai'}]});
      return;
    }
    if (req.method !== 'POST') {
      apiError(res, 405, 'method_not_allowed', 'Use POST'); return;
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      apiError(res, 415, 'invalid_content_type', 'Expected application/json'); return;
    }
    let body;
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
          apiError(res, 413, 'request_too_large', 'Request too large'); return;
        }
      }
      body = JSON.parse(raw);
    } catch (_) {
      apiError(res, 400, 'invalid_json', 'Invalid JSON request'); return;
    }
    if (body?.model !== MODEL_ID) {
      apiError(res, 400, 'unknown_model', 'Select the model ID star-ai'); return;
    }
    const prompt = typeof complete === 'function' ? null : normalizePrompt(body.messages);
    if (typeof complete !== 'function' && !prompt) {
      apiError(res, 400, 'invalid_messages', 'Provide up to 32 text messages within 4000 characters'); return;
    }
    if (Date.now() - since >= 3600000) { since = Date.now(); count = 0; }
    const limit = Math.max(1, Math.min(60, Number(env.STAR_MINIS_MAX_PER_HOUR) || 20));
    if (count >= limit || active >= 2) {
      apiError(res, 429, 'rate_limited', 'STAR AI rate limit reached'); return;
    }
    count++; active++;
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
    try {
      const completion = typeof complete === 'function' ? await complete(body, {signal: ctrl.signal}) : null;
      const answer = completion ? completion.message?.content : await ask(prompt, {signal: ctrl.signal});
      const message = completion?.message || {role:'assistant',content:answer};
      const finish = completion?.finish_reason || 'stop';
      if ((!answer || typeof answer !== 'string') && !message.tool_calls?.length) throw new Error('empty');
      if (res.writableEnded || res.destroyed) return;
      const base = {id: 'chatcmpl-' + crypto.randomBytes(8).toString('hex'), created: Math.floor(Date.now()/1000), model: MODEL_ID};
      if (body.stream === true) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-store',
          'X-Accel-Buffering': 'no',
        });
        const delta = {role:'assistant', ...(message.content?{content:message.content}:{}), ...(message.tool_calls?.length?{tool_calls:message.tool_calls.map((tc,index)=>({index,...tc}))}:{})};
        res.write('data: ' + JSON.stringify({...base, object: 'chat.completion.chunk', choices: [{index: 0, delta, finish_reason: null}]}) + '\n\n');
        res.write('data: ' + JSON.stringify({...base, object: 'chat.completion.chunk', choices: [{index: 0, delta: {}, finish_reason: finish}]}) + '\n\n');
        res.end('data: [DONE]\n\n');
      } else {
        json(res, 200, {...base, object: 'chat.completion', choices: [{index: 0, message, finish_reason: finish}]});
      }
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) {
        // Never expose the upstream API key, provider URL, or raw exception.
        const code = /^AI_[A-Z_]+$/.test(error?.message || '') ? error.message : 'AI_UPSTREAM_ERROR';
        const statuses = {
          AI_AUTH_FAILED:503, AI_BILLING_REQUIRED:402,
          AI_QUOTA_EXCEEDED:429, AI_RATE_LIMIT:429,
          AI_MODEL_ERROR:424, AI_REQUEST_REJECTED:424,
          AI_TIMEOUT:504
        };
        const descriptions = {
          AI_AUTH_FAILED:'Upstream model API key rejected; check AI_API_KEY on Railway',
          AI_BILLING_REQUIRED:'Upstream model billing is required',
          AI_QUOTA_EXCEEDED:'Upstream model quota or credits exhausted',
          AI_RATE_LIMIT:'Upstream provider rate limit reached',
          AI_MODEL_ERROR:'Upstream model is unavailable; check AI_MODEL on Railway',
          AI_REQUEST_REJECTED:'Upstream provider rejected the request format or model settings',
          AI_NETWORK_ERROR:'Upstream model network error',
          AI_TIMEOUT:'Upstream model timed out',
          AI_UPSTREAM_ERROR:'Upstream model provider is unavailable'
        };
        const status=statuses[code]||502;
        // Error codes only. Never log API keys, request text or raw provider errors.
        console.warn('[STAR AI] Minis provider failure:',code,'client HTTP',status);
        apiError(res,status,code,descriptions[code]||'Upstream model provider is unavailable');
      }
    } finally { active--; }
  };
}
module.exports = {createMinisHandler, normalizePrompt, safeEqual};

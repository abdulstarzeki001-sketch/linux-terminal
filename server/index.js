'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const {isConfigured,checkAIStatus,askAI,MAX_PROMPT} = require('./ai');
const {originGuardConfig,permitOriginRequest} = require('./edge-guard');
const fs=require('node:fs');
const {latestSnapshot}=require('./backup-export');

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.TERMINAL_PASSWORD || '';
const IDLE_MINUTES = Number(process.env.IDLE_MINUTES || 30);
const MAX_SESSION_MINUTES = Number(process.env.MAX_SESSION_MINUTES || 120);
const SHELL_HOME = process.env.TERMINAL_HOME || '/home/tuser';
const MAX_AUTH_FAILURES = 3;
const EDGE = originGuardConfig();
if (!EDGE.ready) {
  console.error('TERMINAL_EDGE_MODE=enforce requires a server-side origin secret of at least 32 characters.');
  process.exit(1);
}

if (PASSWORD.length < 12) {
  console.error('TERMINAL_PASSWORD must be set and be at least 12 characters long.');
  process.exit(1);
}

// Compare hashes with a constant-time check so the password length or content does not leak via timing.
const PASSWORD_HASH = crypto.createHash('sha256').update(PASSWORD).digest();
function checkPassword(candidate) {
  if (typeof candidate !== 'string') return false;
  const hash = crypto.createHash('sha256').update(candidate).digest();
  return crypto.timingSafeEqual(hash, PASSWORD_HASH);
}

// The shell gets an explicit allowlist of environment variables.
// TERMINAL_PASSWORD must never reach the shell.
function shellEnv() {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: SHELL_HOME,
    USER: 'tuser',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

const app = express();
app.disable('x-powered-by');
// Keep a credentials-free health endpoint for Railway; protect all other HTTP routes.
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
  if (!permitOriginRequest(req, EDGE)) return res.status(403).type('text/plain').send('Origin authentication required');
  next();
});
// Snapshot export is deliberately disabled unless the private origin guard is
// enforced. Cloudflare Access additionally requires the owner's session.
app.get('/api/snapshots/latest', (req,res) => {
  if (!EDGE.enforced) return res.status(503).json({code:'EDGE_GUARD_REQUIRED'});
  let snapshot;
  try {snapshot=latestSnapshot(path.join(SHELL_HOME,'backups'));}
  catch (_) {return res.status(503).json({code:'SNAPSHOT_UNAVAILABLE'});}
  if (!snapshot) return res.status(404).json({code:'SNAPSHOT_NOT_FOUND'});
  res.set({
    'Cache-Control':'private, no-store, max-age=0',
    'Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'X-Star-Snapshot-Name':snapshot.name
  });
  return res.download(snapshot.fullPath,snapshot.name,{dotfiles:'deny',acceptRanges:false},err=>{
    if(err && !res.headersSent)res.status(503).json({code:'SNAPSHOT_UNAVAILABLE'});
  });
});
app.use(express.static(path.join(__dirname, '..', 'web')));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  let urlPath = '';
  try { urlPath = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { /* invalid upgrade path */ }
  if (urlPath !== '/ws' || !permitOriginRequest(req,EDGE) ||
      (EDGE.enforced && req.headers.origin !== 'https://terminal-production-fb16bd35.up.railway.app')) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});

wss.on('connection', (ws) => {
  let authed = false;
  let failures = 0;
  let term = null;
  let idleTimer = null;
  let maxTimer = null;
  let aiPending = false;
  let aiAbort = null;
  let aiRequests = 0;
  let lastAIAt = 0;

  const cleanup = () => {
    aiAbort?.abort();
    aiAbort = null;
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    if (term) {
      try { term.kill(); } catch (_) { /* already exited */ }
      term = null;
    }
  };

  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      send(ws, { type: 'info', data: '\r\n[انتهت الجلسة بسبب عدم النشاط]\r\n' });
      ws.close();
    }, IDLE_MINUTES * 60 * 1000);
  };

  const startShell = () => {
    term = pty.spawn('/bin/bash', ['-l'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: SHELL_HOME,
      env: shellEnv(),
    });
    term.onData((data) => send(ws, { type: 'output', data }));
    term.onExit(() => ws.close());

    maxTimer = setTimeout(() => {
      send(ws, { type: 'info', data: '\r\n[انتهى الحد الأقصى لمدة الجلسة]\r\n' });
      ws.close();
    }, MAX_SESSION_MINUTES * 60 * 1000);

    resetIdle();
    send(ws, { type: 'ready', aiEnabled:isConfigured() });
    void reportAIStatus();
  };

  // Only send private gateway readiness to clients already authenticated.
  function reportAIStatus(){
    return checkAIStatus().then(result=>{
      if(authed&&ws.readyState===ws.OPEN)send(ws,{type:'ai_status',...result});
    }).catch(()=>{
      if(authed&&ws.readyState===ws.OPEN)
        send(ws,{type:'ai_status',ready:false,reason:'GATEWAY_UNREACHABLE'});
    });
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }

    if (!authed) {
      if (msg.type !== 'auth') return;
      if (!checkPassword(msg.password)) {
        failures += 1;
        send(ws, { type: 'error', message: 'كلمة المرور غير صحيحة' });
        if (failures >= MAX_AUTH_FAILURES) ws.close();
        return;
      }
      authed = true;
      startShell();
      return;
    }

    if (!term) return;

    if(msg.type==='ai_check'){
      void reportAIStatus();
      return;
    }
    // AI access is available ONLY to the already-authenticated shell session.
    // All AI requests are advisory: they never write anything to the PTY.
    if (msg.type === 'ai_chat') {
      if (!isConfigured()) {
        send(ws,{type:'ai_error',message:'المساعد غير مهيأ. أضف متغيرات AI في Railway.'});
        return;
      }
      if (typeof msg.prompt !== 'string' || !msg.prompt.trim() ||
          msg.prompt.length > MAX_PROMPT) {
        send(ws,{type:'ai_error',message:'اكتب سؤالاً لا يتجاوز 4000 حرف.'});
        return;
      }
      if (aiPending) {
        send(ws,{type:'ai_error',message:'يوجد طلب AI قيد التنفيذ حالياً.'});
        return;
      }
      // Bounded token costs per authenticated session, with a short cooldown.
      if (aiRequests >= 25 || Date.now() - lastAIAt < 2500) {
        send(ws,{type:'ai_error',message:'بلغت حد الطلبات أو أرسلت بسرعة كبيرة. جرّب لاحقاً.'});
        return;
      }
      aiRequests++;
      lastAIAt=Date.now();
      aiPending=true;
      aiAbort=new AbortController();
      resetIdle();
      send(ws,{type:'ai_busy'});
      askAI(msg.prompt,{signal:aiAbort.signal}).then(answer=>{
        send(ws,{type:'ai_reply',text:answer});
      }).catch(error=>{
        const messages={
          AI_NOT_CONFIGURED:'المساعد غير مهيأ.',
          AI_AUTH_FAILED:'مفتاح OpenAI API غير صالح أو لا يملك الصلاحية المطلوبة. راجع AI_API_KEY بخدمة Gateway.',
          AI_GATEWAY_AUTH_FAILED:'رمز الربط AI_GATEWAY_TOKEN غير متطابق بين Terminal وGateway.',
          AI_RATE_LIMIT:'تم تجاوز معدل الطلبات المسموح. حاول لاحقاً.',
          AI_QUOTA_EXCEEDED:'رصيد OpenAI API غير كافٍ أو الحصة انتهت. راجع Billing وUsage.',
          AI_BILLING_REQUIRED:'تحتاج إلى إعداد الفوترة أو رصيد API.',
          AI_MODEL_ERROR:'اسم AI_MODEL غير صالح، أو النموذج غير متاح للمفتاح، أو إعداد الطلب غير مدعوم.',
          AI_TIMEOUT:'انتهت مهلة الاتصال بمزود الذكاء الاصطناعي.',
          AI_UPSTREAM_UNAVAILABLE:'OpenAI أو Gateway غير متاح الآن؛ راجع سجلات Railway.',
          AI_EMPTY_RESPONSE:'لم يرجع النموذج نصاً.',
          AI_INVALID_INPUT:'السؤال غير صالح.'
        };
        const code=/^AI_[A-Z_]+$/.test(error?.message||'')?error.message:'AI_NETWORK_ERROR';
        console.warn('[STAR AI terminal] Request failed:',code);
        send(ws,{type:'ai_error',message:messages[code]||'فشل اتصال AI. راجع خدمة Gateway على Railway.'});
      }).finally(()=>{aiPending=false;aiAbort=null;});
      return;
    }

    if (msg.type === 'input' && typeof msg.data === 'string') {
      resetIdle();
      term.write(msg.data);
    } else if (msg.type === 'resize') {
      const cols = Math.min(Math.max(Number(msg.cols) || 80, 10), 500);
      const rows = Math.min(Math.max(Number(msg.rows) || 24, 5), 200);
      term.resize(cols, rows);
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Terminal listening on port ${PORT}`);
  // Free internal readiness probe: no provider API request, prompt, or credentials.
  // A delayed check allows Railway's private networking to initialize.
  setTimeout(()=>{
    void checkAIStatus().then(status=>{
      console.info('[STAR AI preflight]',status.reason);
    }).catch(()=>console.warn('[STAR AI preflight] GATEWAY_UNREACHABLE'));
  },5000).unref();
  // Run safe read-only diagnostics and at most one real AI smoke query per volume.
  setTimeout(()=>require('./boot-audit').startBootAudit(),12000).unref();
});

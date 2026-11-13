'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.TERMINAL_PASSWORD || '';
const IDLE_MINUTES = Number(process.env.IDLE_MINUTES || 30);
const MAX_SESSION_MINUTES = Number(process.env.MAX_SESSION_MINUTES || 120);
const SHELL_HOME = process.env.TERMINAL_HOME || '/home/tuser';
const MAX_AUTH_FAILURES = 3;
const MAX_CONNECTIONS = 3;
const AUTH_TIMEOUT_MS = 15 * 1000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_FAILURES_PER_ADDRESS = 12;
const failuresByAddress = new Map();
const connections = new Set();

function getFailureState(address) {
  const now = Date.now();
  let state = failuresByAddress.get(address);
  if (!state || now - state.start > AUTH_WINDOW_MS) {
    state = { start: now, count: 0 };
    failuresByAddress.set(address, state);
  }
  // Bound the in-memory table even when a reverse proxy sends many addresses.
  if (failuresByAddress.size > 1000) {
    for (const [key, value] of failuresByAddress) {
      if (now - value.start > AUTH_WINDOW_MS) failuresByAddress.delete(key);
    }
  }
  return state;
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
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'web')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
}

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { return rejectUpgrade(socket, 400, 'Bad Request'); }

  if (pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');

  // The browser must connect from this site's own origin. Do not trust
  // X-Forwarded-* headers supplied by an untrusted client for this check.
  let origin;
  try { origin = new URL(req.headers.origin); }
  catch { return rejectUpgrade(socket, 403, 'Forbidden'); }
  if (!['https:', 'http:'].includes(origin.protocol) ||
      origin.host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) {
    return rejectUpgrade(socket, 403, 'Forbidden');
  }

  if (connections.size >= MAX_CONNECTIONS) {
    return rejectUpgrade(socket, 503, 'Service Unavailable');
  }

  // Use the socket peer rather than caller-controlled forwarding headers.
  const address = req.socket.remoteAddress || 'unknown';
  if (getFailureState(address).count >= MAX_AUTH_FAILURES_PER_ADDRESS) {
    return rejectUpgrade(socket, 429, 'Too Many Requests');
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.clientAddress = address;
    connections.add(ws);
    ws.once('close', () => connections.delete(ws));
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  let authed = false;
  let failures = 0;
  let term = null;
  let idleTimer = null;
  let maxTimer = null;
  const authTimer = setTimeout(() => ws.close(1008, 'Authentication timeout'), AUTH_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(authTimer);
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
    try {
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
    send(ws, { type: 'ready' });
    } catch (error) {
      console.error('Unable to start terminal:', error.message);
      send(ws, { type: 'error', message: 'تعذر تشغيل الطرفية' });
      ws.close(1011, 'Terminal unavailable');
    }
  };

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
        const record = getFailureState(ws.clientAddress);
        record.count += 1;
        send(ws, { type: 'error', message: 'كلمة المرور غير صحيحة' });
        if (failures >= MAX_AUTH_FAILURES ||
            record.count >= MAX_AUTH_FAILURES_PER_ADDRESS) ws.close();
        return;
      }
      authed = true;
      clearTimeout(authTimer);
      // Successful login clears recent failures for this peer.
      failuresByAddress.delete(ws.clientAddress);
      startShell();
      return;
    }

    if (!term) return;

    if (msg.type === 'input' && typeof msg.data === 'string' && msg.data.length <= 8192) {
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
});

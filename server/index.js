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
app.use(express.static(path.join(__dirname, '..', 'web')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  let authed = false;
  let failures = 0;
  let term = null;
  let idleTimer = null;
  let maxTimer = null;

  const cleanup = () => {
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
    send(ws, { type: 'ready' });
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
        send(ws, { type: 'error', message: 'كلمة المرور غير صحيحة' });
        if (failures >= MAX_AUTH_FAILURES) ws.close();
        return;
      }
      authed = true;
      startShell();
      return;
    }

    if (!term) return;

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
});

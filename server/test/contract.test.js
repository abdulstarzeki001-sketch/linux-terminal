'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { before, after } = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const path = require('node:path');
const WebSocket = require('ws');

const entry = path.join(__dirname, '..', 'index.js');
const port = 20000 + Math.floor(Math.random() * 30000);
const origin = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const strongPassword = 'only-for-ci-not-a-deployment-password';
let processHandle;
let logs = '';

test('fails closed when password is not configured', () => {
  const result = spawnSync(process.execPath, [entry], {
    env: { ...process.env, TERMINAL_PASSWORD: 'short', PORT: String(port) },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TERMINAL_PASSWORD/);
});

before(async () => {
  processHandle = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      TERMINAL_PASSWORD: strongPassword,
      TERMINAL_HOME: process.cwd(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle.stderr.on('data', chunk => { logs += chunk.toString(); });
  processHandle.stdout.on('data', chunk => { logs += chunk.toString(); });
  for (let i = 0; i < 100; i++) {
    if (processHandle.exitCode !== null) {
      throw new Error('Terminal server exited before ready: ' + logs);
    }
    try {
      const response = await fetch(origin + '/health');
      if (response.ok) return;
    } catch { /* startup */ }
    await sleep(100);
  }
  throw new Error('Terminal server did not become healthy: ' + logs);
});

after(() => { if (processHandle) processHandle.kill(); });

test('health endpoint returns JSON', async () => {
  const response = await fetch(origin + '/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('cross-origin WebSocket upgrade is denied', async () => {
  const responseCode = await new Promise((resolve, reject) => {
    const client = new WebSocket(wsUrl, { origin: 'https://not-your-terminal.example' });
    const deadline = setTimeout(() => {
      client.terminate();
      reject(new Error('Timed out waiting for cross-origin rejection'));
    }, 5000);
    client.on('unexpected-response', (_request, response) => {
      clearTimeout(deadline);
      response.resume();
      resolve(response.statusCode);
    });
    client.on('open', () => {
      clearTimeout(deadline);
      client.close();
      reject(new Error('Cross-origin WebSocket unexpectedly accepted'));
    });
    client.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
  });
  assert.equal(responseCode, 403);
});

test('valid origin and password establish an interactive session', async () => {
  const client = new WebSocket(wsUrl, { origin });
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      client.terminate();
      reject(new Error('Timed out waiting for terminal ready'));
    }, 10000);
    client.on('open', () => {
      client.send(JSON.stringify({ type: 'auth', password: strongPassword }));
    });
    client.on('message', raw => {
      const data = JSON.parse(raw.toString());
      if (data.type === 'ready') {
        clearTimeout(deadline);
        resolve(true);
      } else if (data.type === 'error') {
        clearTimeout(deadline);
        reject(new Error(data.message));
      }
    });
    client.on('error', error => {
      clearTimeout(deadline);
      reject(error);
    });
    client.on('close', () => {
      clearTimeout(deadline);
    });
  });
  assert.equal(await ready, true);
  client.close();
});

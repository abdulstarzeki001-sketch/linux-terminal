'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {authorizedOrigin} = require('../server/edge-guard');

const secret = 'dev-only-edge-origin-secret-0123456789-abcd';
test('edge authentication allows only the exact server-side secret',()=>{
  assert.equal(authorizedOrigin(secret,secret),true);
  assert.equal(authorizedOrigin(secret.slice(0,-1)+'X',secret),false);
  assert.equal(authorizedOrigin('',secret),false);
  assert.equal(authorizedOrigin(['header','spoof'],secret),false);
  assert.equal(authorizedOrigin(secret,'short'),false);
  assert.equal(authorizedOrigin(null,secret),false);
  assert.equal(authorizedOrigin(secret+'suffix',secret),false);
});
test('Railway edge gate covers HTTP and WebSocket; health remains unauthenticated',()=>{
  const s = fs.readFileSync(require.resolve('../server/index.js'),'utf8');
  assert.match(s,/TERMINAL_EDGE_MODE === 'enforce'/);
  assert.match(s,/if \(!gate\(req\)\) return res\.status\(403\)/);
  assert.match(s,/const wss = new WebSocketServer\(\{ noServer: true/);
  assert.match(s,/pathname !== '\/ws' \|\| !gate\(req\)/);
  assert.ok(s.indexOf("app.get('/health'") < s.indexOf("app.use((req, res, next)"));
  assert.ok(s.indexOf("app.use((req, res, next)") < s.indexOf("app.use(express.static"));
  const docker = fs.readFileSync(require.resolve('../Dockerfile'),'utf8');
  assert.match(docker,/COPY server\/edge-guard\.js/);
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {authorizedOrigin,originGuardConfig,permitOriginRequest}=require('../server/edge-guard');

const secret='unit-test-only-origin-key-0123456789abcdefghijkl';
test('private origin secret is required when enforcement is enabled',()=>{
  assert.equal(originGuardConfig({TERMINAL_EDGE_MODE:'enforce'}).ready,false);
  assert.equal(originGuardConfig({TERMINAL_EDGE_MODE:'enforce',TERMINAL_EDGE_ORIGIN_SECRET:'weak'}).ready,false);
  assert.equal(originGuardConfig({TERMINAL_EDGE_MODE:'enforce',TERMINAL_EDGE_ORIGIN_SECRET:secret}).ready,true);
  assert.equal(originGuardConfig({}).ready,true);
});
test('origin credential comparison is strict and uses fixed-length digests',()=>{
  assert.equal(authorizedOrigin(secret,secret),true);
  assert.equal(authorizedOrigin(secret+'x',secret),false);
  assert.equal(authorizedOrigin('x'+secret.slice(1),secret),false);
  assert.equal(authorizedOrigin(null,secret),false);
  assert.equal(authorizedOrigin([secret],secret),false);
  assert.equal(authorizedOrigin(secret,'tiny'),false);
  assert.equal(authorizedOrigin('a'.repeat(5000),secret),false);
});
test('direct Railway clients are rejected without the Worker credential',()=>{
  const on=originGuardConfig({TERMINAL_EDGE_MODE:'enforce',TERMINAL_EDGE_ORIGIN_SECRET:secret});
  const off=originGuardConfig({});
  const request=headers=>({headers});
  assert.equal(permitOriginRequest(request({}),on),false);
  assert.equal(permitOriginRequest(request({'x-star-edge-origin':'wrong'}),on),false);
  assert.equal(permitOriginRequest(request({'x-star-edge-origin':secret}),on),true);
  assert.equal(permitOriginRequest(request({}),off),true);
});
test('server applies shared origin guard before serving web UI and before WebSocket',()=>{
  const src=readFileSync(require.resolve('../server/index.js'),'utf8');
  const docker=readFileSync(require.resolve('../Dockerfile'),'utf8');
  assert.match(src,/app\.get\('\/health'/);
  assert.match(src,/if \(!permitOriginRequest\(req, EDGE\)\) return res\.status\(403\)/);
  assert.match(src,/new WebSocketServer\(\{ noServer: true/);
  assert.match(src,/urlPath !== '\/ws' \|\| !permitOriginRequest\(req,EDGE\)/);
  assert.match(src,/server\.on\('upgrade'/);
  assert.ok(src.indexOf("app.get('/health'") < src.indexOf("app.use((req, res, next)"));
  assert.ok(src.indexOf("app.use((req, res, next)") < src.indexOf("app.use(express.static"));
  assert.match(docker,/COPY server\/edge-guard\.js/);
});

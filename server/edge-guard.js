'use strict';
// The public Railway domain must never authorize a browser terminal session
// without a second private credential delivered only by the owner-gated Worker.
const crypto = require('node:crypto');

function authorizedOrigin(candidate, expected) {
  if (typeof candidate !== 'string' ||
      typeof expected !== 'string' || expected.length < 32 ||
      candidate.length > 4096) return false;
  const a = crypto.createHash('sha256').update(candidate,'utf8').digest();
  const b = crypto.createHash('sha256').update(expected,'utf8').digest();
  return crypto.timingSafeEqual(a,b);
}

function originGuardConfig(env=process.env) {
  const enforced = env.TERMINAL_EDGE_MODE === 'enforce';
  const secret = typeof env.TERMINAL_EDGE_ORIGIN_SECRET === 'string'
    ? env.TERMINAL_EDGE_ORIGIN_SECRET : '';
  return {enforced,secret,ready:!enforced||secret.length>=32};
}

function permitOriginRequest(req, config) {
  return !config.enforced || authorizedOrigin(req.headers['x-star-edge-origin'],config.secret);
}

module.exports={authorizedOrigin,originGuardConfig,permitOriginRequest};

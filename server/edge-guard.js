'use strict';

// Constant-time hashed comparison of the one server-to-server origin secret.
// This secret is never sent to the browser or forwarded into interactive shells.
const crypto = require('node:crypto');

function authorizedOrigin(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const left = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const right = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

module.exports = { authorizedOrigin };

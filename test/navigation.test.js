'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, '..', 'web', 'index.html'), 'utf8');

test('Railway terminal shows a direct, safe return link to Wormstar AI Lab', () => {
  assert.match(html, /href="https:\/\/wormstar-ai-lab\.abdulstarzeki001\.workers\.dev\/"/);
  assert.match(html, /class="back-to-wormstar"/);
  assert.match(html, /aria-label="العودة إلى Wormstar AI Lab"/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(html, /wormstar-ai-lab\.abdulstarzeki001\.workers\.dev\/\?[^"]*(?:token|password|key)=/i);
});

test('Return link persists on both password login and connected terminal screens', () => {
  const header = html.indexOf('<header class="site-header">');
  const login = html.indexOf('<div id="login">');
  const terminal = html.indexOf('<div id="term">');
  assert.ok(header > 0 && header < login && login < terminal);
  assert.match(html, /\.site-header\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(html, /@media \(max-width: 520px\)/);
});

test('Password gate remains in the Railway page and is not bypassed', () => {
  assert.match(html, /id="pw" type="password"/);
  assert.match(html, /id="go">دخول/);
  assert.match(html, /src="\/app\.js"/);
  assert.doesNotMatch(html, /location\.replace\(|window\.location\s*=/);
});

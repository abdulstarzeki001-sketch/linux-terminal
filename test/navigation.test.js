'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const web = join(__dirname,'..','web');
const html = readFileSync(join(web,'index.html'),'utf8');
const css = readFileSync(join(web,'neon.css'),'utf8');
const js = readFileSync(join(web,'app.js'),'utf8');

test('Railway Neon page retains secure return to Wormstar on every screen',()=>{
  assert.match(html,/href="https:\/\/wormstar-ai-lab\.abdulstarzeki001\.workers\.dev\/"/);
  assert.match(html,/class="back-to-wormstar"/);
  assert.match(html,/aria-label="العودة إلى Wormstar AI Lab"/);
  assert.match(html,/referrerpolicy="no-referrer"/);
  assert.ok(html.indexOf('class="site-header"') < html.indexOf('id="login"'));
  assert.ok(html.indexOf('id="login"') < html.indexOf('id="term"'));
  assert.match(css,/\.site-header\s*\{/);
  assert.match(css,/@media\(max-width:650px\)/);
});

test('Real Railway password gate and xterm backend are not bypassed',()=>{
  assert.match(html,/id="pw" type="password"/);
  assert.match(html,/id="go" type="button">دخول/);
  assert.match(html,/src="\/app\.js" defer/);
  assert.match(html,/src="https:\/\/cdn\.jsdelivr\.net\/npm\/@xterm\/xterm@5\.5\.0\/lib\/xterm\.js"/);
  assert.match(js,/new WebSocket\(/);
  assert.match(js,/type:'auth', password:secret/);
  assert.match(js,/term\.onData\(data\s*=>\s*send\(\{type:'input',data\}\)\)/);
  assert.match(js,/new window\.Terminal\(/);
  assert.doesNotMatch(js,/const CMD\s*=|const S\s*=|function fsResolve\(|virtual filesystem|neofetch\(\)/i);
  assert.doesNotMatch(html,/id="termInput"/);
});

test('Theme/motion controls are supported without persisting sensitive terminal data',()=>{
  for(const name of ['neon','catppuccin','dracula','tokyo','gruvbox']){
    assert.match(html,new RegExp('value="'+name+'"'));
    if(name!=='neon')assert.ok(css.includes('body.theme-'+name));
  }
  for(const id of ['matrixToggle','soundToggle','copyOutput','clearOutput','disconnect','connectionPill']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/height:100dvh/);
  assert.match(js,/coarsePointer/);
  assert.match(js,/document\.hidden/);
  assert.match(js,/requestAnimationFrame/);
  assert.match(js,/\bterm\.clear\(\)/);
  assert.match(js,/term\.buffer\.active/);
  assert.doesNotMatch(js,/localStorage\.setItem\(['"](?:nt_history|nt_fs|password|token)/);
  assert.doesNotMatch(js,/sessionStorage/);
  assert.match(js,/password\.value = ''/);
});

test('Display content cannot invoke arbitrary HTML or browser commands',()=>{
  assert.doesNotMatch(js,/\.innerHTML\s*=/);
  assert.doesNotMatch(js,/eval\s*\(|new Function\(/);
  assert.doesNotMatch(html,/on(?:click|load|error)="|<iframe/i);
  assert.doesNotMatch(html,/\?(?:token|password|key)=/);
});

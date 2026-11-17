'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {TOOLS,hasExecutable,makeReport,runLiveCheck}=require('../server/boot-audit');

test('read-only audit checks fixed tool allowlist and local disk stats',()=>{
  assert.ok(TOOLS.includes('python3'));
  assert.ok(TOOLS.includes('tshark'));
  assert.equal(hasExecutable('python3;cat /secrets'),false);
  const report=makeReport(os.tmpdir());
  assert.equal(report.kind,'readonly_runtime');
  assert.equal(typeof report.tools.node,'boolean');
  assert.ok(Number.isInteger(report.disk.availableMiB));
  assert.ok(report.disk.availableMiB>=0);
  assert.ok(!JSON.stringify(report).includes('AI_API_KEY'));
});
test('AI smoke performs one safe request with no response or secret in logs',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wormstar-audit-'));
  const logs=[];let count=0;
  try {
    const args={
      root,
      healthFn:async()=>({ready:true,reason:'GATEWAY_READY'}),
      answerFn:async(prompt)=>{count++;assert.match(prompt,/READY/);return 'SECRET-SIMULATED-ANSWER';},
      logger:line=>logs.push(line),
      warn:line=>logs.push(line)
    };
    assert.equal((await runLiveCheck(args)).state,'SUCCESS');
    assert.equal((await runLiveCheck(args)).state,'ALREADY_ATTEMPTED');
    assert.equal(count,1);
    assert.ok(!logs.join(' ').includes('SECRET-SIMULATED-ANSWER'));
    assert.ok(!logs.join(' ').includes('AI_GATEWAY_TOKEN'));
    const marker=path.join(root,'.config','wormstar','ai-smoke-v4.attempted');
    assert.ok(fs.existsSync(marker));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('AI smoke safely categorizes provider failure and skips unready gateway',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wormstar-audit-'));
  const messages=[];
  try {
    const skipped=await runLiveCheck({
      root,
      healthFn:async()=>({ready:false,reason:'GATEWAY_NOT_CONFIGURED'}),
      answerFn:async()=>{throw Error('must not call provider');},
      logger:m=>messages.push(m),warn:m=>messages.push(m)
    });
    assert.equal(skipped.state,'NOT_READY');
    const failed=await runLiveCheck({
      root,
      healthFn:async()=>({ready:true,reason:'GATEWAY_READY'}),
      answerFn:async()=>{throw Error('AI_QUOTA_EXCEEDED');},
      logger:m=>messages.push(m),warn:m=>messages.push(m)
    });
    assert.equal(failed.state,'AI_QUOTA_EXCEEDED');
    assert.ok(messages.some(m=>m.includes('AI_QUOTA_EXCEEDED')));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

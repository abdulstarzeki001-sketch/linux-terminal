'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const engine=require('../server/training-engine');

test('all 8 lab evidence files are readable and grades derive from them',()=>{
 assert.equal(engine.LABS.length,8);
 assert.equal(engine.publicLabs().length,8);
 for(const lab of engine.publicLabs()){
   assert.equal(lab.fields.length,2);
   assert.ok(lab.command.length>8);
   const expected=engine.getExpected(lab.id);
   assert.equal(expected.length,2);
   assert.ok(expected.every(v=>typeof v==='string'&&v.length>0));
   if(lab.mode==='fixture'){
     assert.ok(lab.evidence.length>25);
     assert.match(lab.source,/تدريبي/);
   } else {
     assert.equal(lab.id,'W01');
     assert.equal(lab.evidence,null);
     assert.match(lab.source,/الفعلي/);
   }
 }
});
test('wrong answers do not complete a week; server-verified results persist',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-training-'));
 const filename=path.join(dir,'state.json');
 const save=state=>engine.writeState(state,filename);
 try{
   let state=engine.readState(filename);
   assert.equal(engine.publicStatus(state).percent,0);
   let attempt=engine.verify({week:'W02',answers:{a:'invalid',b:'wrong'}},state,save);
   assert.equal(attempt.httpStatus,200);
   assert.equal(attempt.passed,false);
   assert.equal(attempt.score,0);
   assert.equal(engine.readState(filename).weeks.W02.attempts,1);
   assert.equal(engine.publicStatus(engine.readState(filename)).completed,0);
   const answers=engine.getExpected('W02');
   state=engine.readState(filename);
   attempt=engine.verify({week:'W02',answers:{a:answers[0],b:answers[1]}},state,save);
   assert.equal(attempt.passed,true);
   assert.equal(attempt.score,100);
   assert.equal(attempt.summary.completed,1);
   assert.equal(attempt.summary.percent,13);
   assert.ok(engine.readState(filename).weeks.W02.verifiedAt);
   state=engine.readState(filename);
   attempt=engine.verify({week:'W02',answers:{a:'invalid',b:'wrong'}},state,save);
   assert.equal(attempt.summary.completed,1); // a retry cannot erase earned evidence
   assert.equal(attempt.summary.weeks.find(x=>x.id==='W02').attempts,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('complete all eight lab checks, including real Linux runtime evidence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'star-training-all-'));
 const filename=path.join(dir,'state.json');
 try{
   for(const lab of engine.LABS){
     const state=engine.readState(filename);
     const [a,b]=engine.getExpected(lab.id);
     const result=engine.verify({week:lab.id,answers:{a,b}},state,x=>engine.writeState(x,filename));
     assert.equal(result.passed,true,lab.id);
   }
   const status=engine.publicStatus(engine.readState(filename));
   assert.equal(status.completed,8);
   assert.equal(status.percent,100);
   assert.ok(status.weeks.every(x=>x.verified===true));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('training grader is strict, bounded, and never executes supplied commands',()=>{
 const state={schema:1,weeks:{}};
 const noSave=()=>{throw Error('invalid input must not write');};
 for(const payload of [
  {week:'W09',answers:{a:'x',b:'y'}},
  {week:'W01',answers:{a:'',b:4}},
  {week:'W02',answers:{a:'X'.repeat(121),b:'hi'}},
  {week:'W03',answers:['x','y']},
  {week:'W01',command:'curl https://example.com'}
 ]){
   assert.equal(engine.verify(payload,state,noSave).httpStatus,400);
 }
 const expected=engine.getExpected('W07');
 const result=engine.verify({week:'W07',answers:{a:expected[0],b:'0'}},state,()=>{});
 assert.equal(result.passed,false);assert.equal(result.score,50);
 const code=fs.readFileSync(require.resolve('../server/index.js'),'utf8');
 const docker=fs.readFileSync(require.resolve('../Dockerfile'),'utf8');
 assert.match(code,/app\.post\('\/api\/training\/verify'/);
 assert.match(code,/express\.json\(\{limit:'2kb',strict:true\}\)/);
 assert.match(code,/if\(!EDGE\.enforced\)return res\.status\(503\)/);
 assert.ok(code.indexOf('app.use((req, res, next)')<code.indexOf("app.post('/api/training/status'"));
 assert.match(docker,/COPY server\/training-fixtures \.\/training-fixtures/);
});

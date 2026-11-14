'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source=readFileSync(join(__dirname,'..','web','app.js'),'utf8');

function harness(options={}){
  const nodes=new Map(),prefs=new Map([['wt_ui_matrix','0'],['wt_ui_sound','0']]);
  const modButtons=['ctrl','alt','shift'].map(mod=>({
    dataset:{mod},attrs:{},
    setAttribute(name,value){this.attrs[name]=value;}
  }));
  const get=id=>{
    if(!nodes.has(id)){
      const node={
        id,value:'',textContent:'',disabled:false,dataset:{},style:{},
        events:{},className:'',attrs:{},
        classList:{
          hidden:false,
          add(name){if(name==='hidden')this.hidden=true;},
          remove(name){if(name==='hidden')this.hidden=false;}
        },
        addEventListener(name,callback){this.events[name]=callback;},
        setAttribute(name,value){this.attrs[name]=value;},
        getContext(){return {clearRect(){},fillRect(){},fillText(){}};},
        focus(){this.focused=true;},
        appendChild(child){(this.children ||= []).push(child);},
        replaceChildren(){this.children=[];}
      };
      nodes.set(id,node);
    }
    return nodes.get(id);
  };
  let socket,terminal;
  const viewportVars={};
  const viewportEvents={};
  class WebSocket{
    static OPEN=1;
    constructor(url){this.url=url;this.readyState=0;this.sent=[];socket=this;}
    send(data){this.sent.push(JSON.parse(data));}
    open(){this.readyState=1;this.onopen?.();}
    message(data){this.onmessage?.({data:JSON.stringify(data)});}
    close(){this.readyState=3;this.onclose?.({code:1000});}
  }
  class Terminal{
    constructor(options){
      this.options=options;
      this.dataHandler=null;this.rows=24;this.cols=100;
      this.buffer={active:{length:0,getLine(){return null;}}};
      terminal=this;
    }
    loadAddon(addon){this.addon=addon;}
    open(){this.opened=true;}
    onData(fn){this.dataHandler=fn;}
    onResize(fn){this.resizeHandler=fn;}
    focus(){this.focused=true;}
    write(data){(this.written ||= []).push(data);}
    clear(){this.cleared=true;}
    dispose(){this.disposed=true;}
  }
  class FitAddon{fit(){}}
  const window={
    matchMedia:query=>({matches:Boolean(options.mobile && query.includes('pointer: coarse')),addEventListener(){}}),
    visualViewport:options.mobile?{
      height:760,
      addEventListener(name,callback){viewportEvents[name]=callback;}
    }:undefined,
    requestAnimationFrame:fn=>{fn(0);return 1;},
    cancelAnimationFrame(){},
    innerWidth:1100,innerHeight:800,devicePixelRatio:1,
    addEventListener(){},
    Terminal,
    FitAddon:{FitAddon},
    navigator:{},
  };
  const body={className:'',hidden:false};
  body.classList={
    add(token){
      const items=new Set(body.className.split(/\s+/).filter(Boolean));
      items.add(token);body.className=[...items].join(' ');
    },
    remove(token){
      body.className=body.className.split(/\s+/).filter(x=>x && x!==token).join(' ');
    },
    toggle(token,enabled){
      if(enabled)this.add(token);else this.remove(token);
    },
    contains(token){return body.className.split(/\s+/).includes(token);}
  };
  const document={
    body,hidden:false,
    documentElement:{style:{setProperty(name,value){viewportVars[name]=value;}}},
    getElementById:get,
    createElement:tag=>({tagName:tag.toUpperCase(),className:'',textContent:''}),
    querySelector:()=>({setAttribute(){}}),
    querySelectorAll:selector=>selector==='[data-mod]'?modButtons:[],
    addEventListener(){}
  };
  const context={window,document,WebSocket,Terminal,FitAddon,
    location:{protocol:'https:',host:'terminal.example.com'},
    localStorage:{
      getItem:key=>prefs.has(key)?prefs.get(key):null,
      setItem:(key,value)=>prefs.set(key,value)
    },
    getComputedStyle:()=>({getPropertyValue:()=> '#89b4fa'}),
    setTimeout:()=>2,clearTimeout(){},
    navigator:{clipboard:{writeText:async()=>{},readText:async()=> 'echo hello'}}
  };
  vm.runInNewContext(source,context,{timeout:1000});
  return {get,prefs,window,document,mods:modButtons,viewportVars,viewportEvents,
    key(keyName){
      const button={dataset:{key:keyName},closest:()=>button};
      get('mobileKeys').events.click({target:button});
    },
    modifier(name){
      const button=modButtons.find(x=>x.dataset.mod===name);
      button.closest=()=>button;
      get('mobileKeys').events.click({target:button});
    },
    fn(){
      const button={id:'fnToggle',dataset:{},closest:()=>button};
      get('mobileKeys').events.click({target:button});
    },
    connect:(suppliedPassword='unit-test-only-password')=>{
    get('pw').value=suppliedPassword;
    get('go').events.click();
    return socket;
  },lastTerminal:()=>terminal};
}

test('login creates real WebSocket and sends password only on auth frame',()=>{
  const h=harness();
  const socket=h.connect();
  assert.equal(socket.url,'wss://terminal.example.com/ws');
  assert.equal(h.get('pw').value,'');
  assert.equal(socket.sent.length,0);
  socket.open();
  assert.equal(socket.sent[0].type,'auth');
  assert.equal(socket.sent[0].password,'unit-test-only-password');
  assert.equal(h.prefs.has('wt_ui_password'),false);
  assert.equal(h.get('go').disabled,true);
  socket.message({type:'ready'});
  const terminal=h.lastTerminal();
  assert.ok(terminal.opened);
  assert.ok(terminal.focused);
  terminal.dataHandler('whoami\n');
  assert.equal(socket.sent.at(-1).type,'input');
  assert.equal(socket.sent.at(-1).data,'whoami\n');
  assert.equal(h.get('login').classList.hidden,true);
  assert.equal(h.get('connectionPill').dataset.state,'connected');
  h.get('disconnect').events.click();
  assert.equal(h.get('login').classList.hidden,false);
  assert.ok(terminal.disposed);
});

test('rejected password returns to login with a readable error',()=>{
  const h=harness();
  const socket=h.connect();
  socket.open();
  socket.message({type:'error',message:'كلمة المرور غير صحيحة'});
  assert.equal(h.get('connectionPill').dataset.state,'disconnected');
  assert.match(h.get('err').textContent,/خادم Railway رفض الكلمة/);
  assert.match(h.get('err').textContent,/الملء التلقائي/);
  assert.equal(h.get('login').classList.hidden,false);
});

test('theme switching does not persist command output or secrets',()=>{
  const h=harness();
  h.get('themeSelect').events.change({target:{value:'dracula'}});
  assert.equal(h.document.body.className,'theme-dracula');
  assert.equal(h.prefs.get('wt_ui_theme'),'dracula');
  assert.deepEqual([...h.prefs.keys()].sort(),['wt_ui_matrix','wt_ui_sound','wt_ui_theme']);
});


test('extra keys never send input before authentication, then transmit real PTY sequences',()=>{
  const h=harness();
  assert.equal(h.get('mobileKeys').classList.hidden,true);
  assert.equal(h.get('keysToggle').disabled,true);
  // Calling an extra-key handler before auth must not invoke the server.
  h.key('ctrl-c');
  const socket=h.connect();
  socket.open();
  socket.message({type:'ready'});
  assert.equal(h.get('keysToggle').disabled,false);
  h.get('keysToggle').events.click();
  assert.equal(h.get('mobileKeys').classList.hidden,false);
  assert.equal(h.get('keysToggle').attrs['aria-expanded'],'true');

  h.key('esc');
  assert.equal(socket.sent.at(-1).data,'\x1b');
  h.key('tab');
  assert.equal(socket.sent.at(-1).data,'\t');
  h.key('up');
  assert.equal(socket.sent.at(-1).data,'\x1b[A');
  h.key('left');
  assert.equal(socket.sent.at(-1).data,'\x1b[D');
  h.key('enter');
  assert.equal(socket.sent.at(-1).data,'\r');
  h.key('backspace');
  assert.equal(socket.sent.at(-1).data,'\x7f');
  h.key('home');
  assert.equal(socket.sent.at(-1).data,'\x1b[H');
  h.key('end');
  assert.equal(socket.sent.at(-1).data,'\x1b[F');
  h.key('pageup');
  assert.equal(socket.sent.at(-1).data,'\x1b[5~');
  h.key('pagedown');
  assert.equal(socket.sent.at(-1).data,'\x1b[6~');
  h.key('ctrl-c');
  assert.equal(socket.sent.at(-1).data,'\x03');
  h.key('ctrl-d');
  assert.equal(socket.sent.at(-1).data,'\x04');
  h.key('ctrl-z');
  assert.equal(socket.sent.at(-1).data,'\x1a');
  h.key('ctrl-l');
  assert.equal(socket.sent.at(-1).data,'\x0c');
  h.key('ctrl-r');
  assert.equal(socket.sent.at(-1).data,'\x12');

  h.key('pipe');
  assert.equal(socket.sent.at(-1).data,'|');
  h.key('backslash');
  assert.equal(socket.sent.at(-1).data,'\\');
  h.key('tilde');
  assert.equal(socket.sent.at(-1).data,'~');
  h.key('lt');
  assert.equal(socket.sent.at(-1).data,'<');
  h.key('gt');
  assert.equal(socket.sent.at(-1).data,'>');
  assert.ok(socket.sent.filter(x=>x.type==='input').length>=19);
});

test('Ctrl, Alt and Shift are one-shot modifiers and cannot persist after logout',()=>{
  const h=harness();
  const socket=h.connect();
  socket.open();socket.message({type:'ready'});
  h.modifier('ctrl');
  assert.equal(h.mods.find(x=>x.dataset.mod==='ctrl').attrs['aria-pressed'],'true');
  h.key('letter-r');
  assert.equal(socket.sent.at(-1).data,'\x12');
  assert.equal(h.mods.find(x=>x.dataset.mod==='ctrl').attrs['aria-pressed'],'false');
  h.key('letter-a');
  assert.equal(socket.sent.at(-1).data,'a');

  h.modifier('alt');
  h.key('up');
  assert.equal(socket.sent.at(-1).data,'\x1b[1;3A');
  h.modifier('shift');
  h.key('up');
  assert.equal(socket.sent.at(-1).data,'\x1b[1;2A');
  h.modifier('ctrl');
  h.key('right');
  assert.equal(socket.sent.at(-1).data,'\x1b[1;5C');

  h.modifier('shift');
  h.key('letter-d');
  assert.equal(socket.sent.at(-1).data,'D');
  h.modifier('ctrl');
  h.modifier('alt');
  h.key('letter-c');
  assert.equal(socket.sent.at(-1).data,'\x1b\x03');
  h.get('disconnect').events.click();
  assert.equal(h.get('mobileKeys').classList.hidden,true);
  assert.equal(h.get('keysToggle').disabled,true);
  for (const button of h.mods)assert.equal(button.attrs['aria-pressed'],'false');
});

test('clipboard paste requires a deliberate click and sends only connected input',async()=>{
  const h=harness();
  assert.equal(h.get('pasteClipboard').disabled,true);
  const socket=h.connect();
  socket.open();socket.message({type:'ready'});
  assert.equal(h.get('pasteClipboard').disabled,false);
  const n=socket.sent.length;
  await h.get('pasteClipboard').events.click();
  assert.equal(socket.sent.length,n+1);
  assert.deepEqual(socket.sent.at(-1),{type:'input',data:'echo hello'});
  h.get('disconnect').events.click();
  assert.equal(h.get('pasteClipboard').disabled,true);
});


test('Fn row exposes F1-F12 and Insert without sending a command when toggled',()=>{
  const h=harness({mobile:true});
  const socket=h.connect();
  socket.open();
  socket.message({type:'ready'});
  const before=socket.sent.filter(msg=>msg.type==='input').length;
  h.fn();
  assert.equal(h.get('functionKeys').classList.hidden,false);
  assert.equal(h.get('fnToggle').attrs['aria-expanded'],'true');
  assert.equal(socket.sent.filter(msg=>msg.type==='input').length,before);
  h.key('f1');
  assert.equal(socket.sent.at(-1).data,'\x1bOP');
  h.key('f4');
  assert.equal(socket.sent.at(-1).data,'\x1bOS');
  h.key('f12');
  assert.equal(socket.sent.at(-1).data,'\x1b[24~');
  h.key('insert');
  assert.equal(socket.sent.at(-1).data,'\x1b[2~');
  h.key('openbracket');
  assert.equal(socket.sent.at(-1).data,'[');
  h.key('backtick');
  assert.equal(socket.sent.at(-1).data,String.fromCharCode(96));
  h.fn();
  assert.equal(h.get('functionKeys').classList.hidden,true);
  assert.equal(h.get('fnToggle').attrs['aria-expanded'],'false');
});

test('mobile Ctrl and Alt affect the next native iPhone character, not login',()=>{
  const h=harness({mobile:true});
  assert.equal(h.get('mobileKeys').classList.hidden,true);
  const socket=h.connect();
  socket.open();
  socket.message({type:'ready'});
  assert.equal(h.get('mobileKeys').classList.hidden,false);
  const terminal=h.lastTerminal();
  h.modifier('ctrl');
  terminal.dataHandler('r');
  assert.equal(socket.sent.at(-1).data,'\x12');
  assert.equal(h.mods.find(x=>x.dataset.mod==='ctrl').attrs['aria-pressed'],'false');
  h.modifier('shift');
  terminal.dataHandler('d');
  assert.equal(socket.sent.at(-1).data,'D');
  h.modifier('alt');
  terminal.dataHandler('x');
  assert.equal(socket.sent.at(-1).data,'\x1bx');
  h.get('disconnect').events.click();
  assert.equal(h.get('mobileKeys').classList.hidden,true);
});

test('iPhone visual viewport shrinks the terminal when soft keyboard appears',()=>{
  const h=harness({mobile:true});
  const socket=h.connect();
  socket.open();socket.message({type:'ready'});
  assert.equal(h.viewportVars['--terminal-viewport-height'],'760px');
  h.window.visualViewport.height=410;
  h.viewportEvents.resize();
  assert.equal(h.viewportVars['--terminal-viewport-height'],'410px');
  assert.ok(h.document.body.classList.contains('keyboard-open'));
  h.window.visualViewport.height=760;
  h.viewportEvents.resize();
  assert.equal(h.document.body.classList.contains('keyboard-open'),false);
});

test('password and all shell input remain excluded from localStorage',()=>{
  const h=harness({mobile:true});
  const socket=h.connect();socket.open();socket.message({type:'ready'});
  const historyBefore=[...h.prefs.keys()];
  h.key('enter');h.key('ctrl-c');h.key('f5');
  h.lastTerminal().dataHandler('ls -la\n');
  assert.deepEqual([...h.prefs.keys()],historyBefore);
  assert.equal(JSON.stringify([...h.prefs]).includes('unit-test-only-password'),false);
});


test('iPhone reveals Railway field only on user tap and hides it again on logout',()=>{
  const h=harness({mobile:true});
  assert.equal(h.get('pw').type,'password');
  h.get('revealPassword').events.click();
  assert.equal(h.get('pw').type,'text');
  assert.equal(h.get('revealPassword').attrs['aria-pressed'],'true');
  assert.equal(h.get('revealPassword').textContent,'إخفاء');
  h.get('revealPassword').events.click();
  assert.equal(h.get('pw').type,'password');
  const socket=h.connect('test-typed-secret-only');
  socket.open();
  assert.equal(socket.sent[0].password,'test-typed-secret-only');
  socket.message({type:'ready'});
  h.get('disconnect').events.click();
  assert.equal(h.get('pw').value,'');
  assert.equal(h.get('pw').type,'password');
  assert.equal(h.get('revealPassword').attrs['aria-pressed'],'false');
  assert.equal(JSON.stringify([...h.prefs]).includes('test-typed-secret-only'),false);
});

test('leading whitespace is flagged but not altered or stored in password transmission',()=>{
  const h=harness();
  const ws=h.connect('  intentional-leading-space');
  assert.match(h.get('passwordHint').textContent,/مسافة طرفية/);
  ws.open();
  assert.equal(ws.sent[0].password,'  intentional-leading-space');
  assert.equal(JSON.stringify([...h.prefs]).includes('intentional-leading-space'),false);
});

test('backend connection errors remain distinct from an actual Railway password rejection',()=>{
  const h=harness();
  const ws=h.connect();
  ws.readyState=1;
  ws.onerror();
  ws.close();
  assert.match(h.get('err').textContent,/WebSocket/);
  assert.doesNotMatch(h.get('err').textContent,/خادم Railway رفض الكلمة/);
});

test('STAR AI panel requires terminal password and explicit user click, never executes shell input',()=>{
  const h=harness({mobile:true});
  assert.equal(h.get('aiToggle').disabled,true);
  assert.equal(h.get('aiPanel').classList.hidden,true);
  const socket=h.connect();
  socket.open();
  socket.message({type:'ready',aiEnabled:true});
  assert.equal(h.get('aiToggle').disabled,false);
  h.get('aiToggle').events.click();
  assert.equal(h.get('aiPanel').classList.hidden,false);
  assert.equal(h.get('aiSend').disabled,false);
  h.get('aiPrompt').value='Explain whoami';
  const before=socket.sent.length;
  h.get('aiSend').events.click();
  assert.deepEqual(socket.sent.at(-1),{type:'ai_chat',prompt:'Explain whoami'});
  assert.equal(socket.sent.length,before+1);
  assert.equal(socket.sent.filter(x=>x.type==='input').length,0);
  assert.equal(h.get('aiSend').disabled,true);
  socket.message({type:'ai_reply',text:'Only an answer <script>alert(1)</script>'});
  assert.equal(h.get('aiMessages').children.at(-1).textContent,
    'Only an answer <script>alert(1)</script>');
  assert.equal(h.get('aiMessages').children.at(-1).className,'ai-message ai-bot');
  assert.equal(h.get('aiSend').disabled,false);
  h.get('disconnect').events.click();
  assert.equal(h.get('aiPanel').classList.hidden,true);
  assert.deepEqual(h.get('aiMessages').children,[]);
  assert.equal(h.get('aiPrompt').value,'');
});

test('STAR AI disabled state is explicit and terminal output is only drafted, never auto-uploaded',()=>{
  const h=harness({mobile:true});
  const socket=h.connect();
  socket.open();
  socket.message({type:'ready',aiEnabled:false});
  assert.equal(h.get('aiSend').disabled,true);
  assert.equal(h.get('aiExplain').disabled,true);
  assert.match(h.get('aiState').textContent,/غير مهيأ/);
  socket.message({type:'ready',aiEnabled:true});
  h.lastTerminal().buffer.active={
    length:1,
    getLine(){return {translateToString(){return 'non-sensitive test status';}};}
  };
  const inputBefore=socket.sent.filter(x=>x.type==='ai_chat').length;
  h.get('aiExplain').events.click();
  assert.match(h.get('aiPrompt').value,/non-sensitive test status/);
  assert.equal(socket.sent.filter(x=>x.type==='ai_chat').length,inputBefore);
});

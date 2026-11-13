'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source=readFileSync(join(__dirname,'..','web','app.js'),'utf8');

function harness(){
  const nodes=new Map(),prefs=new Map([['wt_ui_matrix','0'],['wt_ui_sound','0']]);
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
        replaceChildren(){}
      };
      nodes.set(id,node);
    }
    return nodes.get(id);
  };
  let socket,terminal;
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
    matchMedia:()=>({matches:false,addEventListener(){}}),
    requestAnimationFrame:fn=>{fn(0);return 1;},
    cancelAnimationFrame(){},
    innerWidth:1100,innerHeight:800,devicePixelRatio:1,
    addEventListener(){},
    Terminal,
    FitAddon:{FitAddon},
    navigator:{},
  };
  const document={
    body:{className:''},hidden:false,
    getElementById:get,
    querySelector:()=>({setAttribute(){}}),
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
    navigator:{clipboard:{writeText:async()=>{}}}
  };
  vm.runInNewContext(source,context,{timeout:1000});
  return {get,prefs,window,document,connect:()=>{
    get('pw').value='unit-test-only-password';
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
  assert.match(h.get('err').textContent,/كلمة المرور غير صحيحة/);
  assert.equal(h.get('login').classList.hidden,false);
});

test('theme switching does not persist command output or secrets',()=>{
  const h=harness();
  h.get('themeSelect').events.change({target:{value:'dracula'}});
  assert.equal(h.document.body.className,'theme-dracula');
  assert.equal(h.prefs.get('wt_ui_theme'),'dracula');
  assert.deepEqual([...h.prefs.keys()].sort(),['wt_ui_matrix','wt_ui_sound','wt_ui_theme']);
});

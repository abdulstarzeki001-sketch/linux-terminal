(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const themeNames = new Set(['neon','catppuccin','dracula','tokyo','gruvbox']);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const themeSelect = $('themeSelect');
  const connection = $('connectionPill');
  const login = $('login');
  const error = $('err');
  const password = $('pw');
  const connectButton = $('go');
  const disconnectButton = $('disconnect');
  const screen = $('term');
  const extraKeys = $('mobileKeys');
  const keysToggle = $('keysToggle');
  const keyHint = $('keyHint');
  const keyMods = {ctrl:false,alt:false,shift:false};
  let keysExpanded = coarsePointer.matches;
  let fnExpanded = false;
  let viewportBaseline = window.visualViewport?.height || 0;
  const statusBar = $('status');
  let ws = null;
  let term = null;
  let fit = null;
  let terminalReady = false;
  let connecting = false;
  let resizeObserver = null;
  let authTimeout = null;
  let authFailure = '';
  let toastTimeout = null;
  let audio = null;
  let rainRunning = false;
  let rainFrame = null;
  let rainColumns = [];
  let rainLast = 0;
  const matrixCanvas = $('matrix');
  const matrixContext = matrixCanvas.getContext('2d', {alpha:true});

  // Persist only cosmetic preferences: NEVER persist passwords or shell history.
  function saved(key, fallback) {
    try { const v = localStorage.getItem('wt_ui_' + key); return v === null ? fallback : v; }
    catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem('wt_ui_' + key, value); } catch (_) { /* private mode */ }
  }
  const preferences = {
    theme: saved('theme','catppuccin'),
    matrix: saved('matrix',coarsePointer.matches || reduced.matches ? '0':'1') === '1',
    sound: saved('sound','0') === '1'
  };
  if (!themeNames.has(preferences.theme)) preferences.theme = 'catppuccin';

  function notify(text) {
    const box = $('toast');
    box.textContent = text;
    box.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => box.classList.remove('show'), 2400);
  }
  function beep() {
    if (!preferences.sound || reduced.matches) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio = audio || new Audio();
      if (audio.state === 'suspended') void audio.resume();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 570;
      gain.gain.setValueAtTime(0.018, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + .035);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + .038);
    } catch (_) { /* audio is optional */ }
  }
  function setConnection(state, label) {
    connection.dataset.state = state;
    connection.textContent = label;
  }
  function setControls() {
    const on = terminalReady && ws && ws.readyState === WebSocket.OPEN;
    $('copyOutput').disabled = !term;
    $('clearOutput').disabled = !term;
    disconnectButton.disabled = !ws;
    connectButton.disabled = connecting;
    $('pasteClipboard').disabled = !on;
    keysToggle.disabled = !on;
    keysToggle.setAttribute('aria-expanded',String(Boolean(on && keysExpanded)));
    if (on && keysExpanded) extraKeys.classList.remove('hidden');
    else extraKeys.classList.add('hidden');
    $('fnToggle').setAttribute('aria-expanded',String(Boolean(on && fnExpanded)));
    if(on && fnExpanded && keysExpanded) $('functionKeys').classList.remove('hidden');
    else $('functionKeys').classList.add('hidden');
    if (on) statusBar.textContent = 'CONNECTED · REAL LINUX BASH · WebSocket (WSS)';
  }
  function terminalPalette() {
    const c = getComputedStyle(document.body);
    const value = name => c.getPropertyValue(name).trim();
    return {
      background:value('--term-bg'),foreground:value('--text'),cursor:value('--neon'),
      selectionBackground:'rgba(152, 169, 245, 0.25)',
      black:'#15151d',red:value('--red'),green:value('--green'),
      yellow:value('--yellow'),blue:value('--neon'),magenta:value('--neon2'),
      cyan:value('--neon'),white:value('--text'),brightBlack:'#767a98',
      brightRed:value('--red'),brightGreen:value('--green'),
      brightYellow:value('--yellow'),brightBlue:value('--neon'),
      brightMagenta:value('--neon2'),brightCyan:value('--neon'),brightWhite:'#ffffff'
    };
  }
  function setTheme(theme) {
    if (!themeNames.has(theme)) return;
    // Preserve the iOS keyboard-open layout flag when changing themes.
    for (const oldTheme of themeNames) document.body.classList.remove('theme-' + oldTheme);
    document.body.classList.add('theme-' + theme);
    preferences.theme = theme;
    themeSelect.value = theme;
    save('theme',theme);
    if (term) term.options.theme = terminalPalette();
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content',getComputedStyle(document.body).getPropertyValue('--bg').trim());
  }

  function canvasResize() {
    if (!matrixContext) return;
    const scale = Math.min(window.devicePixelRatio || 1,1.5);
    const width = Math.max(1,Math.floor(window.innerWidth * scale));
    const height = Math.max(1,Math.floor(window.innerHeight * scale));
    matrixCanvas.width = width;
    matrixCanvas.height = height;
    const columns = Math.min(140,Math.ceil(width / (16 * scale)));
    rainColumns = Array.from({length:columns}, () => Math.floor(Math.random()*15));
  }
  const matrixGlyphs = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF';
  function drawMatrix(now) {
    if (!rainRunning || !matrixContext) return;
    rainFrame = window.requestAnimationFrame(drawMatrix);
    if (now - rainLast < 95) return; // hard frame-rate limit for phones
    rainLast = now;
    const context = matrixContext;
    const width = matrixCanvas.width;
    const height = matrixCanvas.height;
    const cell = width / Math.max(rainColumns.length,1);
    context.fillStyle = 'rgba(10,12,24,.22)';
    context.fillRect(0,0,width,height);
    context.fillStyle = getComputedStyle(document.body).getPropertyValue('--neon').trim() || '#89b4fa';
    context.font = Math.max(11,Math.floor(cell*.85))+'px monospace';
    for(let i=0;i<rainColumns.length;i++){
      const y = rainColumns[i] * cell;
      context.fillText(matrixGlyphs[Math.floor(Math.random()*matrixGlyphs.length)],i*cell,y);
      rainColumns[i] = y > height && Math.random()>.975 ? 0 : rainColumns[i]+1;
    }
  }
  function updateMatrix() {
    const enabled = preferences.matrix && !reduced.matches && !document.hidden && !!matrixContext;
    $('matrixToggle').setAttribute('aria-pressed',String(preferences.matrix));
    $('matrixToggle').textContent = preferences.matrix ? '◈ Matrix ON' : '◈ Matrix OFF';
    if (enabled && !rainRunning) {
      canvasResize();
      rainRunning = true;
      rainFrame = window.requestAnimationFrame(drawMatrix);
    } else if (!enabled && rainRunning) {
      rainRunning = false;
      if (rainFrame !== null) window.cancelAnimationFrame(rainFrame);
      rainFrame = null;
      matrixContext.clearRect(0,0,matrixCanvas.width,matrixCanvas.height);
    }
  }
  function updateSound() {
    $('soundToggle').setAttribute('aria-pressed',String(preferences.sound));
    $('soundToggle').textContent = preferences.sound ? '♪ Sound ON' : '♪ Sound OFF';
  }

  function send(payload) {
    if (ws?.readyState === WebSocket.OPEN && terminalReady) ws.send(JSON.stringify(payload));
  }
  function cleanupTerminal() {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (term) { try { term.dispose(); } catch (_) {} }
    term = null; fit = null;
    screen.replaceChildren();
    terminalReady = false;
    fnExpanded=false;
    resetModifiers();
    document.body.classList.remove('keyboard-open');
    screen.style.display = 'none';
  }
  function showLogin(message) {
    cleanupTerminal();
    login.classList.remove('hidden');
    statusBar.classList.add('hidden');
    password.value = '';
    connectButton.disabled = false;
    connecting = false;
    error.textContent = message || '';
    setConnection(message ? 'disconnected' : 'locked',message ? 'غير متصل' : 'محمي');
    setControls();
  }
  function doFit() {
    if (!terminalReady || !fit) return;
    try {
      fit.fit();
      if (term) send({type:'resize', cols:term.cols, rows:term.rows});
    } catch (_) { /* browser resizing during keyboard transitions */ }
  }
  function startTerminal() {
    if (terminalReady) return;
    if (typeof window.Terminal !== 'function' || typeof window.FitAddon?.FitAddon !== 'function') {
      throw Error('تعذر تحميل مكتبة xterm.js. تحقق من اتصال الإنترنت.');
    }
    login.classList.add('hidden');
    screen.style.display = 'block';
    statusBar.classList.remove('hidden');
    term = new window.Terminal({
      cursorBlink:!reduced.matches,
      convertEol:false,
      scrollback:5000,
      fontFamily:'"Fira Code", "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize:coarsePointer.matches ? 12.5 : 14,
      lineHeight:1.35,
      cursorStyle:'bar',
      theme:terminalPalette(),
      allowTransparency:false
    });
    fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(screen);
    term.onData(data => {
      // Apply the on-screen Ctrl / Alt / Shift modifier to the next letter
      // typed on the native iPhone keyboard, not only to virtual letter keys.
      if ((keyMods.ctrl || keyMods.alt || keyMods.shift) &&
          data.length===1 && /^[a-zA-Z]$/.test(data)) {
        const sequence=sequenceForKey('letter-'+data.toLowerCase());
        if(sequence!==null)send({type:'input',data:sequence});
      } else if (keyMods.alt && data.length===1) {
        send({type:'input',data:'\x1b'+data});
        resetModifiers();
      } else send({type:'input',data});
    });
    term.onResize(({cols,rows}) => send({type:'resize',cols,rows}));
    terminalReady = true;
    connecting = false;
    setConnection('connected','متصل');
    setControls();
    window.requestAnimationFrame(() => {syncVisualViewport();doFit();term?.focus();});
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(doFit));
      resizeObserver.observe(screen);
    }
    beep();
    notify('تم الاتصال بخادم Linux الحقيقي');
  }

  function connect() {
    if (connecting || ws?.readyState === WebSocket.OPEN) return;
    let secret = password.value;
    if (!secret) { error.textContent = 'أدخل كلمة المرور أولاً';return; }
    if (typeof window.Terminal !== 'function' || typeof window.FitAddon?.FitAddon !== 'function') {
      secret = '';
      error.textContent = 'مكتبة الطرفية لم تُحمّل، تحقق من الإنترنت وأعد المحاولة.';
      return;
    }
    authFailure = '';
    connecting = true;
    connectButton.disabled = true;
    error.textContent = '';
    setConnection('connecting','جارٍ الاتصال');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    let socket;
    try {socket = new WebSocket(protocol+'://'+location.host+'/ws');}
    catch (_) {
      secret = '';
      showLogin('تعذر إنشاء الاتصال الآمن');
      return;
    }
    ws = socket;
    password.value = '';
    const buffer = [];
    authTimeout = setTimeout(() => {
      if (ws===socket && !terminalReady) {
        authFailure = 'انتهت مهلة المصادقة. افحص الاتصال بخادم Railway.';
        socket.close();
      }
    }, 15000);
    socket.onopen = () => {
      socket.send(JSON.stringify({type:'auth', password:secret}));
      secret = '';
    };
    socket.onmessage = event => {
      if (ws!==socket) return;
      let message;
      try {message = JSON.parse(event.data);} catch (_) {return;}
      if (message.type==='ready') {
        clearTimeout(authTimeout);
        try {
          startTerminal();
          for (const line of buffer) term?.write(line);
        } catch (e) {
          authFailure = e.message;
          socket.close();
        }
      } else if ((message.type==='output' || message.type==='info') &&
        typeof message.data==='string') {
        if (terminalReady && term) term.write(message.data);
        else if (buffer.join('').length < 16000) buffer.push(message.data);
      } else if (message.type==='error') {
        authFailure = typeof message.message==='string'
          ? message.message.slice(0,250) : 'تعذّرت المصادقة';
        socket.close();
      }
    };
    socket.onerror = () => {
      if (ws===socket && !authFailure) authFailure = 'فشل اتصال WebSocket بخادم Railway';
    };
    socket.onclose = () => {
      clearTimeout(authTimeout);
      if (ws!==socket) return;
      ws = null;
      const reason = authFailure || (terminalReady ? 'انتهى اتصال Linux' : 'تعذّر الاتصال بالخادم');
      showLogin(reason);
      secret = '';
    };
  }
  function disconnect() {
    if (!ws) return;
    const socket = ws;
    ws = null;
    try {socket.close(1000,'User disconnected');} catch (_) {}
    clearTimeout(authTimeout);
    showLogin('');
    notify('تم قطع الاتصال');
  }
  function extractOutput() {
    if (!term) return '';
    const b = term.buffer.active,lines = [];
    const limit = Math.min(b.length,500);
    for (let i=Math.max(0,b.length-limit);i<b.length;i++) {
      lines.push(b.getLine(i)?.translateToString(true) || '');
    }
    return lines.join('\n').slice(-50000);
  }


  /* iOS Safari cannot replace the system keyboard from a website.
     These accessible buttons send real PTY key sequences after login only. */
  const literalKeys = Object.freeze({
    slash:'/',pipe:'|',tilde:'~',dash:'-',underscore:'_',
    backslash:'\\',colon:':',amp:'&',dollar:'$',quote:"'",
    doublequote:'"',lt:'<',gt:'>',space:' ',openbracket:'[',
    closebracket:']',openbrace:'{',closebrace:'}',semicolon:';',
    equals:'=',plus:'+',at:'@',hash:'#',backtick:'`'
  });
  const specialKeys = Object.freeze({
    esc:'\x1b',tab:'\t',enter:'\r',backspace:'\x7f',
    delete:'\x1b[3~',home:'\x1b[H',end:'\x1b[F',
    pageup:'\x1b[5~',pagedown:'\x1b[6~',insert:'\x1b[2~',
    f1:'\x1bOP',f2:'\x1bOQ',f3:'\x1bOR',f4:'\x1bOS',
    f5:'\x1b[15~',f6:'\x1b[17~',f7:'\x1b[18~',f8:'\x1b[19~',
    f9:'\x1b[20~',f10:'\x1b[21~',f11:'\x1b[23~',f12:'\x1b[24~',
    up:'\x1b[A',down:'\x1b[B',right:'\x1b[C',left:'\x1b[D'
  });
  const arrowFinals = {up:'A',down:'B',right:'C',left:'D'};
  function resetModifiers() {
    for (const name of Object.keys(keyMods)) keyMods[name] = false;
    updateModifiers();
  }
  function updateModifiers() {
    const nodes = document.querySelectorAll('[data-mod]');
    for (const button of nodes) {
      const value = Boolean(keyMods[button.dataset.mod]);
      button.setAttribute('aria-pressed',String(value));
    }
    if (keyHint) {
      const active = Object.keys(keyMods).filter(x => keyMods[x]);
      keyHint.textContent = active.length
        ? active.map(x=>x.toUpperCase()).join(' + ')+' — اضغط الحرف أو السهم التالي'
        : 'الأزرار ترسل مفاتيح للخادم الحقيقي';
    }
  }
  function sequenceForKey(name) {
    let result = null;
    if (name.startsWith('ctrl-') && /^[a-z]$/.test(name.slice(5))) {
      result = String.fromCharCode(name.charCodeAt(5)-96);
    } else if (name.startsWith('letter-') && /^[a-z]$/.test(name.slice(7))) {
      const letter = name.slice(7);
      result = keyMods.ctrl
        ? String.fromCharCode(letter.charCodeAt(0)-96)
        : keyMods.shift ? letter.toUpperCase() : letter;
      if (keyMods.alt) result = '\x1b' + result;
    } else if (Object.hasOwn(specialKeys,name)) {
      result = specialKeys[name];
      if (Object.hasOwn(arrowFinals,name) &&
          (keyMods.ctrl || keyMods.alt || keyMods.shift)) {
        const modifier = 1+(keyMods.shift?1:0)+(keyMods.alt?2:0)+(keyMods.ctrl?4:0);
        result = '\x1b[1;'+modifier+arrowFinals[name];
      } else if (keyMods.alt) result='\x1b'+result;
    } else if (Object.hasOwn(literalKeys,name)) {
      result=literalKeys[name];
      if(keyMods.ctrl && name==='backslash')result='\x1c';
      else if(keyMods.ctrl && name==='underscore')result='\x1f';
      if(keyMods.alt)result='\x1b'+result;
    }
    resetModifiers();
    return result;
  }
  function sendExtraKey(name) {
    if (!terminalReady || !ws || ws.readyState !== WebSocket.OPEN) return;
    const sequence = sequenceForKey(name);
    if (sequence === null) return;
    send({type:'input',data:sequence});
    term?.focus();
  }
  function syncVisualViewport() {
    if (!coarsePointer.matches || !window.visualViewport) return;
    const height = window.visualViewport.height;
    if (!Number.isFinite(height) || height < 150) return;
    viewportBaseline = Math.max(viewportBaseline,height);
    document.documentElement?.style?.setProperty(
      '--terminal-viewport-height',Math.round(height)+'px'
    );
    const keyboardOpen = terminalReady && viewportBaseline-height>125;
    document.body.classList.toggle('keyboard-open',keyboardOpen);
    if (terminalReady) window.requestAnimationFrame(doFit);
  }

  themeSelect.addEventListener('change',e=>{setTheme(e.target.value);beep();});
  $('matrixToggle').addEventListener('click',()=>{
    preferences.matrix = !preferences.matrix;
    save('matrix',preferences.matrix ? '1':'0');
    updateMatrix();beep();
  });
  $('soundToggle').addEventListener('click',()=>{
    preferences.sound=!preferences.sound;
    save('sound',preferences.sound ? '1':'0');
    updateSound();beep();
  });
  $('clearOutput').addEventListener('click',()=>{
    if(!term)return;
    term.clear();term.focus();notify('تم مسح العرض المحلي فقط');
    beep();
  });
  $('copyOutput').addEventListener('click',async()=>{
    if (!term) return;
    try {
      await navigator.clipboard.writeText(extractOutput());
      notify('تم نسخ المخرجات');
    } catch (_) {notify('نسخ المخرجات غير متاح في هذا المتصفح');}
  });

  // The extra-key tray is not shown and cannot send commands before auth.
  keysToggle.addEventListener('click',()=>{
    if (!terminalReady) return;
    keysExpanded = !keysExpanded;
    setControls();
    window.requestAnimationFrame(doFit);
    if(keysExpanded)term?.focus();
  });
  extraKeys.addEventListener('click',event=>{
    const button = event.target.closest('button');
    if (!button || !terminalReady) return;
    if (button.id === 'fnToggle') {
      fnExpanded=!fnExpanded;
      setControls();
      term?.focus();
      window.requestAnimationFrame(doFit);
      return;
    }
    if (button.id === 'showNativeKeyboard') {
      term?.focus();
      notify('يمكن استخدام كيبورد الآيفون مع مفاتيح Ctrl وEsc الإضافية');
      return;
    }
    const mod=button.dataset.mod;
    if(mod && Object.hasOwn(keyMods,mod)) {
      keyMods[mod]=!keyMods[mod];
      updateModifiers();
      term?.focus();
      return;
    }
    if(button.dataset.key)sendExtraKey(button.dataset.key);
  });
  $('pasteClipboard').addEventListener('click',async()=>{
    if(!terminalReady || !ws || ws.readyState!==WebSocket.OPEN)return;
    try{
      const text=await navigator.clipboard.readText();
      // Deliberate user gesture. No auto-paste or clipboard logging.
      if(!text)return;
      if(text.length>4096){
        notify('النص أطول من 4096 حرفاً؛ اختصره قبل لصقه');
        return;
      }
      send({type:'input',data:text});
      term?.focus();
    }catch(_){notify('اسمح باللصق من Safari، أو الصق عبر كيبورد الآيفون');}
  });
  disconnectButton.addEventListener('click',disconnect);
  connectButton.addEventListener('click',connect);
  password.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();connect();}
  });
  window.addEventListener('resize',()=>{if(terminalReady)doFit();if(rainRunning)canvasResize();syncVisualViewport();});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',syncVisualViewport);
    window.visualViewport.addEventListener('scroll',syncVisualViewport);
  }
  window.addEventListener('orientationchange',()=>{viewportBaseline=0;syncVisualViewport();});
  document.addEventListener('visibilitychange',updateMatrix);
  if(typeof reduced.addEventListener==='function')reduced.addEventListener('change',updateMatrix);
  window.addEventListener('pagehide',disconnect);

  setTheme(preferences.theme);
  updateSound();
  updateMatrix();
  resetModifiers();
  syncVisualViewport();
  showLogin('');
})();

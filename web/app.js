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
    document.body.className = 'theme-' + theme;
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
    if (typeof window.Terminal !== 'function' && typeof Terminal !== 'function' || typeof window.FitAddon?.FitAddon !== 'function') {
      throw Error('تعذر تحميل مكتبة xterm.js. تحقق من اتصال الإنترنت.');
    }
    login.classList.add('hidden');
    screen.style.display = 'block';
    statusBar.classList.remove('hidden');
    term = new Terminal({
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
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(screen);
    term.onData(data => send({type:'input',data}));
    term.onResize(({cols,rows}) => send({type:'resize',cols,rows}));
    terminalReady = true;
    connecting = false;
    setConnection('connected','متصل');
    setControls();
    window.requestAnimationFrame(() => {doFit();term?.focus();});
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
    if (typeof Terminal !== 'function' || !window.FitAddon?.FitAddon) {
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
  disconnectButton.addEventListener('click',disconnect);
  connectButton.addEventListener('click',connect);
  password.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();connect();}
  });
  window.addEventListener('resize',()=>{if(terminalReady)doFit();if(rainRunning)canvasResize();});
  document.addEventListener('visibilitychange',updateMatrix);
  if(typeof reduced.addEventListener==='function')reduced.addEventListener('change',updateMatrix);
  window.addEventListener('pagehide',disconnect);

  setTheme(preferences.theme);
  updateSound();
  updateMatrix();
  showLogin('');
})();

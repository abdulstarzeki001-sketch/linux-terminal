(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let ws = null;
  let term = null;
  let fit = null;
  let started = false;
  let lastError = '';

  window.addEventListener('resize', () => {
    if (fit) {
      try { fit.fit(); } catch (_) { /* disconnected */ }
    }
  });

  function showLogin(message) {
    if (term) {
      term.dispose();
      term = null;
      fit = null;
    }
    started = false;
    $('pw').value = '';
    $('login').classList.remove('hidden');
    $('status').classList.add('hidden');
    $('term').style.display = 'none';
    $('go').disabled = false;
    $('err').textContent = message || '';
  }

  function startTerminal() {
    started = true;
    $('login').classList.add('hidden');
    $('term').style.display = 'block';
    $('status').classList.remove('hidden');
    $('status').textContent = 'connected';

    if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
      lastError = 'تعذر تحميل مكتبة الطرفية. تحقق من الاتصال بالإنترنت.';
      if (ws) ws.close();
      return;
    }

    term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 14,
      theme: { background: '#0b0f14' },
      scrollback: 5000,
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('term'));
    fit.fit();
    term.focus();

    term.onData((data) => send({ type: 'input', data }));
    term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function connect(password) {
    started = false;
    lastError = '';
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (_) {
      showLogin('تعذر إنشاء الاتصال الآمن بالطرفية');
      return;
    }

    ws.onopen = () => {
      send({ type: 'auth', password });
      $('pw').value = '';
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }

      if (msg.type === 'ready') return startTerminal();
      if (msg.type === 'output' && term) return term.write(msg.data);
      if (msg.type === 'info' && term) return term.write(msg.data);
      if (msg.type === 'error') {
        lastError = msg.message;
        ws.close();
      }
    };

    ws.onclose = () => {
      showLogin(lastError || (started
        ? 'انقطع الاتصال. يمكنك إعادة الدخول.'
        : 'تعذر الاتصال بالسيرفر'));
    };
  }

  $('go').addEventListener('click', () => {
    const pw = $('pw').value;
    if (!pw) return;
    $('go').disabled = true;
    $('err').textContent = '';
    connect(pw);
  });

  $('pw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('go').click();
  });
})();

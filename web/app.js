(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let ws = null;
  let term = null;
  let fit = null;
  let started = false;

  function showLogin(message) {
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
    window.addEventListener('resize', () => fit.fit());
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function connect(password) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => send({ type: 'auth', password });

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }

      if (msg.type === 'ready') return startTerminal();
      if (msg.type === 'output' && term) return term.write(msg.data);
      if (msg.type === 'info' && term) return term.write(msg.data);
      if (msg.type === 'error') return showLogin(msg.message);
    };

    ws.onclose = () => {
      if (started && term) {
        term.write('\r\n[تم قطع الاتصال]\r\n');
        $('status').textContent = 'disconnected';
      } else if (!started) {
        showLogin($('err').textContent || 'تعذر الاتصال بالسيرفر');
      }
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

// Head Soccer - controller di HP.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const IN = { LEFT: 1, RIGHT: 2, JUMP: 4, KICK: 8, SPECIAL: 16 };
  const TEAMS = [
    { name: 'BIRU', col: '#2f7bff', col2: '#1a4db3' },
    { name: 'MERAH', col: '#ff4a4a', col2: '#b32424' },
  ];
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

  // id per-tab (sessionStorage) supaya dua tab di satu perangkat tetap dianggap dua pemain
  let pid = null;
  try { pid = sessionStorage.getItem('hsPid'); } catch {}
  if (!pid) {
    pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24);
    try { sessionStorage.setItem('hsPid', pid); } catch {}
  }

  // ---------- karakter ----------
  let ch;
  try { ch = JSON.parse(store('hsCh') || 'null'); } catch { ch = null; }
  ch = ch ? HSC.sanitize(ch) : HSC.random();
  store('hsCh', JSON.stringify(ch));
  let energy = 0, readyBuzzed = false;

  const q = new URLSearchParams(location.search);
  $('code').value = (q.get('room') || store('hsRoom') || '').toUpperCase().slice(0, 4);
  $('name').value = store('hsName') || '';

  let ws = null, code = '', name = '', joined = false, kicked = false, retry = 0;
  let slot = -1, team = -1, st = { ph: 'lobby', s: [0, 0], time: 0, ot: false, w: -1 };
  let bits = 0, lastSent = -1;

  // ---------- koneksi ----------
  function connect() {
    if (kicked) return;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', code, pid, name, ch })); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'assign') {
        if (!joined) { joined = true; $('join').classList.add('hidden'); $('pad').classList.remove('hidden'); store('hsRoom', code); }
        slot = m.slot; team = m.team; if (m.name) name = m.name; setConn(true); lastSent = -1; sendIn(true); render();
      } else if (m.t === 'st') { st = m; render(); }
      else if (m.t === 'en') { setEnergy(m.e, m.kind, m.fz); }
      else if (m.t === 'ev') {
        if (m.e === 'goal') { buzz(m.team === team ? [80, 60, 80, 60, 300] : [250]); flash(); }
        if (m.e === 'end') buzz([400]);
      } else if (m.t === 'err') { showErr(m.msg); kicked = !joined; ws.close(); resetJoin(); }
      else if (m.t === 'kicked') { kicked = true; joined = false; $('pad').classList.add('hidden'); $('join').classList.remove('hidden'); showErr('Kamu dikeluarkan dari room.'); }
      else if (m.t === 'hostlost') setConn(false, 'Layar utama terputus…');
    };
    ws.onclose = () => {
      setConn(false, 'Menghubungkan ulang…');
      if (kicked) return;
      clearTimeout(retry); retry = setTimeout(connect, 1200);
    };
    ws.onerror = () => {};
  }
  function resetJoin() { $('goBtn').disabled = false; }
  function showErr(t) { $('err').textContent = t; }
  function setConn(ok, text) {
    $('dot').classList.toggle('ok', ok);
    if (!ok && joined) { $('msg').innerHTML = text || ''; }
    else render();
  }
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  function sendIn(force) { if (force || bits !== lastSent) { lastSent = bits; send({ t: 'in', k: bits }); } }
  setInterval(() => sendIn(true), 600); // heartbeat sekaligus menjaga koneksi
  const cmd = (c) => { send({ t: 'cmd', c }); buzz(15); };
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
  function flash() { const el = $('pad'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  // ---------- gabung ----------
  function doJoin() {
    code = $('code').value.trim().toUpperCase(); name = $('name').value.trim();
    if (code.length !== 4) return showErr('Isi kode room 4 huruf.');
    if (!name) name = 'P' + Math.floor(Math.random() * 90 + 10);
    store('hsName', name); showErr(''); kicked = false;
    $('goBtn').disabled = true;
    goFull();
    connect();
    setTimeout(() => { $('goBtn').disabled = false; }, 2500);
  }
  $('goBtn').onclick = doJoin;
  $('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name').focus(); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  // ---------- fullscreen / wake lock ----------
  function goFull() {
    const el = document.documentElement;
    try {
      const p = (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch {} }).catch(() => {});
    } catch {}
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch {}
  }
  $('bFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else goFull(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch {} if (ws && ws.readyState !== 1) { clearTimeout(retry); connect(); } } });
  $('bPause').onclick = () => cmd('pause');

  // ---------- tampilan ----------
  function render() {
    if (!joined) return;
    const T = team >= 0 ? TEAMS[team] : { name: 'PENONTON', col: '#6b7a99', col2: '#3b4766' };
    document.documentElement.style.setProperty('--team', T.col);
    $('who').textContent = T.name + ' · ' + name;
    const t = Math.max(0, st.time | 0);
    $('score').firstChild.nodeValue = st.s[0] + ' – ' + st.s[1];
    $('time').textContent = st.ot ? 'GOLDEN' : Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    const ph = st.ph, c = $('center'), msg = $('msg');
    c.innerHTML = '';
    const mk = (txt, fn, ghost) => { const b = document.createElement('button'); b.className = 'go' + (ghost ? ' ghost' : ''); b.textContent = txt; b.onclick = fn; c.appendChild(b); };
    let h = '';
    if (slot < 0) h = 'Kamu penonton<small>Slot penuh – menunggu slot kosong</small>';
    else if (ph === 'lobby') { h = 'Siap main!<small>Tekan MULAI atau mulai dari layar utama</small>'; mk('▶ MULAI', () => cmd('start')); }
    else if (ph === 'countdown') h = 'Bersiap…';
    else if (ph === 'goal') h = 'GOL!';
    else if (ph === 'paused') { h = 'Jeda'; mk('▶ LANJUT', () => cmd('pause')); }
    else if (ph === 'ended') {
      h = (st.w < 0 ? 'SERI!' : st.w === team ? '🏆 KAMU MENANG!' : 'Kalah… coba lagi!');
      mk('↻ MAIN LAGI', () => cmd('start')); mk('☰ LOBBY', () => cmd('menu'), true);
    }
    msg.innerHTML = h;
    msg.style.opacity = ph === 'play' ? 0 : 1;
    $('bPause').style.visibility = (ph === 'play' || ph === 'paused') ? 'visible' : 'hidden';
    if (ph === 'lobby' || ph === 'ended') mk('🎨 KARAKTER', () => openCust('pad'), true);
    if (ph !== 'play') { setEnergy(ph === 'lobby' ? 0 : energy, ch.kind, false); }
    paintSpecialBtn();
  }

  // ---------- kontrol sentuh ----------
  function setBit(b, on) { bits = on ? (bits | b) : (bits & ~b); sendIn(); }
  function holdButton(el, bit) {
    const down = (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} el.classList.add('on'); setBit(bit, true); buzz(12); };
    const up = (e) => { el.classList.remove('on'); setBit(bit, false); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  holdButton($('bj'), IN.JUMP); holdButton($('bk'), IN.KICK); holdButton($('bs'), IN.SPECIAL);
  function setEnergy(e, kind, frozen) {
    energy = e;
    if (kind !== undefined && kind !== ch.kind && kind >= 0 && kind < HSC.KINDS.length) { /* jurus mengikuti yang dipakai di game */ paintSpecialBtn(kind); }
    else paintSpecialBtn();
    $('pad').classList.toggle('frozen', !!frozen);
  }
  function paintSpecialBtn(kind) {
    const K = HSC.KINDS[kind === undefined ? ch.kind : kind], b = $('bs');
    b.style.setProperty('--kc', K.col); b.style.setProperty('--p', Math.round(Math.min(1, energy) * 100));
    $('bsi').textContent = K.icon;
    const ready = energy >= 1;
    b.classList.toggle('ready', ready);
    if (ready && !readyBuzzed) { readyBuzzed = true; buzz([40, 40, 40]); } else if (!ready) readyBuzzed = false;
  }
  paintSpecialBtn();

  // ---------- kustomisasi karakter ----------
  let custFrom = 'join', pvRaf = 0, tmp = ch;
  const pv = $('pv'), pctx = pv.getContext('2d');
  function mkOpt(box, label, on, fn, cls, color) {
    const b = document.createElement('button'); b.className = 'opt ' + (cls || '') + (on ? ' on' : '');
    if (color) b.style.setProperty('--c', color);
    b.innerHTML = label; b.onclick = fn; box.appendChild(b); return b;
  }
  function mkSwatch(box, color, on, fn) {
    const b = document.createElement('button'); b.className = 'sw' + (on ? ' on' : ''); b.style.background = color; b.onclick = fn; box.appendChild(b);
  }
  function buildCust() {
    for (const id of ['gKind', 'gSkin', 'gHair', 'gHairCol', 'gAcc']) $(id).innerHTML = '';
    HSC.KINDS.forEach((K, i) => mkOpt($('gKind'), '<span>' + K.icon + '</span>' + K.name, tmp.kind === i, () => { tmp.kind = i; buildCust(); }, 'kind', K.col));
    HSC.SKINS.forEach((c, i) => mkSwatch($('gSkin'), c, tmp.skin === i, () => { tmp.skin = i; buildCust(); }));
    HSC.HAIR_STYLES.forEach((n, i) => mkOpt($('gHair'), n, tmp.hair === i, () => { tmp.hair = i; buildCust(); }));
    HSC.HAIR_COLORS.forEach((c, i) => mkSwatch($('gHairCol'), c, tmp.hairCol === i, () => { tmp.hairCol = i; buildCust(); }));
    HSC.ACCS.forEach((n, i) => mkOpt($('gAcc'), n, tmp.acc === i, () => { tmp.acc = i; buildCust(); }));
    const K = HSC.KINDS[tmp.kind];
    $('kname').textContent = K.icon + ' ' + K.name; $('kname').style.color = K.col; $('kdesc').textContent = K.desc;
  }
  function pvLoop(ts) {
    const t = ts / 1000, K = HSC.KINDS[tmp.kind], T = team >= 0 ? TEAMS[team] : TEAMS[0];
    pctx.clearRect(0, 0, 320, 320);
    const rg = pctx.createRadialGradient(160, 170, 40, 160, 170, 150);
    rg.addColorStop(0, K.col + '88'); rg.addColorStop(1, K.col + '00');
    pctx.fillStyle = rg; pctx.fillRect(0, 0, 320, 320);
    pctx.save(); pctx.translate(160, 172 + Math.sin(t * 3) * 4); pctx.scale(2.5, 2.5);
    HSC.drawHead(pctx, { r: 44, f: 1, look: tmp, team: { col: T.col, dark: T.col2, light: T.col }, tx: Math.cos(t * 1.3), ty: Math.sin(t * 1.7) * 0.5, mood: Math.sin(t * 0.8) > 0.6 ? 'happy' : 'n' });
    pctx.restore();
    pvRaf = requestAnimationFrame(pvLoop);
  }
  function openCust(from) {
    custFrom = from; tmp = Object.assign({}, ch);
    $(from === 'join' ? 'join' : 'pad').classList.add('hidden'); $('cust').classList.remove('hidden');
    buildCust(); cancelAnimationFrame(pvRaf); pvRaf = requestAnimationFrame(pvLoop);
  }
  function closeCust() {
    cancelAnimationFrame(pvRaf); $('cust').classList.add('hidden');
    $(custFrom === 'join' ? 'join' : 'pad').classList.remove('hidden');
  }
  $('custBtn').onclick = () => openCust('join');
  $('rand').onclick = () => { tmp = HSC.random(); buildCust(); };
  $('csave').onclick = () => {
    ch = HSC.sanitize(tmp); store('hsCh', JSON.stringify(ch));
    send({ t: 'ch', ch }); paintSpecialBtn(); closeCust(); buzz(20);
  };

  // D-pad: geser jari antara kiri/kanan tanpa angkat
  const dpad = $('dpad'), bl = $('bl'), br = $('br'), dp = new Map();
  function dpadUpdate() {
    let l = false, r = false;
    dp.forEach((side) => { if (side < 0) l = true; else r = true; });
    bl.classList.toggle('on', l); br.classList.toggle('on', r);
    bits = (bits & ~(IN.LEFT | IN.RIGHT)) | (l ? IN.LEFT : 0) | (r ? IN.RIGHT : 0); sendIn();
  }
  function sideOf(e) { const rc = dpad.getBoundingClientRect(); return e.clientX < rc.left + rc.width / 2 ? -1 : 1; }
  dpad.addEventListener('pointerdown', (e) => { e.preventDefault(); try { dpad.setPointerCapture(e.pointerId); } catch {} dp.set(e.pointerId, sideOf(e)); dpadUpdate(); buzz(10); });
  dpad.addEventListener('pointermove', (e) => { if (dp.has(e.pointerId)) { const s = sideOf(e); if (dp.get(e.pointerId) !== s) { dp.set(e.pointerId, s); dpadUpdate(); } } });
  const dpUp = (e) => { dp.delete(e.pointerId); dpadUpdate(); };
  dpad.addEventListener('pointerup', dpUp); dpad.addEventListener('pointercancel', dpUp); dpad.addEventListener('lostpointercapture', dpUp);

  // cegah gestur browser (zoom/scroll/menu)
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.target.tagName !== 'INPUT' && !(e.target.closest && e.target.closest('.scroll'))) e.preventDefault(); }, { passive: false });
  window.addEventListener('blur', () => { bits = 0; dp.clear(); dpadUpdate(); });

  if (q.get('room')) $('name').focus();
})();

// Head Soccer - layar utama: lobby, jaringan (HP sebagai controller), render, suara.
(() => {
  'use strict';
  const { C, IN, Game, footPos } = HS;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');

  const TEAM = [
    { name: 'BIRU', col: '#2f7bff', dark: '#1a4db3', light: '#8fb8ff' },
    { name: 'MERAH', col: '#ff4a4a', dark: '#b32424', light: '#ffa0a0' },
  ];
  const SKIN = ['#f1c27d', '#d9a066', '#ffdbac', '#b9783e'];

  // ============ pengaturan ============
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hsCfg') || '{}'); } catch {}
  const cfg = Object.assign({ mode: 1, diff: 'normal', minutes: 2, slotCfg: ['bot', 'bot', 'bot', 'bot'] }, saved);
  if (!Array.isArray(cfg.slotCfg) || cfg.slotCfg.length !== 4) cfg.slotCfg = ['bot', 'bot', 'bot', 'bot'];
  const saveCfg = () => { try { localStorage.setItem('hsCfg', JSON.stringify(cfg)); } catch {} };

  // ============ state ============
  const pads = new Map();           // pid -> {pid,name,slot,k,order}
  const slotPid = [null, null, null, null];
  const memory = {};                // pid -> slot terakhir (untuk reconnect)
  let joinCounter = 0;
  let state = 'lobby';              // 'lobby' | 'game'
  let game = null, paused = false;
  let myCode = '';
  let ips = [], ipIdx = 0, port = location.port;
  let ws = null, wsOpen = false;

  const activeSlots = () => (cfg.mode === 1 ? [0, 1] : [0, 1, 2, 3]);
  const slotFree = (i) => activeSlots().includes(i) && cfg.slotCfg[i] === 'bot' && !slotPid[i];

  // ============ audio ============
  const Sfx = {
    ctx: null, muted: localStorage.getItem('hsMute') === '1',
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    },
    tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, freq, type = 'lowpass', attack = 0.005) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = this.ctx.createBufferSource(); s.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(this.ctx.destination); s.start(t);
    },
    play(name, pow = 400) {
      const v = Math.min(1, pow / 900);
      switch (name) {
        case 'kick': this.noise(0.09, 0.5, 1100); this.tone(190, 60, 0.12, 'sine', 0.45); break;
        case 'bump': this.noise(0.06, 0.25 * v + 0.1, 700); this.tone(120, 60, 0.1, 'sine', 0.25 * v + 0.1); break;
        case 'bounce': this.tone(110, 50, 0.1, 'sine', 0.3 * v); break;
        case 'post': this.tone(1400, 900, 0.35, 'triangle', 0.25); this.tone(2100, 1500, 0.25, 'sine', 0.1); break;
        case 'jump': this.noise(0.05, 0.08, 2500, 'highpass'); break;
        case 'beep': this.tone(660, 660, 0.18, 'square', 0.12); break;
        case 'whistle':
          for (let i = 0; i < 3; i++) this.tone(2500, 2650, 0.16, 'sine', 0.22, i * 0.2); break;
        case 'goal':
          this.noise(2.2, 0.5, 1200, 'bandpass', 0.35);
          [220, 277, 330].forEach((f) => this.tone(f, f * 0.98, 0.9, 'sawtooth', 0.07));
          this.tone(110, 108, 0.9, 'sawtooth', 0.1); break;
        case 'sp_fire': this.noise(0.6, 0.45, 1800, 'bandpass'); this.tone(260, 900, 0.5, 'sawtooth', 0.12); break;
        case 'sp_frost': this.tone(1800, 2800, 0.5, 'sine', 0.16); this.tone(2400, 3400, 0.6, 'sine', 0.1, 0.08); this.noise(0.5, 0.2, 5000, 'highpass'); break;
        case 'sp_giant': this.tone(150, 55, 0.8, 'sawtooth', 0.16); this.tone(75, 40, 0.8, 'sine', 0.3); break;
        case 'sp_turbo': this.tone(250, 1500, 0.4, 'square', 0.1); this.tone(500, 2200, 0.35, 'sawtooth', 0.06); break;
        case 'sp_quake': this.noise(0.8, 0.9, 260, 'lowpass', 0.01); this.tone(80, 28, 0.8, 'sine', 0.5); break;
        case 'sp_magnet': this.tone(180, 520, 0.7, 'sine', 0.16); this.tone(186, 540, 0.7, 'sine', 0.14); break;
        case 'end':
          for (let i = 0; i < 3; i++) this.tone(2500, 2600, 0.3, 'sine', 0.22, i * 0.4);
          this.noise(2.5, 0.35, 1000, 'bandpass', 0.4); break;
      }
    },
  };

  // ============ jaringan ============
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const sendTo = (pid, msg) => send({ t: 'to', pid, msg });
  const sendAll = (msg) => send({ t: 'to', pid: '*', msg });

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => { wsOpen = true; send({ t: 'create', code: sessionStorage.getItem('hsCode') || '' }); updateConn(); };
    ws.onclose = () => { wsOpen = false; updateConn(); setTimeout(connect, 1500); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'created') {
        myCode = m.code; sessionStorage.setItem('hsCode', m.code);
        renderJoin(); pads.forEach((p) => notifyAssign(p));
      } else if (m.t === 'join') onJoin(m.pid, m.name, m.ch);
      else if (m.t === 'ch') { const p = pads.get(m.pid); if (p) { p.ch = HSC.sanitize(m.ch); renderSlots(); } }
      else if (m.t === 'in') { const p = pads.get(m.pid); if (p) p.k = m.k; }
      else if (m.t === 'left') onLeft(m.pid);
      else if (m.t === 'cmd') onCmd(m.pid, m.c);
    };
  }

  function updateConn() {
    const el = $('conn'); if (!el) return;
    const n = pads.size;
    el.className = 'conn' + (wsOpen ? '' : ' bad');
    el.textContent = wsOpen ? (n ? n + ' HP terhubung ✓' : 'Menunggu HP… (opsional)') : 'menghubungkan ke server…';
  }

  function joinUrl() {
    const host = ips.length ? ips[ipIdx % ips.length] : location.hostname;
    const h = (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && !ips.length) ? location.hostname : host;
    return 'http://' + h + (port ? ':' + port : '') + '/pad?room=' + myCode;
  }
  function renderJoin() {
    $('code').textContent = myCode || '····';
    if (!myCode) return;
    const u = joinUrl();
    $('url').textContent = u.replace('http://', '');
    $('qr').src = '/qr.svg?text=' + encodeURIComponent(u);
  }

  // ============ pemain HP ============
  function placePad(pad) {
    if (pad.slot >= 0) return;
    let s = memory[pad.pid] !== undefined && slotFree(memory[pad.pid]) ? memory[pad.pid] : [0, 1, 2, 3].find(slotFree);
    if (s === undefined && state === 'lobby' && cfg.mode === 1 && [2, 3].some((i) => cfg.slotCfg[i] === 'bot' && !slotPid[i])) {
      cfg.mode = 2; saveCfg(); s = [0, 1, 2, 3].find(slotFree);
    }
    if (s === undefined) return;
    pad.slot = s; slotPid[s] = pad.pid;
    if (game) { game.setHuman(s, true); game.setChar(s, pad.ch); const p = game.players.find((q) => q.slot === s); if (p) p.name = pad.name; }
  }
  function unplacePad(pad) {
    if (pad.slot >= 0) {
      slotPid[pad.slot] = null;
      if (game) { game.setHuman(pad.slot, cfg.slotCfg[pad.slot] !== 'bot'); const p = game.players.find((q) => q.slot === pad.slot); if (p && cfg.slotCfg[pad.slot] === 'bot') p.name = 'BOT'; }
    }
    pad.slot = -1;
  }
  function fillSpectators() {
    [...pads.values()].filter((p) => p.slot < 0).sort((a, b) => a.order - b.order).forEach((p) => { placePad(p); notifyAssign(p); });
  }
  function notifyAssign(p) {
    sendTo(p.pid, { t: 'assign', slot: p.slot, team: p.slot >= 0 ? p.slot & 1 : -1, name: p.name, mode: cfg.mode });
  }
  function onJoin(pid, name, ch) {
    let pad = pads.get(pid);
    if (!pad) { pad = { pid, name: name || 'P' + (pads.size + 1), slot: -1, k: 0, order: joinCounter++, ch: HSC.sanitize(ch) }; pads.set(pid, pad); }
    else { if (name) pad.name = name; if (ch) pad.ch = HSC.sanitize(ch); }
    if (pad.slot >= 0 && slotPid[pad.slot] !== pid) pad.slot = -1;
    placePad(pad);
    if (game && pad.slot >= 0) { const p = game.players.find((q) => q.slot === pad.slot); if (p) p.name = pad.name; }
    notifyAssign(pad); sendState(true); refreshCfgUI(); updateConn();
  }
  function onLeft(pid) {
    const pad = pads.get(pid); if (!pad) return;
    if (pad.slot >= 0) memory[pid] = pad.slot;
    unplacePad(pad); pads.delete(pid);
    fillSpectators(); refreshCfgUI(); updateConn();
  }
  function onCmd(pid, c) {
    if (c === 'start') {
      if (state === 'lobby') startGame();
      else if (game && game.phase === 'ended') startGame();
    } else if (c === 'menu') { if (state === 'game' && game && game.phase === 'ended') toLobby(); }
    else if (c === 'pause') { if (state === 'game') setPaused(!paused); }
  }

  let lastSt = 0;
  function sendState(force) {
    const now = performance.now();
    if (!force && now - lastSt < 250) return;
    lastSt = now;
    const g = game;
    sendAll({
      t: 'st', mode: cfg.mode,
      ph: paused ? 'paused' : state === 'lobby' ? 'lobby' : g.phase,
      s: g ? g.score : [0, 0], time: g ? Math.ceil(g.time) : cfg.minutes * 60, ot: g ? g.overtime : false,
      w: g ? g.winner : -1,
    });
  }

  // ============ lobby UI ============
  function setSeg(id, val) { document.querySelectorAll('#' + id + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(val))); }
  function bindSeg(id, fn) { document.querySelectorAll('#' + id + ' button').forEach((b) => b.addEventListener('click', () => { fn(b.dataset.v); refreshCfgUI(); })); }
  function refreshCfgUI() { setSeg('segMode', cfg.mode); setSeg('segDiff', cfg.diff); setSeg('segMin', cfg.minutes); renderSlots(); saveCfg(); }
  bindSeg('segMode', (v) => {
    cfg.mode = +v;
    if (cfg.mode === 1) pads.forEach((p) => { if (p.slot > 1) { slotPid[p.slot] = null; p.slot = -1; } });
    [...pads.values()].forEach((p) => { if (p.slot < 0) placePad(p); notifyAssign(p); });
  });
  bindSeg('segDiff', (v) => { cfg.diff = v; });
  bindSeg('segMin', (v) => { cfg.minutes = +v; });

  function slotInfo(i) {
    const t = cfg.slotCfg[i];
    if (slotPid[i]) { const p = pads.get(slotPid[i]); const k = HSC.KINDS[p.ch.kind]; return { cls: 'phone', name: p.name, sub: k.icon + ' ' + k.name + ' · klik = keluarkan', icon: k.icon }; }
    if (t === 'kb1') return { cls: 'kb', name: 'Keyboard 1', sub: '🔥 Bola Api · A D W S E', icon: '⌨' };
    if (t === 'kb2') return { cls: 'kb', name: 'Keyboard 2', sub: '❄️ Bekukan · ← → ↑ ↓ /', icon: '⌨' };
    return { cls: '', name: 'BOT', sub: 'Menunggu HP · klik = keyboard', icon: '🤖' };
  }
  function renderSlots() {
    for (const team of [0, 1]) {
      const box = $('slots' + team); box.innerHTML = '';
      for (const i of [team, team + 2]) {
        const info = slotInfo(i), on = activeSlots().includes(i);
        const d = document.createElement('div');
        d.className = 'slot ' + info.cls + (on ? '' : ' off');
        d.innerHTML = '<div class="av">' + info.icon + '</div><div><b></b><small></small></div>';
        d.querySelector('b').textContent = info.name; d.querySelector('small').textContent = info.sub;
        d.onclick = () => slotClick(i);
        box.appendChild(d);
      }
    }
  }
  function slotClick(i) {
    if (slotPid[i]) {
      const pid = slotPid[i], pad = pads.get(pid);
      send({ t: 'drop', pid, msg: { t: 'kicked' } });
      if (pad) { unplacePad(pad); pads.delete(pid); }
      updateConn();
    } else {
      const order = ['bot', 'kb1', 'kb2'];
      let n = order.indexOf(cfg.slotCfg[i]);
      for (let k = 0; k < 3; k++) {
        n = (n + 1) % 3;
        const v = order[n];
        if (v === 'bot' || !cfg.slotCfg.some((x, j) => j !== i && x === v)) { cfg.slotCfg[i] = v; break; }
      }
      fillSpectators();
    }
    refreshCfgUI();
  }

  // ============ alur game ============
  function startGame() {
    Sfx.init();
    const humans = [], names = [], chars = [];
    for (let i = 0; i < 4; i++) {
      const pid = slotPid[i], kb = cfg.slotCfg[i] !== 'bot';
      humans[i] = !!pid || kb;
      names[i] = pid ? pads.get(pid).name : kb ? (cfg.slotCfg[i] === 'kb1' ? 'KEY 1' : 'KEY 2') : 'BOT';
      chars[i] = pid ? pads.get(pid).ch : cfg.slotCfg[i] === 'kb1' ? { kind: 0, skin: 1, hair: 1, hairCol: 0, acc: 0 } : cfg.slotCfg[i] === 'kb2' ? { kind: 1, skin: 2, hair: 4, hairCol: 1, acc: 1 } : HSC.random();
    }
    game = new Game({ mode: cfg.mode, humans, names, chars, difficulty: cfg.diff, duration: cfg.minutes * 60 });
    state = 'game'; paused = false; particles.length = 0; trail.length = 0; rings.length = 0; banners.length = 0; frostFx = 0; shake = 0; endShown = false;
    $('lobby').classList.add('hidden'); $('endov').classList.add('hidden'); $('pauseov').classList.add('hidden');
    pads.forEach((p) => notifyAssign(p)); sendState(true);
  }
  function toLobby() {
    state = 'lobby'; game = null; paused = false; endShown = false;
    $('endov').classList.add('hidden'); $('pauseov').classList.add('hidden'); $('lobby').classList.remove('hidden');
    renderSlots(); sendState(true);
  }
  function setPaused(v) {
    if (state !== 'game' || !game || game.phase === 'ended') return;
    paused = v; $('pauseov').classList.toggle('hidden', !v); sendState(true);
  }
  let endShown = false;
  function showEnd() {
    endShown = true;
    const g = game, w = g.winner;
    $('endTitle').textContent = w < 0 ? 'SERI!' : TEAM[w].name + ' MENANG!';
    $('endScore').innerHTML = '<span class="b">' + g.score[0] + '</span> – <span class="r">' + g.score[1] + '</span>';
    $('endSub').textContent = g.overtime ? 'Golden goal di perpanjangan waktu' : 'Waktu habis';
    $('endov').classList.remove('hidden'); sendState(true);
  }
  $('startBtn').onclick = startGame;
  $('bAgain').onclick = startGame; $('bLobby').onclick = toLobby;
  $('bResume').onclick = () => setPaused(false); $('bQuit').onclick = toLobby;
  $('bPause').onclick = () => setPaused(!paused);
  $('bFull').onclick = toggleFull;
  function refreshMute() { $('bMute').textContent = Sfx.muted ? '🔇' : '🔊'; }
  $('bMute').onclick = () => { Sfx.muted = !Sfx.muted; localStorage.setItem('hsMute', Sfx.muted ? '1' : '0'); refreshMute(); Sfx.init(); };
  refreshMute();
  function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  $('url').onclick = () => { if (ips.length > 1) { ipIdx++; renderJoin(); } };

  // ============ keyboard ============
  const keys = Object.create(null);
  const KB = {
    kb1: { l: ['KeyA'], r: ['KeyD'], j: ['KeyW'], k: ['KeyS', 'Space'], s: ['KeyE', 'KeyQ'] },
    kb2: { l: ['ArrowLeft'], r: ['ArrowRight'], j: ['ArrowUp'], k: ['ArrowDown', 'Enter'], s: ['Slash', 'ShiftRight'] },
  };
  const kbBits = (m) => (m.l.some((c) => keys[c]) ? IN.LEFT : 0) | (m.r.some((c) => keys[c]) ? IN.RIGHT : 0) |
    (m.j.some((c) => keys[c]) ? IN.JUMP : 0) | (m.k.some((c) => keys[c]) ? IN.KICK : 0) | (m.s.some((c) => keys[c]) ? IN.SPECIAL : 0);
  addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true; Sfx.init();
    if (e.repeat) return;
    if (e.code === 'Enter' && (state === 'lobby' || (game && game.phase === 'ended'))) startGame();
    else if (e.code === 'KeyP' || e.code === 'Escape') setPaused(!paused);
    else if (e.code === 'KeyM') $('bMute').click();
    else if (e.code === 'KeyF') toggleFull();
    else if (e.code === 'KeyL' && game && game.phase === 'ended') toLobby();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // ============ efek visual ============
  const particles = [], trail = [], rings = [], banners = [];
  let shake = 0, flash = 0, frostFx = 0;
  function spawn(n, x, y, o) {
    for (let i = 0; i < n; i++) {
      const a = (o.a0 !== undefined ? o.a0 + Math.random() * (o.a1 - o.a0) : Math.random() * Math.PI * 2), s = o.s0 + Math.random() * (o.s1 - o.s0);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: o.life * (0.6 + Math.random() * 0.6),
        col: Array.isArray(o.col) ? o.col[(Math.random() * o.col.length) | 0] : o.col, size: o.size * (0.6 + Math.random() * 0.8), g: o.g || 0, shape: o.shape || 'c', rot: Math.random() * 6 });
    }
  }
  function handleEvents(evs) {
    for (const e of evs) {
      switch (e.type) {
        case 'kick':
          Sfx.play('kick'); spawn(8, e.x, e.y, { s0: 80, s1: 320, life: 0.4, size: 4, col: '#fff7c2' }); shake = Math.max(shake, 4);
          if (e.fire) { Sfx.play('sp_fire'); shake = 14; spawn(30, e.x, e.y, { s0: 100, s1: 600, life: 0.6, size: 7, col: ['#ffb02e', '#ff6a1a', '#ffe066'] }); }
          break;
        case 'special': {
          const K = HSC.KINDS[e.kind], pl = game && game.players.find((q) => q.slot === e.slot);
          Sfx.play('sp_' + K.id); shake = Math.max(shake, e.kind === 4 ? 26 : 10);
          rings.push({ x: e.x, y: e.kind === 4 ? C.GROUND : e.y, t: 0, max: 0.7, col: K.col, r0: 30, r1: e.kind === 4 ? 420 : 240, flat: e.kind === 4 });
          spawn(30, e.x, e.y, { s0: 100, s1: 520, life: 0.7, size: 5, col: [K.col, '#ffffff'] });
          banners.push({ txt: K.icon + ' ' + (pl ? pl.name : '') + ': ' + K.name.toUpperCase() + '!', col: K.col, t: 0, max: 1.9, team: e.team });
          if (banners.length > 3) banners.shift();
          if (e.kind === 1) frostFx = 1;
          break;
        }
        case 'bump': Sfx.play('bump', e.pow); spawn(4, e.x, e.y, { s0: 60, s1: 200, life: 0.3, size: 3, col: '#ffffff' }); break;
        case 'bounce': Sfx.play('bounce', e.pow); spawn(4, e.x, C.GROUND, { a0: Math.PI, a1: Math.PI * 2, s0: 40, s1: 160, life: 0.4, size: 4, col: '#cfe9c4', g: 400 }); break;
        case 'post': Sfx.play('post'); shake = Math.max(shake, 7); spawn(10, e.x, e.y, { s0: 100, s1: 300, life: 0.4, size: 3, col: '#ffe36a' }); break;
        case 'jump': Sfx.play('jump'); spawn(6, e.x, C.GROUND - 2, { a0: Math.PI, a1: Math.PI * 2, s0: 40, s1: 200, life: 0.45, size: 5, col: '#d8f0cf', g: 200 }); break;
        case 'land': spawn(5, e.x, C.GROUND - 2, { a0: Math.PI, a1: Math.PI * 2, s0: 40, s1: 180, life: 0.4, size: 4, col: '#d8f0cf', g: 200 }); break;
        case 'beep': Sfx.play('beep'); break;
        case 'whistle': Sfx.play('whistle'); break;
        case 'overtime': Sfx.play('whistle'); break;
        case 'goal': {
          Sfx.play('goal'); shake = 22; flash = 1;
          const cols = [TEAM[e.team].col, TEAM[e.team].light, '#ffe36a', '#ffffff'];
          spawn(70, e.team === 0 ? C.W - 60 : 60, C.GROUND - 10, { a0: -Math.PI * 0.95, a1: -Math.PI * 0.05, s0: 300, s1: 900, life: 2.2, size: 8, col: cols, g: 900, shape: 'r' });
          spawn(70, C.W / 2, 160, { a0: 0, a1: Math.PI, s0: 100, s1: 450, life: 2.4, size: 8, col: cols, g: 500, shape: 'r' });
          sendAll({ t: 'ev', e: 'goal', team: e.team });
          break;
        }
        case 'end': Sfx.play('end'); sendAll({ t: 'ev', e: 'end', w: e.winner }); break;
      }
    }
  }

  // ============ render ============
  // penonton (statis, bergoyang)
  const crowd = [];
  (function () {
    const pal = ['#e94f4f', '#3f7be0', '#f2c94c', '#f1f1f1', '#7e8cb0', '#4b5b86', '#d983e8', '#5fd39a'];
    for (let r = 0; r < 14; r++) for (let x = -10; x < C.W + 20; x += 24) {
      crowd.push({ x: x + (r % 2) * 12 + Math.random() * 6, y: 190 + r * 28 + Math.random() * 6, c: pal[(Math.random() * pal.length) | 0], ph: Math.random() * 6.28 });
    }
  })();
  const bg = document.createElement('canvas'); bg.width = C.W; bg.height = C.H;
  (function paintStatic() {
    const g = bg.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#060d24'); sky.addColorStop(1, '#1d3b72');
    g.fillStyle = sky; g.fillRect(0, 0, C.W, C.H);
    // tribun
    const st = g.createLinearGradient(0, 150, 0, 600); st.addColorStop(0, '#16264c'); st.addColorStop(1, '#0d1731');
    g.fillStyle = st; g.fillRect(0, 150, C.W, 450);
    g.fillStyle = '#0a1226'; g.fillRect(0, 150, C.W, 8);
    for (let y = 175; y < 590; y += 28) { g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(0, y + 14, C.W, 2); }
    // lampu sorot
    for (const lx of [150, C.W - 150]) {
      const rg = g.createRadialGradient(lx, 60, 4, lx, 60, 340);
      rg.addColorStop(0, 'rgba(255,248,210,.55)'); rg.addColorStop(1, 'rgba(255,248,210,0)');
      g.fillStyle = rg; g.fillRect(lx - 340, 0, 680, 420);
      g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { g.beginPath(); g.arc(lx - 24 + i * 16, 40 + j * 16, 6, 0, 7); g.fill(); }
      g.fillStyle = '#26324f'; g.fillRect(lx - 4, 78, 8, 80);
    }
    // papan iklan
    for (let x = 0; x < C.W; x += 320) {
      const gr = g.createLinearGradient(0, 590, 0, 640); gr.addColorStop(0, x % 640 ? '#c92a2a' : '#1c64f2'); gr.addColorStop(1, x % 640 ? '#7a1414' : '#0f3a9a');
      g.fillStyle = gr; g.fillRect(x, 596, 320, 44);
      g.fillStyle = '#fff'; g.font = '900 22px "Segoe UI",Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(x % 640 ? '⚽ HEAD SOCCER' : '★ SUPER LEAGUE ★', x + 160, 619);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 319, 596, 1, 44);
    }
    g.fillStyle = '#0a1226'; g.fillRect(0, 592, C.W, 5);
    // rumput
    for (let x = 0, i = 0; x < C.W; x += 80, i++) { g.fillStyle = i % 2 ? '#2f9f52' : '#37b35e'; g.fillRect(x, C.GROUND, 80, C.H - C.GROUND); }
    const sh = g.createLinearGradient(0, C.GROUND, 0, C.H); sh.addColorStop(0, 'rgba(0,0,0,.15)'); sh.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = sh; g.fillRect(0, C.GROUND, C.W, C.H - C.GROUND);
    g.fillStyle = '#fff'; g.fillRect(0, C.GROUND, C.W, 4);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(C.W / 2 - 2, C.GROUND, 4, 40);
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 3; g.beginPath(); g.ellipse(C.W / 2, C.GROUND + 2, 120, 26, 0, 0, Math.PI); g.stroke();
  })();

  function drawCrowd(t, hype) {
    for (const p of crowd) {
      const bob = Math.sin(t * (hype ? 9 : 2.2) + p.ph) * (hype ? 7 : 1.6);
      ctx.fillStyle = p.c; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(p.x, p.y + bob, 8, 0, 7); ctx.fill();
      ctx.fillRect(p.x - 8, p.y + 6 + bob, 16, 12);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(8,14,32,.5)'; ctx.fillRect(0, 150, C.W, 450);
  }

  function drawGoalBack(side) {
    const x0 = side === 0 ? 0 : C.W - C.GW, w = C.GW;
    ctx.fillStyle = 'rgba(8,14,30,.55)'; ctx.fillRect(x0, C.CROSS, w, C.GH);
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = 0; x <= w; x += 14) { ctx.moveTo(x0 + x, C.CROSS); ctx.lineTo(x0 + x, C.GROUND); }
    for (let y = 0; y <= C.GH; y += 14) { ctx.moveTo(x0, C.CROSS + y); ctx.lineTo(x0 + w, C.CROSS + y); }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(side === 0 ? x0 + w - 5 : x0, C.CROSS, 5, C.GH);   // tiang depan
  }
  function drawGoalFront(side) {
    const x0 = side === 0 ? 0 : C.W - C.GW;
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 6;
    ctx.fillRect(x0, C.CROSS, C.GW, C.BAR);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#c9d2e6'; ctx.fillRect(x0, C.CROSS + C.BAR - 4, C.GW, 4);
  }

  function drawBall(b) {
    if (b.fire > 0) {
      const rg = ctx.createRadialGradient(b.x, b.y, 6, b.x, b.y, 70);
      rg.addColorStop(0, 'rgba(255,220,100,.9)'); rg.addColorStop(0.45, 'rgba(255,110,20,.55)'); rg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(b.x, b.y, 70, 0, 7); ctx.fill();
    }
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    const sh = Math.max(0.35, 1 - (C.GROUND - b.y) / 520);
    ctx.save(); ctx.translate(0, C.GROUND - b.y); ctx.scale(sh, 0.28 * sh); ctx.beginPath(); ctx.arc(0, 0, C.BR, 0, 7); ctx.fill(); ctx.restore();
    ctx.rotate(b.rot);
    const g = ctx.createRadialGradient(-8, -10, 3, 0, 0, C.BR);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfd6e6');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, C.BR, 0, 7); ctx.fill();
    ctx.fillStyle = '#1b2236';
    pent(0, 0, 9);
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; pent(Math.cos(a) * 21, Math.sin(a) * 21, 6.5, a + Math.PI / 2); }
    ctx.strokeStyle = '#1b2236'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, C.BR - 1, 0, 7); ctx.stroke();
    ctx.restore();
  }
  function pent(x, y, r, rot = 0) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = rot - Math.PI / 2 + i * Math.PI * 2 / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
  }

  function drawPlayer(p, g) {
    const T = TEAM[p.team], f = p.facing, ft = footPos(p), R = p.r, k = R / C.R, K = HSC.KINDS[p.kind], fx = p.fx, tt = g.clock;
    // bayangan
    const hh = Math.max(0.4, 1 - (C.GROUND - p.y - R) / 400);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(p.x, C.GROUND + 3, 38 * k * hh, 8 * hh, 0, 0, 7); ctx.fill();

    // aura jurus aktif
    if (fx.giant > 0 || fx.turbo > 0 || fx.magnet > 0) {
      const col = fx.giant > 0 ? '#b07bff' : fx.turbo > 0 ? '#ffe14a' : '#4ee0b5';
      const rg = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, R + 26 + Math.sin(tt * 10) * 4);
      rg.addColorStop(0, col + '00'); rg.addColorStop(0.7, col + '66'); rg.addColorStop(1, col + '00');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x, p.y, R + 30, 0, 7); ctx.fill();
    }
    // kaki api
    if (fx.fire > 0) {
      const rg = ctx.createRadialGradient(ft.x, ft.y, 4, ft.x, ft.y, 46);
      rg.addColorStop(0, 'rgba(255,200,60,.95)'); rg.addColorStop(0.5, 'rgba(255,110,20,.55)'); rg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(ft.x, ft.y, 46, 0, 7); ctx.fill();
    }

    // kaki (kaos kaki + sepatu)
    ctx.lineCap = 'round'; ctx.strokeStyle = T.dark; ctx.lineWidth = 15 * k;
    ctx.beginPath(); ctx.moveTo(ft.px, ft.py - 6 * k); ctx.lineTo(ft.x - f * 6 * k, ft.y); ctx.stroke();
    ctx.save(); ctx.translate(ft.x, ft.y); ctx.scale(k, k); ctx.rotate(f > 0 ? ft.ang : Math.PI - ft.ang);
    ctx.fillStyle = fx.fire > 0 ? '#ffd9a0' : '#fff'; ctx.strokeStyle = '#1b2236'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(8, 2, 24, 13, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = T.col; ctx.beginPath(); ctx.ellipse(-6, 1, 10, 11, 0, 0, 7); ctx.fill();
    ctx.restore();

    // kepala
    const bx = g.ball.x - p.x, by = g.ball.y - p.y, bl = Math.hypot(bx, by) || 1;
    const happy = g.phase === 'goal' && g.lastScorer === p.team, sad = g.phase === 'goal' && g.lastScorer !== p.team;
    ctx.save(); ctx.translate(p.x, p.y);
    HSC.drawHead(ctx, { r: R, f, look: p.look, team: T, tx: bx / bl, ty: by / bl, frozen: fx.freeze > 0,
      mood: happy ? 'happy' : sad ? 'sad' : p.kickT >= 0 ? 'o' : 'n' });
    ctx.restore();
    // balok es
    if (fx.freeze > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, fx.freeze * 2);
      ctx.fillStyle = 'rgba(150,220,255,.38)'; ctx.strokeStyle = 'rgba(230,248,255,.9)'; ctx.lineWidth = 3;
      rr(p.x - R - 10, p.y - R - 10, 2 * R + 20, R * 2 + 10 + (C.GROUND - p.y - R), 14); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // nama + meter jurus
    ctx.font = '800 15px "Segoe UI",Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = p.name, tw = ctx.measureText(label).width + 16, ly = p.y - R - 20;
    ctx.fillStyle = 'rgba(8,14,30,.7)'; rr(p.x - tw / 2, ly - 11, tw, 22, 11); ctx.fill();
    ctx.fillStyle = p.human ? '#fff' : T.light; ctx.fillText(label, p.x, ly + 1);
    if (p.human) { ctx.fillStyle = T.col; ctx.beginPath(); ctx.moveTo(p.x - 7, ly + 14); ctx.lineTo(p.x + 7, ly + 14); ctx.lineTo(p.x, ly + 22); ctx.fill(); }
    const by0 = ly - 22, ready = p.energy >= 1;
    ctx.fillStyle = 'rgba(8,14,30,.75)'; rr(p.x - 21, by0, 42, 8, 4); ctx.fill();
    ctx.fillStyle = K.col; if (p.energy > 0.03) { rr(p.x - 21, by0, 42 * p.energy, 8, 4); ctx.fill(); }
    if (ready) { ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * Math.sin(tt * 12)) + ')'; ctx.lineWidth = 2; rr(p.x - 22, by0 - 1, 44, 10, 5); ctx.stroke(); }
    ctx.font = '13px "Segoe UI Emoji","Segoe UI",Arial'; ctx.fillStyle = '#fff'; ctx.fillText(K.icon, p.x - 31, by0 + 5);
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, v + amt));
    return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawHUD(g) {
    const cx = C.W / 2;
    ctx.save();
    // papan skor
    ctx.fillStyle = 'rgba(8,14,30,.82)'; rr(cx - 215, 12, 430, 74, 18); ctx.fill();
    ctx.fillStyle = TEAM[0].col; rr(cx - 215, 12, 130, 74, 18); ctx.fill(); ctx.fillRect(cx - 120, 12, 35, 74);
    ctx.fillStyle = TEAM[1].col; rr(cx + 85, 12, 130, 74, 18); ctx.fill(); ctx.fillRect(cx + 85, 12, 35, 74);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 46px "Segoe UI",Arial'; ctx.fillText(g.score[0], cx - 150, 60); ctx.fillText(g.score[1], cx + 150, 60);
    ctx.font = '800 12px "Segoe UI",Arial'; ctx.fillText(TEAM[0].name, cx - 150, 27); ctx.fillText(TEAM[1].name, cx + 150, 27);
    const t = g.overtime ? g.time : Math.max(0, g.time), m = Math.floor(t / 60), s = Math.floor(t % 60);
    ctx.font = '800 30px "Segoe UI",Arial'; ctx.fillText(m + ':' + String(s).padStart(2, '0'), cx, 44);
    ctx.font = '700 12px "Segoe UI",Arial'; ctx.fillStyle = g.overtime ? '#ffd23f' : '#9fb6e6';
    ctx.fillText(g.overtime ? 'GOLDEN GOAL' : (g.mode === 1 ? '1 VS 1' : '2 VS 2'), cx, 70);
    ctx.restore();
  }

  function bigText(txt, y, size, col, scale = 1, alpha = 1) {
    ctx.save(); ctx.translate(C.W / 2, y); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
    ctx.font = '900 ' + size + 'px "Segoe UI",Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = size / 7; ctx.strokeStyle = '#0a1226'; ctx.lineJoin = 'round'; ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = col; ctx.fillText(txt, 0, 0); ctx.restore();
  }

  function render(g, t, demo) {
    ctx.save();
    if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.drawImage(bg, 0, 0);
    drawCrowd(t, g && g.phase === 'goal');
    drawGoalBack(0); drawGoalBack(1);

    if (g) {
      // jejak bola
      for (let i = 0; i < trail.length; i++) {
        const a = (i + 1) / trail.length * 0.25;
        ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, C.BR * (0.4 + 0.5 * i / trail.length), 0, 7); ctx.fill();
      }
      for (const p of g.players) drawPlayer(p, g);
      drawBall(g.ball);
    }
    drawGoalFront(0); drawGoalFront(1);

    // gelombang jurus
    for (const r of rings) {
      const u = r.t / r.max, rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - u, 2));
      ctx.globalAlpha = Math.max(0, 1 - u); ctx.strokeStyle = r.col; ctx.lineWidth = 3 + 9 * (1 - u);
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, r.flat ? rad * 0.16 : rad, 0, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // partikel
    for (const p of particles) {
      const a = 1 - p.life / p.max; ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = p.col;
      if (p.shape === 'r') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + p.life * 6); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (g && !demo) {
      drawHUD(g);
      if (g.phase === 'countdown') {
        const n = Math.ceil(g.phaseT), frac = g.phaseT - Math.floor(g.phaseT), sc = 1 + (1 - frac) * 0.0 + frac * 0.5;
        bigText(String(Math.max(1, n)), 300, 170, '#ffe36a', sc, 0.5 + frac * 0.5);
        if (g.score[0] + g.score[1] === 0 && g.time === g.cfg.duration) bigText('SIAP-SIAP!', 160, 54, '#fff');
      } else if (g.phase === 'goal') {
        const k = Math.min(1, (2.6 - g.phaseT) * 4), sc = 0.4 + 0.6 * (1 - Math.pow(1 - k, 3)) + Math.sin(t * 12) * 0.03;
        bigText('GOOOL!', 250, 150, TEAM[g.lastScorer].light, sc);
        bigText(TEAM[g.lastScorer].name + ' MENCETAK GOL', 350, 36, '#fff', 1);
      } else if (g.phase === 'play' && g.overtime && g.time < 3) bigText('GOLDEN GOAL!', 250, 80, '#ffd23f', 1, 1 - g.time / 3);
      else if (g.phase === 'ended' && !endShown) { /* menunggu overlay */ }
    }
    if (g && !demo) {
      banners.forEach((b, i) => {
        const u = b.t / b.max, a = u < 0.1 ? u / 0.1 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
        bigText(b.txt, 128 + i * 46, 34, b.col, 0.9 + 0.1 * Math.min(1, u * 8), a);
      });
    }
    if (frostFx > 0) { ctx.fillStyle = 'rgba(150,225,255,' + frostFx * 0.4 + ')'; ctx.fillRect(0, 0, C.W, C.H); }
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flash * 0.5 + ')'; ctx.fillRect(0, 0, C.W, C.H); }
  }

  // partikel terus-menerus untuk jurus yang sedang aktif
  function fxTick(g) {
    for (const p of g.players) {
      const fx = p.fx;
      if (fx.fire > 0 && Math.random() < 0.7) { const ft = footPos(p); spawn(1, ft.x, ft.y, { a0: -Math.PI * 0.9, a1: -Math.PI * 0.1, s0: 30, s1: 120, life: 0.35, size: 6, col: ['#ffb02e', '#ff6a1a', '#ffe066'], g: -200 }); }
      if (fx.turbo > 0 && Math.abs(p.vx) > 120) spawn(1, p.x - Math.sign(p.vx) * p.r, p.y + (Math.random() - 0.5) * p.r * 1.4, { s0: 10, s1: 60, life: 0.3, size: 7, col: ['#ffe14a', '#fff6a8'] });
      if (fx.freeze > 0 && Math.random() < 0.3) spawn(1, p.x + (Math.random() - 0.5) * p.r * 2, p.y - p.r, { a0: 0.3, a1: 2.8, s0: 20, s1: 70, life: 0.7, size: 3, col: '#e6f8ff' });
      if (fx.magnet > 0 && Math.random() < 0.5) spawn(1, g.ball.x + (Math.random() - 0.5) * 120, g.ball.y + (Math.random() - 0.5) * 120, { s0: 5, s1: 40, life: 0.4, size: 3, col: '#4ee0b5' });
    }
    if (g.ball.fire > 0) spawn(2, g.ball.x, g.ball.y, { s0: 20, s1: 140, life: 0.4, size: 7, col: ['#ffb02e', '#ff6a1a', '#ffe066'], g: -150 });
  }
  // kirim energi jurus ke HP masing-masing (untuk tombol JURUS)
  let enT = 0;
  function syncEnergy(dt) {
    enT += dt; if (enT < 0.15) return; enT = 0;
    for (const pad of pads.values()) {
      if (pad.slot < 0) continue;
      const p = game.players.find((q) => q.slot === pad.slot); if (!p) continue;
      sendTo(pad.pid, { t: 'en', e: Math.round(p.energy * 100) / 100, kind: p.kind, fz: p.fx.freeze > 0 });
    }
  }

  // ============ loop utama ============
  let last = performance.now(), endTimer = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    if (state === 'game' && game && !paused) {
      for (const p of game.players) {
        if (!p.human) continue;
        const pid = slotPid[p.slot], kb = cfg.slotCfg[p.slot];
        p.input = pid ? (pads.get(pid) ? pads.get(pid).k : 0) : kb !== 'bot' ? kbBits(KB[kb]) : 0;
        p.speedMul = 1;
      }
      game.update(dt);
      handleEvents(game.drainEvents());
      fxTick(game);
      syncEnergy(dt);
      const b = game.ball;
      if (Math.hypot(b.vx, b.vy) > 650) { trail.push({ x: b.x, y: b.y }); if (trail.length > 9) trail.shift(); } else if (trail.length) trail.shift();
      if (game.phase === 'ended' && !endShown) { endTimer += dt; if (endTimer > 1.4) { endTimer = 0; showEnd(); } }
      else if (game.phase !== 'ended') endTimer = 0;
      sendState(false);
    } else if (state === 'lobby') {
      if (!game) { /* latar saja */ }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life += dt; if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.995;
    }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t >= rings[i].max) rings.splice(i, 1); }
    for (let i = banners.length - 1; i >= 0; i--) { banners[i].t += dt; if (banners[i].t >= banners[i].max) banners.splice(i, 1); }
    shake *= Math.pow(0.02, dt); flash = Math.max(0, flash - dt * 2.2); frostFx = Math.max(0, frostFx - dt * 1.5);

    // lobby: tampilkan stadion kosong + bola melayang
    if (state === 'lobby') {
      if (!window.__demo) window.__demo = new Game({ mode: 2, humans: [0, 0, 0, 0], names: ['BOT', 'BOT', 'BOT', 'BOT'], chars: [HSC.random(), HSC.random(), HSC.random(), HSC.random()], difficulty: 'normal', duration: 9999 });
      const d = window.__demo; d.update(dt); d.drainEvents();
      if (d.phase === 'goal' || d.phase === 'countdown') { d.phaseT = Math.min(d.phaseT, 0.01); }
      render(d, t, true);
    } else render(game, t);
    requestAnimationFrame(frame);
  }

  // ============ init ============
  fetch('/api/info').then((r) => r.json()).then((j) => { ips = j.ips || []; port = j.port || port; if (myCode) renderJoin(); }).catch(() => {});
  refreshCfgUI(); renderJoin(); connect();
  requestAnimationFrame(frame);
  window.addEventListener('pointerdown', () => Sfx.init());
  window.HSDEBUG = { get game() { return game; }, get state() { return state; } };
})();

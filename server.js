// Head Soccer - relay server.
// Layar utama (host) menjalankan simulasi game; HP hanya mengirim input.
// Server ini cuma: (1) menyajikan file statis, (2) membuat QR, (3) meneruskan pesan host <-> HP.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  // utamakan alamat Wi-Fi/LAN rumahan
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ips: lanIPs(), port: PORT }));
  }
  if (url.pathname === '/qr.svg') {
    try {
      const svg = await QRCode.toString(url.searchParams.get('text') || '', { type: 'svg', margin: 1 });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    } catch (e) { res.writeHead(400); return res.end('bad'); }
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/host') p = '/host.html';
  if (p === '/pad') p = '/pad.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map(); // code -> { host: ws|null, pads: Map<pid, ws>, hostGone: timeout }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // tanpa I/O supaya tidak membingungkan
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.role = null; ws.room = null; ws.pid = null;

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    // ----- host -----
    if (m.t === 'create') {
      let code = typeof m.code === 'string' ? m.code.toUpperCase() : '';
      let room = rooms.get(code);
      if (room && !room.host) { // host me-refresh halaman -> ambil alih room lama
        clearTimeout(room.hostGone);
      } else {
        code = newCode();
        room = { host: null, pads: new Map(), hostGone: null };
        rooms.set(code, room);
      }
      room.host = ws; ws.role = 'host'; ws.room = code;
      send(ws, { t: 'created', code });
      for (const pid of room.pads.keys()) send(ws, { t: 'padback', pid }); // info reconnect
      return;
    }
    if (ws.role === 'host') {
      const room = rooms.get(ws.room); if (!room) return;
      if (m.t === 'to') { // {t:'to', pid|'*', msg}
        if (m.pid === '*') room.pads.forEach((p) => send(p, m.msg));
        else send(room.pads.get(m.pid), m.msg);
      } else if (m.t === 'drop') {
        const p = room.pads.get(m.pid); if (p) { send(p, m.msg || { t: 'kicked' }); p.room = null; room.pads.delete(m.pid); }
      }
      return;
    }

    // ----- controller (HP) -----
    if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.host) return send(ws, { t: 'err', msg: 'Room "' + code + '" tidak ditemukan. Cek kodenya / pastikan layar utama sudah terbuka.' });
      const pid = String(m.pid || '').slice(0, 40) || Math.random().toString(36).slice(2);
      const old = room.pads.get(pid);
      if (old && old !== ws) { old.room = null; try { old.close(); } catch {} }
      room.pads.set(pid, ws);
      ws.role = 'pad'; ws.room = code; ws.pid = pid;
      send(room.host, { t: 'join', pid, name: String(m.name || '').slice(0, 12), ch: m.ch && typeof m.ch === 'object' ? m.ch : null });
      return;
    }
    if (ws.role === 'pad') {
      const room = rooms.get(ws.room); if (!room) return;
      if (m.t === 'in') send(room.host, { t: 'in', pid: ws.pid, k: m.k | 0 });
      else if (m.t === 'ch') send(room.host, { t: 'ch', pid: ws.pid, ch: m.ch && typeof m.ch === 'object' ? m.ch : null });
      else if (m.t === 'cmd') send(room.host, { t: 'cmd', pid: ws.pid, c: String(m.c).slice(0, 16) });
      else if (m.t === 'ping') send(ws, { t: 'pong', ts: m.ts });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
      room.pads.forEach((p) => send(p, { t: 'hostlost' }));
      room.hostGone = setTimeout(() => { // beri waktu 60 dtk utk refresh
        room.pads.forEach((p) => { try { p.close(); } catch {} });
        rooms.delete(ws.room);
      }, 60000);
    } else if (ws.role === 'pad' && room.pads.get(ws.pid) === ws) {
      room.pads.delete(ws.pid);
      send(room.host, { t: 'left', pid: ws.pid });
    }
  });
  ws.on('error', () => {});
});

setInterval(() => { // buang koneksi mati (HP tidur / keluar wifi)
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; try { ws.ping(); } catch {}
  });
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n  ⚽  HEAD SOCCER siap!\n');
  console.log('  Buka di layar utama (PC/laptop/TV):');
  console.log('     http://localhost:' + PORT + '/host');
  console.log('\n  HP buka (satu Wi-Fi yang sama) atau scan QR di layar:');
  (ips.length ? ips : ['<ip-pc>']).forEach((ip) => console.log('     http://' + ip + ':' + PORT + '/'));
  console.log('');
});

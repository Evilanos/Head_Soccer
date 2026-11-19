// Head Soccer - data karakter + gambar kepala (dipakai layar utama & preview di HP).
(function (global) {
  'use strict';

  const KINDS = [
    { id: 'fire',   name: 'Bola Api',  icon: '🔥', col: '#ff7a1a', desc: 'Tendangan berikutnya melesat super cepat & berapi.' },
    { id: 'frost',  name: 'Bekukan',   icon: '❄️', col: '#58c8ff', desc: 'Membekukan semua lawan selama 1,5 detik.' },
    { id: 'giant',  name: 'Raksasa',   icon: '💪', col: '#b07bff', desc: 'Tubuh membesar 6 detik, sundulan & tendangan lebih kuat.' },
    { id: 'turbo',  name: 'Kilat',     icon: '⚡', col: '#ffe14a', desc: 'Lari dan lompat super cepat selama 4,5 detik.' },
    { id: 'quake',  name: 'Gempa',     icon: '💥', col: '#ff5d7a', desc: 'Hentakan tanah: bola melambung, lawan terpental.' },
    { id: 'magnet', name: 'Magnet',    icon: '🧲', col: '#4ee0b5', desc: 'Bola menempel di kakimu selama 3 detik.' },
  ];
  const SKINS = ['#ffdbac', '#f1c27d', '#d9a066', '#b9783e', '#8d5524', '#5c3a21'];
  const HAIR_COLORS = ['#2b1d14', '#6b3f1d', '#e6c04a', '#d8452f', '#3a3f4a', '#7a5cff'];
  const HAIR_STYLES = ['Topi', 'Jabrik', 'Mohawk', 'Afro', 'Rapi', 'Botak'];
  const ACCS = ['Polos', 'Kacamata', 'Kumis', 'Plester'];

  const clampInt = (v, n) => { v = v | 0; return v < 0 || v >= n ? 0 : v; };
  function sanitize(ch) {
    ch = ch || {};
    return {
      kind: clampInt(ch.kind, KINDS.length), skin: clampInt(ch.skin, SKINS.length),
      hair: clampInt(ch.hair, HAIR_STYLES.length), hairCol: clampInt(ch.hairCol, HAIR_COLORS.length),
      acc: clampInt(ch.acc, ACCS.length),
    };
  }
  function random() {
    const r = (n) => Math.floor(Math.random() * n);
    return { kind: r(KINDS.length), skin: r(SKINS.length), hair: r(HAIR_STYLES.length), hairCol: r(HAIR_COLORS.length), acc: r(ACCS.length) };
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, v + amt));
    return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
  }

  /**
   * Gambar kepala di (0,0).
   * o: { r, f (arah hadap ±1), look:{skin,hair,hairCol,acc}, team:{col,dark,light},
   *      look dir: tx,ty (arah pupil, vektor satuan), mood: 'n'|'happy'|'sad'|'o', frozen }
   */
  function drawHead(ctx, o) {
    const look = o.look, T = o.team, f = o.f || 1, R = 44, k = (o.r || 44) / 44;
    const skin = SKINS[look.skin], hc = HAIR_COLORS[look.hairCol], hair = look.hair;
    ctx.save(); ctx.scale(k, k);

    // --- rambut di belakang kepala ---
    ctx.fillStyle = hc;
    if (hair === 3) { // afro
      for (let a = -3.5; a <= 0.35; a += 0.4) { ctx.beginPath(); ctx.arc(Math.cos(a) * 36, Math.sin(a) * 36 - 2, 19, 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, -22, 34, 0, 7); ctx.fill();
    } else if (hair === 1) { // jabrik
      for (let i = -3; i <= 3; i++) {
        const a = -Math.PI / 2 + i * 0.36, bx = Math.cos(a) * 36, by = Math.sin(a) * 36;
        ctx.beginPath(); ctx.moveTo(bx - 9 * Math.cos(a + 1.57), by - 9 * Math.sin(a + 1.57));
        ctx.lineTo(Math.cos(a + i * 0.1) * 62, Math.sin(a + i * 0.1) * 62);
        ctx.lineTo(bx + 9 * Math.cos(a + 1.57), by + 9 * Math.sin(a + 1.57)); ctx.fill();
      }
    } else if (hair === 2) { // mohawk
      ctx.beginPath(); ctx.moveTo(-f * 26, -30);
      ctx.quadraticCurveTo(-f * 16, -78, f * 4, -72); ctx.quadraticCurveTo(f * 26, -66, f * 30, -24); ctx.closePath(); ctx.fill();
    }

    // --- kepala ---
    const hg = ctx.createRadialGradient(-10 * f, -14, 4, 0, 0, R);
    hg.addColorStop(0, '#fff6e4'); hg.addColorStop(0.25, skin); hg.addColorStop(1, shade(skin, -38));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();

    // --- atas kepala (topi / rambut) ---
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.clip();
    const capPath = () => { ctx.beginPath(); ctx.moveTo(-R - 4, -R * 0.2); ctx.quadraticCurveTo(0, -R * 0.55, R + 4, -R * 0.12); ctx.lineTo(R + 4, -R - 4); ctx.lineTo(-R - 4, -R - 4); ctx.closePath(); };
    if (hair === 0) { // topi tim
      ctx.fillStyle = T.col; capPath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.ellipse(-8 * f, -R * 0.68, 20, 7, -0.2 * f, 0, 7); ctx.fill();
      ctx.fillStyle = T.dark; ctx.fillRect(-R - 4, -R * 0.26, 2 * R + 8, 6);
    } else {
      if (hair !== 5) { ctx.fillStyle = hc; capPath(); ctx.fill(); }
      if (hair === 4) { // poni miring
        ctx.beginPath(); ctx.moveTo(-R, -R * 0.2); ctx.quadraticCurveTo(f * 6, -R * 0.1, f * R * 0.9, -R * 0.55); ctx.lineTo(f * R, -R); ctx.lineTo(-R, -R); ctx.fill();
      }
      if (hair === 5) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-8 * f, -R * 0.62, 14, 7, -0.3 * f, 0, 7); ctx.fill(); }
      // ikat kepala warna tim (penanda tim)
      ctx.fillStyle = T.col; ctx.fillRect(-R - 4, -R * 0.34, 2 * R + 8, 11);
      ctx.fillStyle = T.dark; ctx.fillRect(-R - 4, -R * 0.34 + 8, 2 * R + 8, 3);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, R - 1.5, 0, 7); ctx.stroke();

    // --- mata ---
    const tx = o.tx || 0, ty = o.ty || 0;
    for (const x of [f * 9, f * 29]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, -2, 9.5, 11.5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#1b2236'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#16203a'; ctx.beginPath(); ctx.arc(x + tx * 3.5, -2 + ty * 4.5, 5, 0, 7); ctx.fill();
    }
    // --- aksesori ---
    if (look.acc === 1) { // kacamata hitam
      ctx.fillStyle = '#10141f';
      for (const x of [f * 9, f * 29]) { ctx.beginPath(); ctx.ellipse(x, -2, 12.5, 11, 0, 0, 7); ctx.fill(); }
      ctx.fillRect(f * 9 - 2, -6, f * 20 + 4, 4);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(f * 5, -6, 4, 2, -0.5, 0, 7); ctx.fill();
    } else if (look.acc === 3) { // plester + bekas luka
      ctx.save(); ctx.translate(f * 18, 12); ctx.rotate(-0.5 * f); ctx.fillStyle = '#f6d9b0'; ctx.fillRect(-11, -4, 22, 8);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-3, -4, 6, 8); ctx.restore();
    }
    // --- mulut ---
    ctx.strokeStyle = '#4a2a1a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath();
    if (o.mood === 'happy') { ctx.arc(f * 20, 14, 10, 0.1, Math.PI - 0.1); ctx.fillStyle = '#7a1f1f'; ctx.fill(); }
    else if (o.mood === 'sad') ctx.arc(f * 20, 28, 9, Math.PI + 0.3, -0.3);
    else if (o.mood === 'o') ctx.arc(f * 20, 20, 5, 0, 7);
    else { ctx.moveTo(f * 12, 22); ctx.quadraticCurveTo(f * 20, 27, f * 29, 21); }
    ctx.stroke();
    if (look.acc === 2) { // kumis
      ctx.fillStyle = shade(hc, -10);
      ctx.beginPath(); ctx.moveTo(f * 20, 12);
      ctx.quadraticCurveTo(f * 6, 8, f * 2, 20); ctx.quadraticCurveTo(f * 12, 16, f * 20, 17);
      ctx.quadraticCurveTo(f * 28, 16, f * 38, 20); ctx.quadraticCurveTo(f * 34, 8, f * 20, 12); ctx.fill();
    }
    if (o.frozen) {
      ctx.fillStyle = 'rgba(150,220,255,.55)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(-4, -4); ctx.lineTo(-12, 10); ctx.moveTo(14, -26); ctx.lineTo(22, -6); ctx.stroke();
    }
    ctx.restore();
  }

  global.HSC = { KINDS, SKINS, HAIR_COLORS, HAIR_STYLES, ACCS, sanitize, random, drawHead, shade };
})(window);

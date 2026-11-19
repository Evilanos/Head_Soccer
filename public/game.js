// Head Soccer - game engine (fisika, aturan main, jurus, AI bot). Tidak menyentuh DOM.
(function (global) {
  'use strict';

  const C = {
    W: 1280, H: 720, GROUND: 640,
    GW: 130, GH: 235, BAR: 16,          // gawang: lebar, tinggi, tebal mistar
    R: 44, BR: 28, FOOT_R: 24,          // radius kepala, bola, kaki
    SPEED: 400, JUMP: 980, PG: 2600,    // kecepatan lari, lompat, gravitasi pemain
    BG: 1250, BOUNCE: 0.72,             // gravitasi bola, pantulan lantai
    KICK_T: 0.30, KICK_CD: 0.10, KICK_SPEED: 930,
    STEP: 1 / 120,
    CHARGE_TIME: 13,                    // detik untuk mengisi penuh energi jurus
  };
  C.CROSS = C.GROUND - C.GH; // y atas mistar

  const IN = { LEFT: 1, RIGHT: 2, JUMP: 4, KICK: 8, SPECIAL: 16 };
  const KIND = { FIRE: 0, FROST: 1, GIANT: 2, TURBO: 3, QUAKE: 4, MAGNET: 5 };

  const DIFF = {
    easy:   { think: 0.15, speed: 0.74, err: 70, kick: 0.55, jump: 0.55, predict: 0.6 },
    normal: { think: 0.08, speed: 0.90, err: 30, kick: 0.85, jump: 0.85, predict: 0.85 },
    hard:   { think: 0.035, speed: 1.0, err: 8, kick: 1.0, jump: 1.0, predict: 1.0 },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---- helper: posisi kaki saat menendang (ikut skala ukuran pemain) ----
  function footPos(p) {
    const f = p.facing, k = p.r / C.R;
    const s = p.kickT >= 0 ? Math.sin(Math.PI * Math.min(1, p.kickT / C.KICK_T)) : 0;
    const ang = (8 - 43 * s) * Math.PI / 180;
    const L = (40 + 40 * s) * k;
    const px = p.x - f * 4 * k, py = p.y + p.r - 18 * k;
    return { px, py, x: px + f * L * Math.cos(ang), y: py + L * Math.sin(ang), ang, s };
  }

  // ---- prediksi bola (untuk bot) ----
  function predictBall(b, maxT) {
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy, t = 0;
    const dt = 1 / 40, low = C.GROUND - C.BR - 70;
    while (t < maxT) {
      vy += C.BG * dt; x += vx * dt; y += vy * dt; t += dt;
      if (x < C.BR) { x = C.BR; vx = Math.abs(vx) * 0.8; }
      else if (x > C.W - C.BR) { x = C.W - C.BR; vx = -Math.abs(vx) * 0.8; }
      if (y > C.GROUND - C.BR) { y = C.GROUND - C.BR; vy = -Math.abs(vy) * C.BOUNCE; }
      if (t >= 0.12 && y > low && vy >= -50) break;
    }
    return { x: clamp(x, C.BR, C.W - C.BR), y, t };
  }

  class Game {
    /** cfg: { mode:1|2, humans:[b×4], names:[×4], chars:[{kind,skin,hair,hairCol,acc}×4], difficulty, duration } */
    constructor(cfg) {
      this.cfg = cfg;
      this.mode = cfg.mode;
      const slots = cfg.mode === 1 ? [0, 1] : [0, 1, 2, 3];
      this.players = slots.map((s) => {
        const ch = (cfg.chars && cfg.chars[s]) || {};
        return {
          slot: s, team: s & 1, idx: s >> 1, name: cfg.names[s], human: !!cfg.humans[s],
          kind: ch.kind | 0, look: { skin: ch.skin | 0, hair: ch.hair | 0, hairCol: ch.hairCol | 0, acc: ch.acc | 0 },
          facing: (s & 1) ? -1 : 1, r: C.R,
          x: 0, y: 0, vx: 0, vy: 0, onGround: true,
          kickT: -1, kickCd: 0, kicked: false,
          energy: 0.3, prevSp: false,
          fx: { fire: 0, giant: 0, turbo: 0, magnet: 0, freeze: 0 },
          input: 0, bot: { t: 0, bits: 0, err: 0 }, speedMul: 1,
        };
      });
      this.ball = { x: C.W / 2, y: 250, vx: 0, vy: 0, rot: 0, fire: 0 };
      this.score = [0, 0];
      this.time = cfg.duration;
      this.overtime = false;
      this.phase = 'countdown';
      this.phaseT = 3;
      this.lastBeep = 4;
      this.winner = -1;
      this.lastScorer = -1;
      this.events = [];
      this.acc = 0;
      this.stuckT = 0;
      this.clock = 0;
      this.layout();
    }

    layout() {
      for (const p of this.players) {
        const frac = this.mode === 1 ? 0.27 : (p.idx === 0 ? 0.19 : 0.35);
        p.x = p.team === 0 ? C.W * frac : C.W * (1 - frac);
        p.r = C.R; p.y = C.GROUND - p.r; p.vx = p.vy = 0; p.onGround = true;
        p.kickT = -1; p.kickCd = 0; p.bot.t = 0; p.bot.bits = 0;
        p.fx.fire = p.fx.giant = p.fx.turbo = p.fx.magnet = p.fx.freeze = 0;
      }
      const b = this.ball;
      b.x = C.W / 2; b.y = 250; b.vx = b.vy = 0; b.fire = 0;
    }

    setHuman(slot, human) {
      const p = this.players.find((q) => q.slot === slot);
      if (p) { p.human = human; p.input = 0; p.bot.bits = 0; p.bot.t = 0; }
    }
    setChar(slot, ch) {
      const p = this.players.find((q) => q.slot === slot);
      if (!p || !ch) return;
      p.kind = ch.kind | 0; p.look = { skin: ch.skin | 0, hair: ch.hair | 0, hairCol: ch.hairCol | 0, acc: ch.acc | 0 };
      p.energy = Math.min(p.energy, 0.5);
      p.fx.fire = p.fx.giant = p.fx.turbo = p.fx.magnet = 0;
    }

    emit(e) { this.events.push(e); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    // ---------------- loop ----------------
    update(dt) {
      this.acc += Math.min(dt, 0.1);
      while (this.acc >= C.STEP) { this.acc -= C.STEP; this.step(C.STEP); }
    }

    step(dt) {
      this.clock += dt;
      switch (this.phase) {
        case 'countdown': {
          this.phaseT -= dt;
          const n = Math.ceil(this.phaseT);
          if (n !== this.lastBeep && n >= 1) { this.lastBeep = n; this.emit({ type: 'beep', n }); }
          if (this.phaseT <= 0) { this.phase = 'play'; this.emit({ type: 'whistle' }); }
          this.physicsPlayers(dt, false);
          return;
        }
        case 'play': {
          if (this.overtime) this.time += dt; else this.time -= dt;
          if (!this.overtime && this.time <= 0) {
            this.time = 0;
            if (this.score[0] === this.score[1]) { this.overtime = true; this.emit({ type: 'overtime' }); }
            else return this.finish();
          }
          for (const p of this.players) p.energy = Math.min(1, p.energy + dt / C.CHARGE_TIME);
          break;
        }
        case 'goal': {
          this.phaseT -= dt;
          if (this.phaseT <= 0) {
            if (this.overtime) return this.finish();
            this.layout(); this.phase = 'countdown'; this.phaseT = 1.8; this.lastBeep = 4;
            return;
          }
          break;
        }
        case 'ended': break;
      }
      this.physicsPlayers(dt, true);
      this.physicsBall(dt);
    }

    finish() {
      this.phase = 'ended';
      this.winner = this.score[0] === this.score[1] ? -1 : (this.score[0] > this.score[1] ? 0 : 1);
      this.emit({ type: 'end', winner: this.winner });
    }

    // ---------------- jurus ----------------
    activate(p) {
      p.energy = 0;
      const opp = this.players.filter((q) => q.team !== p.team);
      const b = this.ball;
      switch (p.kind) {
        case KIND.FIRE: p.fx.fire = 5; break;
        case KIND.FROST: for (const q of opp) { q.fx.freeze = 1.5; q.vx = 0; } break;
        case KIND.GIANT: p.fx.giant = 6; break;
        case KIND.TURBO: p.fx.turbo = 4.5; break;
        case KIND.QUAKE:
          if (Math.abs(b.x - p.x) < 440 && Math.abs(b.y - p.y) < 420) {
            b.vy = -1000; b.vx = p.facing * 380 + (b.x - p.x) * 0.4;
          }
          for (const q of opp) if (Math.abs(q.x - p.x) < 400 && q.onGround) { q.vy = -560; q.onGround = false; q.fx.freeze = 0.7; }
          break;
        case KIND.MAGNET: p.fx.magnet = 3; break;
      }
      this.emit({ type: 'special', slot: p.slot, kind: p.kind, team: p.team, x: p.x, y: p.y });
    }

    // ---------------- pemain ----------------
    physicsPlayers(dt, active) {
      const ps = this.players;
      for (const p of ps) {
        if (p.human === false && active && this.phase !== 'ended') this.botThink(p, dt);
        const fx = p.fx;
        for (const k in fx) if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - dt);
        const frozen = fx.freeze > 0;
        const rt = fx.giant > 0 ? C.R * 1.55 : C.R;
        p.r += (rt - p.r) * Math.min(1, dt * 7);

        let bits = active && this.phase !== 'ended' && !frozen ? p.input : 0;
        const sp = !!(bits & IN.SPECIAL);
        if (sp && !p.prevSp && p.energy >= 1 && this.phase === 'play') this.activate(p);
        p.prevSp = sp;

        const dir = ((bits & IN.RIGHT) ? 1 : 0) - ((bits & IN.LEFT) ? 1 : 0);
        const turbo = fx.turbo > 0;
        const maxV = C.SPEED * p.speedMul * (turbo ? 1.65 : 1);
        const acc = (p.onGround ? 5200 : 2600) * dt * (turbo ? 1.6 : 1);
        const target = dir * maxV;
        const fr = frozen ? 0.25 : (dir === 0 ? 1.2 : 1);
        if (p.vx < target) p.vx = Math.min(target, p.vx + acc * fr);
        else if (p.vx > target) p.vx = Math.max(target, p.vx - acc * fr);

        if ((bits & IN.JUMP) && p.onGround) {
          p.vy = -C.JUMP * (turbo ? 1.18 : 1) * (fx.giant > 0 ? 0.92 : 1); p.onGround = false;
          this.emit({ type: 'jump', x: p.x, y: C.GROUND });
        }
        if ((bits & IN.KICK) && p.kickT < 0 && p.kickCd <= 0) { p.kickT = 0; p.kicked = false; this.emit({ type: 'swing', slot: p.slot }); }
        if (p.kickT >= 0) {
          p.kickT += dt;
          if (p.kickT > C.KICK_T) { p.kickT = -1; p.kickCd = C.KICK_CD; }
        } else if (p.kickCd > 0) p.kickCd -= dt;

        p.vy += C.PG * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const minX = C.GW + 10, maxX = C.W - C.GW - 10;
        if (p.x < minX) { p.x = minX; p.vx = Math.max(0, p.vx); }
        if (p.x > maxX) { p.x = maxX; p.vx = Math.min(0, p.vx); }
        if (p.y < p.r) { p.y = p.r; p.vy = Math.max(0, p.vy); }
        const wasAir = !p.onGround;
        p.onGround = false;
        if (p.y >= C.GROUND - p.r) {
          p.y = C.GROUND - p.r; p.vy = 0; p.onGround = true;
          if (wasAir) this.emit({ type: 'land', x: p.x, y: C.GROUND });
        }
      }
      // tabrakan antar pemain
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          const min = (a.r + b.r) * 0.95;
          if (d >= min) continue;
          if (d < 0.001) { dx = 1; dy = 0; d = 1; }
          const nx = dx / d, ny = dy / d;
          // pemain besar (Raksasa) lebih sulit didorong
          const wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r), over = min - d;
          a.x -= nx * over * wa; a.y -= ny * over * wa; b.x += nx * over * wb; b.y += ny * over * wb;
          const rel = (b.vx - a.vx) * nx;
          if (rel < 0) { a.vx += nx * rel * wa; b.vx -= nx * rel * wb; }
          if (Math.abs(ny) > 0.6) {
            const up = ny > 0 ? a : b, dn = ny > 0 ? b : a;
            if (up.vy > 0) { up.vy = 0; up.onGround = true; }
            const sx = up.x >= dn.x ? 1 : -1; up.vx += sx * 40;
          }
          for (const q of [a, b]) {
            q.x = clamp(q.x, C.GW + 10, C.W - C.GW - 10);
            if (q.y > C.GROUND - q.r) { q.y = C.GROUND - q.r; q.onGround = true; if (q.vy > 0) q.vy = 0; }
          }
        }
      }
    }

    // ---------------- bola ----------------
    physicsBall(dt) {
      const b = this.ball, ps = this.players;
      b.vy += C.BG * dt;
      const drag = 1 - (b.fire > 0 ? 0.02 : 0.12) * dt; b.vx *= drag; b.vy *= drag;
      if (b.fire > 0) { b.fire -= dt; b.vy -= C.BG * dt * 0.55; } // bola api melesat lebih lurus

      // magnet: bola ditarik ke depan kaki
      for (const p of ps) {
        if (p.fx.magnet <= 0) continue;
        const tx = p.x + p.facing * (p.r + C.BR + 6), ty = C.GROUND - C.BR;
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        if (d < 480 && d > 1) {
          const a = 3800;
          b.vx += dx / d * a * dt; b.vy += dy / d * a * dt;
          if (d < 260) { b.vx *= 1 - 4 * dt; b.vy *= 1 - 2.2 * dt; }
        }
      }

      b.x += b.vx * dt; b.y += b.vy * dt;

      // kepala/badan pemain
      for (const p of ps) {
        let dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
        const min = p.r + C.BR;
        if (d >= min) continue;
        let nx, ny;
        if (d < 0.001) { nx = 0; ny = -1; } else { nx = dx / d; ny = dy / d; }
        if (ny > 0.55 && b.y > C.GROUND - C.BR - 8) { nx = dx >= 0 ? 1 : -1; ny = 0; }
        b.x = p.x + nx * min; b.y = p.y + ny * min;
        const rel = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
        if (rel < 0) {
          const j = -(1 + 0.78) * rel * (p.fx.giant > 0 ? 1.2 : 1);
          b.vx += nx * j; b.vy += ny * j;
          if (-rel > 160) {
            this.emit({ type: 'bump', x: b.x, y: b.y, pow: -rel });
            p.energy = Math.min(1, p.energy + 0.03);
          }
        }
      }

      // tendangan
      for (const p of ps) {
        if (p.kickT < 0 || p.kicked) continue;
        const ph = p.kickT / C.KICK_T;
        if (ph < 0.08 || ph > 0.8) continue;
        const ft = footPos(p), fr = C.FOOT_R * p.r / C.R;
        const dx = b.x - ft.x, dy = b.y - ft.y, d = Math.hypot(dx, dy);
        if (d >= fr + C.BR) continue;
        const nx = d > 0.001 ? dx / d : p.facing, ny = d > 0.001 ? dy / d : -0.3;
        let ax = p.facing * 1.0 + nx * 0.35, ay = -0.55 + ny * 0.35;
        let spd = C.KICK_SPEED + Math.max(0, p.vx * p.facing) * 0.35;
        const fire = p.fx.fire > 0;
        if (fire) { ax = p.facing; ay = -0.1 + ny * 0.1; spd = 1650; p.fx.fire = 0; b.fire = 2.6; }
        else if (p.fx.giant > 0) spd *= 1.25;
        const al = Math.hypot(ax, ay); ax /= al; ay /= al;
        b.vx = ax * spd + p.vx * 0.25; b.vy = ay * spd;
        b.x = ft.x + nx * (fr + C.BR); b.y = ft.y + ny * (fr + C.BR);
        p.kicked = true;
        p.energy = Math.min(1, p.energy + 0.08);
        this.emit({ type: 'kick', x: b.x, y: b.y, slot: p.slot, fire });
      }

      const sp = Math.hypot(b.vx, b.vy), cap = b.fire > 0 ? 1900 : 1500;
      if (sp > cap) { b.vx *= cap / sp; b.vy *= cap / sp; }

      this.barCollide(0, C.GW);
      this.barCollide(C.W - C.GW, C.W);

      if (b.y > C.GROUND - C.BR) {
        b.y = C.GROUND - C.BR;
        if (b.vy > 0) {
          if (b.vy > 220) this.emit({ type: 'bounce', x: b.x, y: C.GROUND, pow: b.vy });
          b.vy = b.vy < 140 ? 0 : -b.vy * C.BOUNCE;
        }
        b.vx -= b.vx * 0.9 * dt;
      }
      if (b.y < C.BR) { b.y = C.BR; b.vy = Math.abs(b.vy) * 0.8; }
      if (b.x < C.BR) { b.x = C.BR; b.vx = Math.abs(b.vx) * (b.y > C.CROSS ? 0.25 : 0.8); }
      else if (b.x > C.W - C.BR) { b.x = C.W - C.BR; b.vx = -Math.abs(b.vx) * (b.y > C.CROSS ? 0.25 : 0.8); }

      b.rot += (b.vx / C.BR) * dt;

      if (this.phase === 'play') {
        if (Math.hypot(b.vx, b.vy) < 25 && b.y > C.GROUND - C.BR - 2) this.stuckT += dt; else this.stuckT = 0;
        if (this.stuckT > 4) { b.vy = -600; b.vx += (Math.random() - 0.5) * 300; this.stuckT = 0; }
      }

      if (this.phase === 'play') {
        const inY = b.y > C.CROSS + C.BAR + 2;
        if (inY && b.x < C.GW * 0.72) this.goal(1);
        else if (inY && b.x > C.W - C.GW * 0.72) this.goal(0);
      }
    }

    barCollide(x0, x1) {
      const b = this.ball, y0 = C.CROSS, y1 = C.CROSS + C.BAR;
      const cx = clamp(b.x, x0, x1), cy = clamp(b.y, y0, y1);
      let dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d >= C.BR) return;
      let nx, ny;
      if (d < 0.001) { nx = 0; ny = -1; d = 0; } else { nx = dx / d; ny = dy / d; }
      b.x = cx + nx * C.BR; b.y = cy + ny * C.BR;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny;
        if (-vn > 200) this.emit({ type: 'post', x: b.x, y: b.y });
      }
      if (Math.abs(nx) < 0.05 && ny < 0) b.vx += (b.x < C.W / 2 ? 1 : -1) * 40;
    }

    goal(team) {
      this.score[team]++;
      this.lastScorer = team;
      this.phase = 'goal'; this.phaseT = 2.6;
      this.emit({ type: 'goal', team, x: this.ball.x, y: this.ball.y, fire: this.ball.fire > 0 });
    }

    // ---------------- AI bot ----------------
    botThink(p, dt) {
      const bot = p.bot;
      const D = DIFF[this.cfg.difficulty] || DIFF.normal;
      p.speedMul = D.speed;
      bot.t -= dt;
      if (bot.t > 0) { p.input = bot.bits; return; }
      bot.t = D.think * (0.8 + Math.random() * 0.4);

      const b = this.ball, dir = p.facing, ownX = p.team === 0 ? 0 : C.W;
      const mates = this.players.filter((q) => q.team === p.team);
      const opps = this.players.filter((q) => q.team !== p.team);
      const pr = predictBall(b, 1.4 * D.predict);
      const dist = (q) => Math.abs(q.x - pr.x) + (q.onGround ? 0 : 40);
      let att = mates[0];
      for (const q of mates) if (dist(q) < dist(att)) att = q;
      const ballOwnHalf = (b.x - C.W / 2) * dir < 0;
      const isAtt = att === p || (mates.length === 1);

      let targetX;
      const front = ownX + dir * (C.GW + 70);
      if (isAtt) targetX = pr.x - dir * 74;
      else {
        const ratio = ballOwnHalf ? 0.35 : 0.5;
        targetX = front + (pr.x - front) * ratio;
        targetX = clamp(targetX, ownX + dir * (C.GW + 40), ownX + dir * 560);
      }
      if (mates.length === 1) {
        const limit = C.W / 2 + dir * 170;
        if ((targetX - limit) * dir > 0 && Math.abs(b.x - p.x) > 170) targetX = limit;
        if (ballOwnHalf && Math.abs(b.x - ownX) < 380 && (b.x - p.x) * dir < 0) targetX = front + dir * 40;
      }
      targetX += bot.err;
      bot.err += (Math.random() - 0.5) * D.err * 0.8;
      bot.err = clamp(bot.err, -D.err, D.err);

      let bits = 0;
      const mx = targetX - p.x;
      if (Math.abs(mx) > 12) bits |= mx > 0 ? IN.RIGHT : IN.LEFT;

      const dx = (b.x - p.x) * dir;
      const adx = Math.abs(b.x - p.x);
      const dyb = b.y - p.y;
      if (dx > 14 && dx < 112 * p.r / C.R && Math.abs(dyb) < 85 && Math.random() < D.kick) bits |= IN.KICK;
      if (p.onGround && Math.random() < D.jump) {
        const ballAbove = b.y < p.y + 5 && b.y > p.y - 250;
        if (ballAbove && adx < 105 && b.vy > -250) bits |= IN.JUMP;
        else if (isAtt && dx < 0 && adx < 110 && b.y > C.GROUND - 90 && Math.abs(b.vx) < 300) bits |= IN.JUMP;
      }

      // jurus
      if (p.energy >= 1 && this.phase === 'play' && Math.random() < D.kick) {
        let use = false;
        const near = adx < 300;
        switch (p.kind) {
          case KIND.FIRE: use = near && dx > -20 && dx < 260; break;
          case KIND.FROST: use = Math.abs(b.x - ownX) < 520 || opps.some((q) => Math.abs(q.x - b.x) < 260) && near; break;
          case KIND.GIANT: use = adx < 240; break;
          case KIND.TURBO: use = adx < 520 && isAtt; break;
          case KIND.QUAKE: use = adx < 330 && dx > 0 && Math.abs(dyb) < 300; break;
          case KIND.MAGNET: use = adx < 220 && dx > -30; break;
        }
        if (use) bits |= IN.SPECIAL;
      }
      bot.bits = bits;
      p.input = bits;
    }
  }

  global.HS = { C, IN, KIND, DIFF, Game, footPos, predictBall };
})(typeof window !== 'undefined' ? window : globalThis);

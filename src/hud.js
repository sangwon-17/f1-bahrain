// 화면 정보: 랩타임 중심 (현재 랩, 구간 기록, 최고/지난 랩, 델타), 타이어 마모, 미니맵, 메시지

const $ = (id) => document.getElementById(id);

export function fmtTime(t, { sign = false } = {}) {
  if (t == null || !isFinite(t)) return '-:--.---';
  const neg = t < 0;
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  const body = m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  return sign ? `${neg ? '-' : '+'}${body}` : body;
}

export class Hud {
  constructor(track) {
    this.el = {
      hud: $('hud'), tower: $('tower'), mode: $('modeLabel'), lap: $('lapNum'), time: $('lapTime'),
      delta: $('delta'), sectors: [0, 1, 2].map((i) => $(`s${i + 1}`)), best: $('bestLap'), last: $('lastLap'),
      lastTag: $('lastTag'), speedBox: $('speedBox'), speed: $('speed'), gear: $('gear'),
      tyres: [0, 1, 2, 3].map((i) => $(`tyre${i}`)), tyrePct: [0, 1, 2, 3].map((i) => $(`tyrePct${i}`)),
      box: $('boxState'), msg: $('message'), lights: $('lights'), lightDots: [...document.querySelectorAll('#lights .dot')],
      pitTimer: $('pitTimer'),
    };
    this.msgTimer = 0;
    this.setupMinimap(track);
  }

  setupMinimap(track) {
    const canvas = $('minimap');
    const dpr = Math.min(window.devicePixelRatio, 2);
    const size = 200;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    this.mm = canvas.getContext('2d');
    this.mm.scale(dpr, dpr);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14;
    const sc = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxZ - minZ));
    const ox = (size - (maxX - minX) * sc) / 2, oz = (size - (maxZ - minZ) * sc) / 2;
    // 북쪽이 위: 월드 -z = 위
    this.toMap = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
    this.mmPath = new Path2D();
    track.pts.forEach((p, i) => {
      const [mx, my] = this.toMap(p.x, p.z);
      if (i === 0) this.mmPath.moveTo(mx, my); else this.mmPath.lineTo(mx, my);
    });
    this.mmPath.closePath();
    this.mmStart = this.toMap(track.pts[0].x, track.pts[0].z);
    this.mmSize = size;
  }

  drawMinimap(x, z, yaw) {
    const g = this.mm, s = this.mmSize;
    g.clearRect(0, 0, s, s);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 7;
    g.stroke(this.mmPath);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2.2;
    g.stroke(this.mmPath);
    g.fillStyle = '#fff';
    g.fillRect(this.mmStart[0] - 4, this.mmStart[1] - 1, 8, 2);
    const [cx, cy] = this.toMap(x, z);
    g.save();
    g.translate(cx, cy);
    g.rotate(-yaw + Math.PI);
    g.fillStyle = '#ffcc00';
    g.strokeStyle = '#1b2350';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(0, 2.5);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  setSession(type) {
    const attack = type === 'attack';
    this.el.tower.classList.toggle('hidden', type === 'free');
    this.el.mode.textContent = attack ? 'TIME ATTACK' : type === 'race' ? 'RACE' : 'FREE DRIVE';
  }

  setLap(n) { this.el.lap.textContent = n; }

  setLapTime(t) { this.el.time.textContent = fmtTime(t); }

  setDelta(d) {
    const el = this.el.delta;
    if (d == null) { el.textContent = ''; return; }
    el.textContent = fmtTime(d, { sign: true });
    el.className = d <= 0 ? 'delta faster' : 'delta slower';
  }

  /** state: 'none' | 'done' | 'pb'(개인 최고) | 'best'(전체 최고) */
  setSector(i, t, state) {
    const el = this.el.sectors[i];
    el.querySelector('b').textContent = t == null ? '--.---' : fmtTime(t);
    el.className = `sector ${state || ''}`;
  }

  setBest(t) { this.el.best.textContent = fmtTime(t); }

  setLast(t, pit) {
    this.el.last.textContent = fmtTime(t);
    this.el.lastTag.classList.toggle('hidden', !pit);
  }

  setSpeed(kmh, gear, cockpit) {
    this.el.speedBox.classList.toggle('hidden', cockpit);
    this.el.speed.textContent = Math.round(kmh);
    this.el.gear.textContent = gear === -1 ? 'R' : gear === 0 ? 'N' : gear;
  }

  setTyres(wear) {
    wear.forEach((w, i) => {
      const pct = Math.round(w * 100);
      // 초록 → 노랑 → 빨강
      const hue = Math.max(0, 120 - w * 140);
      this.el.tyres[i].style.background = `hsl(${hue} 85% 50%)`;
      this.el.tyrePct[i].textContent = `${pct}%`;
    });
  }

  setBox(requested, inPit) {
    const el = this.el.box;
    el.textContent = inPit ? 'IN PIT' : requested ? 'BOX THIS LAP' : 'P 피트인';
    el.className = `box ${requested || inPit ? 'on' : ''}`;
  }

  message(text, secs = 3.5, kind = '') {
    const el = this.el.msg;
    el.innerHTML = text;
    el.className = `message show ${kind}`;
    this.msgTimer = secs;
  }

  setLights(n, visible) {
    this.el.lights.classList.toggle('hidden', !visible);
    this.el.lightDots.forEach((d, i) => d.classList.toggle('on', i < n));
  }

  setPitTimer(t) {
    const el = this.el.pitTimer;
    if (t == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = `PIT STOP ${t.toFixed(2)}s`;
  }

  tick(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.className = 'message';
    }
  }
}

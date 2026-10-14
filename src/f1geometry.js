// F1 차체용 순수 기하 계산 (Three.js 없이 숫자 배열만 만들어요)
// 좌표: x = 왼쪽, y = 위, z = 앞. 단위 m.

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** 키 단면들을 부드럽게 보간해서 촘촘한 단면 목록으로 */
function interpolate(stations, keys, sub) {
  const out = [];
  const n = stations.length;
  for (let i = 0; i < n - 1; i++) {
    const s0 = stations[Math.max(0, i - 1)], s1 = stations[i], s2 = stations[i + 1], s3 = stations[Math.min(n - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const o = {};
      for (const key of keys) o[key] = catmull(s0[key], s1[key], s2[key], s3[key], t);
      out.push(o);
    }
  }
  out.push({ ...stations[n - 1] });
  return out;
}

function triNormal(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
  const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** idx[from..to) 삼각형들이 dir 방향(또는 center에서 멀어지는 방향)을 보도록 감김 정리 */
function orient(pos, idx, from, to, test) {
  // 가장 큰 삼각형 하나로 판단 (작은 삼각형은 오차가 커요)
  let best = from, area = -1;
  for (let i = from; i < to; i += 3) {
    const n = triNormal(pos, idx[i], idx[i + 1], idx[i + 2]);
    const a = Math.hypot(n[0], n[1], n[2]);
    if (a > area) { area = a; best = i; }
  }
  const n = triNormal(pos, idx[best], idx[best + 1], idx[best + 2]);
  if (test(n, idx[best]) < 0) {
    for (let i = from; i < to; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
}

/**
 * 단면을 이어 붙인 매끈한 몸체 (노즈, 모노코크, 사이드포드 등)
 * stations: [{ z, cx, top, bot, w, n }]  — w = 반폭, n = 각진 정도 (2 = 타원, 클수록 네모)
 * uv: u = 단면 둘레 (0 = 왼쪽 옆, 0.25 = 위, 0.5 = 오른쪽 옆, 0.75 = 아래), v = 앞뒤 (0 = 뒤, 1 = 앞)
 */
export function loftBody(stations, { radial = 72, sub = 8, caps = true } = {}) {
  const st = stations.map((s) => ({ cx: 0, n: 2.5, ...s }));
  const rings = interpolate(st, ['z', 'cx', 'top', 'bot', 'w', 'n'], sub);
  const zMin = Math.min(...st.map((s) => s.z)), zMax = Math.max(...st.map((s) => s.z));
  const pos = [], uv = [], idx = [];
  const R = radial + 1;
  for (const r of rings) {
    const cy = (r.top + r.bot) / 2, h = (r.top - r.bot) / 2, e = 2 / r.n;
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(r.cx + r.w * Math.sign(c) * Math.pow(Math.abs(c), e), cy + h * Math.sign(s) * Math.pow(Math.abs(s), e), r.z);
      uv.push(j / radial, (r.z - zMin) / (zMax - zMin));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // 옆면: 각 단면 중심에서 바깥쪽을 보게
  orient(pos, idx, 0, idx.length, (n, v) => {
    const ring = rings[Math.floor(v / R)];
    return (pos[v * 3] - ring.cx) * n[0] + (pos[v * 3 + 1] - (ring.top + ring.bot) / 2) * n[1];
  });
  if (caps) {
    for (const ri of [0, rings.length - 1]) {
      const r = rings[ri];
      const other = rings[ri === 0 ? 1 : rings.length - 2];
      const dir = Math.sign(r.z - other.z);
      const from = idx.length;
      const ci = pos.length / 3;
      pos.push(r.cx, (r.top + r.bot) / 2, r.z);
      uv.push(0.25, ri === 0 ? 0 : 1);
      for (let j = 0; j < radial; j++) idx.push(ci, ri * R + j, ri * R + j + 1);
      orient(pos, idx, from, idx.length, (n) => n[2] * dir);
    }
  }
  return { positions: pos, uvs: uv, indices: idx };
}

/** NACA 비슷한 날개 단면 (윗면 TE→LE, 아랫면 LE→TE). s = 앞전에서 거리 비율 */
function airfoil(m, thick, camber) {
  const pts = [];
  const yt = (s) => 5 * thick * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4);
  const yc = (s) => camber * 4 * s * (1 - s);
  for (let i = m; i >= 0; i--) { const s = 0.5 - 0.5 * Math.cos((i / m) * Math.PI); pts.push([s, yc(s) + yt(s)]); }
  for (let i = 1; i < m; i++) { const s = 0.5 - 0.5 * Math.cos((i / m) * Math.PI); pts.push([s, yc(s) - yt(s)]); }
  return pts;
}

/**
 * 날개 (x 방향으로 펼쳐진 날개 단면들)
 * stations: [{ x, le(앞전 z), y(앞전 높이), chord, aoa(라디안, +면 뒤끝이 위로), thick, camber }]
 * F1 날개는 거꾸로 달린 비행기 날개 — 아래로 누르는 힘을 만들어요
 */
export function loftWing(stations, { m = 16, sub = 4 } = {}) {
  const st = stations.map((s) => ({ thick: 0.1, camber: 0.05, aoa: 0, ...s }));
  const rows = interpolate(st, ['x', 'le', 'y', 'chord', 'aoa', 'thick', 'camber'], sub);
  const pos = [], uv = [], idx = [];
  const P = airfoil(m, 0.1, 0).length;
  const xMin = Math.min(...st.map((s) => s.x)), xMax = Math.max(...st.map((s) => s.x));
  const centers = [];
  for (const r of rows) {
    const prof = airfoil(m, r.thick, -r.camber); // 아래로 볼록
    const ca = Math.cos(r.aoa), sa = Math.sin(r.aoa);
    prof.forEach(([s, t], j) => {
      const c = s * r.chord, th = t * r.chord;
      pos.push(r.x, r.y + c * sa + th * ca, r.le - c * ca + th * sa);
      uv.push((r.x - xMin) / (xMax - xMin || 1), j / (P - 1));
    });
    centers.push([r.y + 0.4 * r.chord * sa, r.le - 0.4 * r.chord * ca]);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < P; j++) {
      const a = i * P + j, b = i * P + ((j + 1) % P), c = a + P, d = b + P;
      idx.push(a, c, b, b, c, d);
    }
  }
  orient(pos, idx, 0, idx.length, (n, v) => {
    const [cy, cz] = centers[Math.floor(v / P)];
    return (pos[v * 3 + 1] - cy) * n[1] + (pos[v * 3 + 2] - cz) * n[2];
  });
  for (const ri of [0, rows.length - 1]) {
    const r = rows[ri];
    const dir = Math.sign(r.x - rows[ri === 0 ? 1 : rows.length - 2].x);
    const from = idx.length;
    const ci = pos.length / 3;
    pos.push(r.x, centers[ri][0], centers[ri][1]);
    uv.push(0.5, 0.5);
    for (let j = 0; j < P; j++) idx.push(ci, ri * P + j, ri * P + ((j + 1) % P));
    orient(pos, idx, from, idx.length, (n) => n[0] * dir);
  }
  return { positions: pos, uvs: uv, indices: idx };
}

/** 납작한 판 (엔드플레이트 등): 옆에서 본 볼록한 모양(z, y)을 x 위치에 두께 t로 */
export function plate(profile, x, t) {
  const pos = [], uv = [], idx = [];
  const n = profile.length;
  const zs = profile.map((p) => p[0]), ys = profile.map((p) => p[1]);
  const z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (const side of [t / 2, -t / 2]) {
    for (const [z, y] of profile) {
      pos.push(x + side, y, z);
      uv.push((z - z0) / (z1 - z0), (y - y0) / (y1 - y0));
    }
  }
  const f1 = idx.length;
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  orient(pos, idx, f1, idx.length, (nn) => nn[0]);
  const f2 = idx.length;
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i, n + i + 1);
  orient(pos, idx, f2, idx.length, (nn) => -nn[0]);
  const cz = zs.reduce((a, b) => a + b) / n, cy = ys.reduce((a, b) => a + b) / n;
  const f3 = idx.length;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n;
    idx.push(a, b, n + a, b, n + b, n + a);
  }
  // 테두리는 각 면마다 따로 방향 확인
  for (let i = f3; i < idx.length; i += 3) {
    orient(pos, idx, i, i + 3, (nn, v) => (pos[v * 3 + 1] - cy) * nn[1] + (pos[v * 3 + 2] - cz) * nn[2]);
  }
  return { positions: pos, uvs: uv, indices: idx };
}

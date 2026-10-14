import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK, PIT } from './config.js';
import * as TX from './textures.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------
// 1) 경위도 데이터 → 부드러운 중심선 (2m 간격)
// ------------------------------------------------------------
function processTrack(coords, step, sigma, minR) {
  const [lon0, lat0] = coords[0];
  const R = 6371000, k = Math.PI / 180;
  // x = 동쪽, z = 남쪽 (Three.js에서 북쪽은 -z)
  const raw = coords.map(([lon, lat]) => ({ x: (lon - lon0) * k * R * Math.cos(lat0 * k), z: -(lat - lat0) * k * R }));
  const last = raw[raw.length - 1];
  if (Math.hypot(raw[0].x - last.x, raw[0].z - last.z) < 0.5) raw.pop();

  const resample = (src, ds) => {
    const out = [];
    let carry = 0;
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      let t = carry;
      while (t < len) {
        out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
        t += ds;
      }
      carry = t - len;
    }
    return out;
  };

  const p = resample(raw, 1);
  const n = p.length;
  // 가우시안 스무딩으로 각진 데이터를 둥글게
  const w = Math.ceil(sigma * 3), ker = [];
  let sum = 0;
  for (let i = -w; i <= w; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); ker.push(v); sum += v; }
  let cur = p.map((_, i) => {
    let x = 0, z = 0;
    for (let j = -w; j <= w; j++) { const q = p[(i + j + n) % n]; x += q.x * ker[j + w]; z += q.z * ker[j + w]; }
    return { x: x / sum, z: z / sum };
  });

  // 반지름이 minR보다 작은 코너만 골라서 더 둥글게
  const curv = (q, i, s) => {
    const a = q[(i - s + n) % n], b = q[i], c = q[(i + s) % n];
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    return Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / s;
  };
  for (let it = 0; it < 600; it++) {
    const tight = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (curv(cur, i, 4) > 1 / minR) {
        any = true;
        for (let j = -10; j <= 10; j++) tight[(i + j + n) % n] = 1;
      }
    }
    if (!any) break;
    const prev = cur;
    cur = prev.map((q, i) => {
      if (!tight[i]) return q;
      const a = prev[(i - 1 + n) % n], b = prev[(i + 1) % n];
      return { x: q.x * 0.5 + (a.x + b.x) * 0.25, z: q.z * 0.5 + (a.z + b.z) * 0.25 };
    });
  }
  return resample(cur, step);
}

// ------------------------------------------------------------
// 2) 트랙 정보 (곡률, 연석, 런오프, 방호벽 위치, 피트레인)
// ------------------------------------------------------------
export function createTrack(coords) {
  const step = TRACK.step;
  const pts = processTrack(coords, step, 5, 20);
  const N = pts.length;
  const L = N * step;
  const hw = TRACK.width / 2;

  pts.forEach((q, i) => {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    q.h = Math.atan2(b.x - a.x, b.z - a.z);
    q.nx = Math.cos(q.h); // 왼쪽 방향
    q.nz = -Math.sin(q.h);
    q.d = i * step;
  });
  const rawK = pts.map((q, i) => {
    const a = pts[(i - 2 + N) % N], b = pts[(i + 2) % N];
    return Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h)) / (4 * step); // + = 왼쪽 커브
  });
  const avg = (arr, r) => arr.map((_, i) => {
    let s = 0;
    for (let j = -r; j <= r; j++) s += arr[(i + j + N) % N];
    return s / (2 * r + 1);
  });
  const dilate = (arr, r) => arr.map((_, i) => {
    let m = -Infinity;
    for (let j = -r; j <= r; j++) m = Math.max(m, arr[(i + j + N) % N]);
    return m;
  });
  const k = avg(rawK, 5);
  pts.forEach((q, i) => { q.k = k[i]; });

  // 코너 정도 (0~1)와 연석 위치
  const corner = avg(dilate(k.map((v) => clamp((Math.abs(v) - 1 / 300) / (1 / 70 - 1 / 300), 0, 1)), 12), 8);
  const kerb = dilate(k.map((v) => (Math.abs(v) > 1 / 200 ? 1 : 0)), 12);
  const cornerSign = dilate(k.map((v) => Math.abs(v)), 0).map((_, i) => Math.sign(k[i]) || 1);

  // 피트 구간 위치 계산
  const wrap = (d) => ((d % L) + L) % L;
  const pitStart = wrap(PIT.startD);
  const pitLen = PIT.endD - PIT.startD;
  const pitS = (d) => wrap(d - pitStart);
  const inPitZone = (d) => pitS(d) < pitLen;
  const pitLaneOffset = (s) => {
    if (s < PIT.rampIn) return -PIT.laneOffset * smooth01(s / PIT.rampIn);
    if (s > pitLen - PIT.rampOut) return -PIT.laneOffset * smooth01((pitLen - s) / PIT.rampOut);
    return -PIT.laneOffset;
  };
  const pitWallFrom = wrap(PIT.wallStart), pitWallLen = PIT.wallEnd - PIT.wallStart;
  const inPitWall = (d) => wrap(d - pitWallFrom) < pitWallLen;
  const pitWallOffset = -(hw + 3.5);

  // 다른 구간과 너무 가까우면 방호벽을 안쪽으로 당겨요 (헤어핀 등)
  const proximity = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = Infinity;
    for (let j = 0; j < N; j += 2) {
      const gap = Math.min(Math.abs(i - j), N - Math.abs(i - j));
      if (gap < 70) continue;
      const dx = pts[i].x - pts[j].x, dz = pts[i].z - pts[j].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < m) m = d2;
    }
    proximity[i] = Math.sqrt(m);
  }

  const minWall = hw + TRACK.kerbWidth + 2.5;
  const wallFor = (side) => {
    const raw = pts.map((q, i) => {
      let off = Math.min(TRACK.wallOffset, proximity[i] / 2 - 1.5);
      // 커브 안쪽은 반지름보다 안쪽에 있어야 벽이 꼬이지 않아요
      for (let j = -25; j <= 25; j++) {
        const kk = k[(i + j + N) % N];
        if (kk * side > 0) off = Math.min(off, 0.75 / Math.abs(kk));
      }
      if (side < 0) {
        const s = pitS(q.d);
        const blend = Math.min(smooth01(s / 40), smooth01((pitLen - s) / 40));
        if (s < pitLen) off = Math.max(off, off + (PIT.laneOffset + PIT.laneWidth / 2 + 1.5 - off) * blend);
      }
      return Math.max(minWall, off);
    });
    return avg(dilate(raw.map((v) => -v), 6).map((v) => -v), 6);
  };
  const wallL = wallFor(1);
  const wallR = wallFor(-1);

  // 런오프 폭: 코너 바깥쪽은 넓게
  const runoffFor = (side, wall) => pts.map((_, i) => {
    const outside = cornerSign[i] * side < 0 ? 1 : 0.25;
    const w = TRACK.shoulder + corner[i] * outside * TRACK.runoff;
    return Math.min(w, wall[i] - hw - 1.2);
  });
  const runoffL = avg(runoffFor(1, wallL), 6);
  const runoffR = avg(runoffFor(-1, wallR), 6);

  const track = {
    pts, N, L, step, hw, k, corner, kerb, wallL, wallR, runoffL, runoffR,
    wrap, pitS, pitLen, inPitZone, pitLaneOffset, inPitWall, pitWallOffset,
  };

  /** 차 위치(x,z)가 트랙 어디쯤인지: 진행거리 d, 중심선에서 옆으로 lat(+왼쪽) */
  track.locate = (x, z, hint = -1) => {
    let best = Infinity, bi = 0, bt = 0;
    const scan = (from, count) => {
      for (let c = 0; c < count; c++) {
        const i = (from + c + N) % N;
        const a = pts[i], b = pts[(i + 1) % N];
        const ex = b.x - a.x, ez = b.z - a.z;
        const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez), 0, 1);
        const qx = a.x + ex * t - x, qz = a.z + ez * t - z;
        const d2 = qx * qx + qz * qz;
        if (d2 < best) { best = d2; bi = i; bt = t; }
      }
    };
    if (hint >= 0) scan(hint - 30, 80);
    if (hint < 0 || best > 45 * 45) scan(0, N);
    const a = pts[bi], b = pts[(bi + 1) % N];
    const px = a.x + (b.x - a.x) * bt, pz = a.z + (b.z - a.z) * bt;
    const lat = (x - px) * a.nx + (z - pz) * a.nz;
    return { idx: bi, t: bt, d: (bi + bt) * step, lat, h: a.h, nx: a.nx, nz: a.nz };
  };

  /** 진행거리 d, 옆 거리 lat 위치의 월드 좌표와 방향 */
  track.poseAt = (d, lat = 0) => {
    const f = wrap(d) / step;
    const i = Math.floor(f) % N, t = f - Math.floor(f);
    const a = pts[i], b = pts[(i + 1) % N];
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const h = a.h + Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h)) * t;
    return { x: x + Math.cos(h) * lat, z: z - Math.sin(h) * lat, h };
  };

  const sample = (arr, d) => {
    const f = wrap(d) / step;
    const i = Math.floor(f) % N, t = f - Math.floor(f);
    return arr[i] * (1 - t) + arr[(i + 1) % N] * t;
  };

  /** 차가 움직일 수 있는 좌우 한계 (방호벽, 피트월) */
  track.limits = (d, lat) => {
    let left = sample(wallL, d), right = -sample(wallR, d);
    if (inPitWall(d)) {
      if (lat > pitWallOffset) right = pitWallOffset + 0.3;
      else left = pitWallOffset - 0.3;
    }
    return { left, right };
  };

  /** 그 위치의 노면: 'track' | 'kerb' | 'runoff' | 'sand' | 'pit' */
  track.surface = (d, lat) => {
    const a = Math.abs(lat);
    if (a <= hw) return 'track';
    const kb = sample(kerb, d) > 0.5;
    if (kb && a <= hw + TRACK.kerbWidth) return 'kerb';
    if (inPitZone(d) && lat < 0) {
      const off = pitLaneOffset(pitS(d));
      if (Math.abs(lat - off) < PIT.laneWidth / 2 + 0.5) return 'pit';
    }
    const ro = lat > 0 ? sample(runoffL, d) : sample(runoffR, d);
    if (a <= hw + ro) return 'runoff';
    return 'sand';
  };
  track.hasKerb = (d) => sample(kerb, d) > 0.5;

  return track;
}

// ------------------------------------------------------------
// 3) 트랙 3D 메시 만들기
// ------------------------------------------------------------

/**
 * 중심선을 따라가는 띠 메시. fnA/fnB(i)는 { o: 옆 거리, y: 높이, u } 를 돌려줘요.
 * vertical=true 면 u를 진행 방향, v를 높이 방향으로 써요 (벽 텍스처용).
 */
function ribbon(track, i0, count, fnA, fnB, vScale, vertical = false) {
  const { pts, N, step } = track;
  const pos = new Float32Array(count * 6);
  const uv = new Float32Array(count * 4);
  const index = [];
  for (let j = 0; j < count; j++) {
    const i = (i0 + j + N) % N;
    const p = pts[i];
    const A = fnA(i), B = fnB(i);
    pos.set([p.x + p.nx * A.o, A.y, p.z + p.nz * A.o, p.x + p.nx * B.o, B.y, p.z + p.nz * B.o], j * 6);
    const s = (j * step) / vScale;
    if (vertical) uv.set([s, A.u, s, B.u], j * 4);
    else uv.set([A.u, s, B.u, s], j * 4);
    if (j < count - 1) {
      const a = j * 2, b = a + 1, c = a + 2, e = a + 3;
      index.push(a, b, c, b, e, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** 배열에서 값이 켜져 있는 연속 구간 찾기 (닫힌 루프) */
function runs(arr, N) {
  const out = [];
  let start = -1;
  for (let i = 0; i < N; i++) {
    const on = arr[i] > 0.5;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push([start, i - start]); start = -1; }
  }
  if (start >= 0) {
    if (out.length && out[0][0] === 0) out[0] = [start, N - start + out[0][1]];
    else out.push([start, N - start]);
  }
  return out;
}

// 실사 텍스처 불러오기 (assets/tex, Poly Haven CC0)
const texLoader = new THREE.TextureLoader();
function pbr(name, maps, { color = true } = {}) {
  const out = {};
  for (const [key, file] of Object.entries(maps)) {
    const t = texLoader.load(`assets/tex/${name}_${file}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    if (key === 'map' && color) t.colorSpace = THREE.SRGBColorSpace;
    out[key] = t;
  }
  return out;
}

export function buildTrackMeshes(track, scene) {
  const { N, hw, wallL, wallR, runoffL, runoffR } = track;
  const group = new THREE.Group();
  scene.add(group);
  const kw = TRACK.kerbWidth;

  const mesh = (geo, mat, { cast = false, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    group.add(m);
    return m;
  };

  // ---------- 노면 ----------
  const TILE = 1.6; // 아스팔트 텍스처 한 장 = 1.6m
  const roadMat = new THREE.MeshStandardMaterial({
    ...pbr('asphalt_track', { map: 'diffuse', normalMap: 'nor_gl', roughnessMap: 'rough' }),
    color: 0xffffff, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.72, envMapIntensity: 0.3,
  });
  // 폭 방향으로 10칸으로 나누고 칸마다 밝기를 조금씩 달리해요 (차들이 지나간 라인은 고무가 묻어 어둡고 매끈)
  const LANES = 10;
  const noise1 = (x) => Math.sin(x * 0.013) * 0.5 + Math.sin(x * 0.041 + 1.7) * 0.3 + Math.sin(x * 0.11 + 4.2) * 0.2;
  const shade = (i, f) => {
    const d = i * track.step;
    // 레이싱 라인: 코너 바깥에서 안쪽(에이펙스)으로 이동해요
    const k = track.k[i];
    const line = clamp(0.5 - Math.sign(k) * track.corner[i] * 0.32, 0.18, 0.82);
    const rubber = Math.exp(-((f - line) ** 2) / 0.02) * 0.2;
    return clamp(1 - rubber + noise1(d + f * 37) * 0.06, 0.7, 1.1);
  };
  roadMat.vertexColors = true;
  for (let L = 0; L < LANES; L++) {
    const f0 = L / LANES, f1 = (L + 1) / LANES;
    const oA = hw + 0.3 - f0 * (2 * hw + 0.6), oB = hw + 0.3 - f1 * (2 * hw + 0.6);
    const geo = ribbon(track, 0, N + 1, () => ({ o: oA, y: 0, u: oA / TILE }), () => ({ o: oB, y: 0, u: oB / TILE }), TILE);
    const col = new Float32Array((N + 1) * 6);
    for (let j = 0; j <= N; j++) {
      const i = j % N;
      const a = shade(i, f0), b = shade(i, f1);
      col.set([a, a, a, b, b, b], j * 6);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mesh(geo, roadMat);
  }

  // 흰 경계선 (따로 칠해서 또렷하게)
  const paint = new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const s of [1, -1]) {
    mesh(ribbon(track, 0, N + 1, () => ({ o: s * hw, y: 0.003, u: 0 }), () => ({ o: s * (hw - 0.25), y: 0.003, u: 1 }), 4), paint);
  }

  // 런오프 (밝은 아스팔트)
  const runoffMat = new THREE.MeshStandardMaterial({
    ...pbr('asphalt_pit_lane', { map: 'diffuse', normalMap: 'nor_gl' }),
    color: 0xb8b8bc, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const RT = 2.5;
  mesh(ribbon(track, 0, N + 1, (i) => ({ o: hw + runoffL[i], y: -0.004, u: (hw + runoffL[i]) / RT }), () => ({ o: hw, y: -0.004, u: hw / RT }), RT), runoffMat);
  mesh(ribbon(track, 0, N + 1, () => ({ o: -hw, y: -0.004, u: -hw / RT }), (i) => ({ o: -hw - runoffR[i], y: -0.004, u: (-hw - runoffR[i]) / RT }), RT), runoffMat);

  // ---------- 연석: 가운데가 볼록하고 홈이 파인 빨강/흰 연석 + 바깥 초록 페인트 ----------
  const kerbTex = TX.makeKerb();
  const kerbNormal = TX.makeKerbNormal();
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, normalMap: kerbNormal, roughness: 0.5 });
  const greenMat = new THREE.MeshStandardMaterial({ map: TX.makeGreenPaint(), roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const [i0, len] of runs(track.kerb, N)) {
    for (const s of [1, -1]) {
      // 단면: 안쪽 끝(낮음) → 볼록한 가운데 → 바깥 끝
      const prof = [[0, 0.004], [0.25, 0.035], [0.7, 0.06], [1.1, 0.055], [kw, 0.03]];
      for (let k = 0; k < prof.length - 1; k++) {
        const [o1, y1] = prof[k], [o2, y2] = prof[k + 1];
        const a = { o: s * (hw + o2), y: y2, u: o2 / kw }, b = { o: s * (hw + o1), y: y1, u: o1 / kw };
        mesh(ribbon(track, i0, len + 1, () => (s > 0 ? a : b), () => (s > 0 ? b : a), 2.5), kerbMat);
      }
      // 바깥쪽 초록 페인트 띠 (코너 바깥에서 많이 보는 그 띠)
      const g1 = { o: s * (hw + kw + 2.2), y: 0.001, u: 1 }, g2 = { o: s * (hw + kw), y: 0.001, u: 0 };
      mesh(ribbon(track, i0, len + 1, () => (s > 0 ? g1 : g2), () => (s > 0 ? g2 : g1), 3), greenMat);
    }
  }

  // ---------- 방호벽 ----------
  buildBarriers(track, group);

  // ---------- 피트레인 ----------
  const pitIdx0 = Math.floor(track.wrap(PIT.startD) / track.step);
  const pitCount = Math.ceil(track.pitLen / track.step) + 1;
  const pitOff = (i) => track.pitLaneOffset(track.pitS(i * track.step));
  const pitMat = new THREE.MeshStandardMaterial({
    ...pbr('asphalt_track', { map: 'diffuse', normalMap: 'nor_gl', roughnessMap: 'rough' }),
    color: 0xb0b0b6, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  mesh(ribbon(track, pitIdx0, pitCount,
    (i) => ({ o: pitOff(i) + PIT.laneWidth / 2, y: 0.002, u: (pitOff(i) + PIT.laneWidth / 2) / TILE }),
    (i) => ({ o: pitOff(i) - PIT.laneWidth / 2, y: 0.002, u: (pitOff(i) - PIT.laneWidth / 2) / TILE }), TILE), pitMat);
  for (const e of [1, -1]) {
    mesh(ribbon(track, pitIdx0, pitCount,
      (i) => ({ o: pitOff(i) + e * (PIT.laneWidth / 2 - 0.1) + 0.12, y: 0.005, u: 0 }),
      (i) => ({ o: pitOff(i) + e * (PIT.laneWidth / 2 - 0.1) - 0.12, y: 0.005, u: 1 }), 4), paint);
  }

  // ---------- 사막 ----------
  const sand = pbr('dense_sand', { map: 'diffuse' });
  sand.map.repeat.set(1600, 1600);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: sand.map, color: 0xe6d2b0, roughness: 1 }));
  ground.position.set(400, -0.03, 0);
  ground.receiveShadow = true;
  group.add(ground);

  buildLineMarkings(track, group);
  buildBrakingBoards(track, group);
  group.userData.reflective = [roadMat, runoffMat, pitMat];
  return group;
}

/**
 * 실제 서킷 방호벽:
 *  - 3단 W자 강철 가드레일(Armco) + 기둥
 *  - 그 위 철망(debris fence)과 기둥
 *  - 코너 바깥: 빨강/흰 충격흡수 블록(TecPro)
 *  - 메인 직선 왼쪽: 광고판이 붙은 콘크리트 벽
 */
function buildBarriers(track, group) {
  const { N, step, wallL, wallR } = track;
  const steel = new THREE.MeshStandardMaterial({ color: 0xb4b9c1, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x7d838c, metalness: 0.7, roughness: 0.45 });
  const fenceMat = new THREE.MeshStandardMaterial({ map: TX.makeFence(), alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
  const conc = pbr('concrete_wall_008', { map: 'diffuse', normalMap: 'nor_gl', roughnessMap: 'rough' });
  const concreteMat = new THREE.MeshStandardMaterial({ ...conc, color: 0xd8d8d8, side: THREE.DoubleSide });
  const adMat = new THREE.MeshStandardMaterial({ map: TX.makeWall(), roughness: 0.6, side: THREE.DoubleSide });

  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
  };
  const isConcrete = (side, d) => side > 0 && track.wrap(d + 380) < 700; // 메인 직선 왼쪽 (관중석 앞)
  const skipPit = (side, d) => side < 0 && track.pitS(d) > 20 && track.pitS(d) < track.pitLen - 20;

  // W자 가드레일 단면 (트랙 쪽으로 볼록한 두 줄)
  const W_PROFILE = [[0, -0.16], [0.07, -0.11], [0.07, -0.06], [0.01, 0], [0.07, 0.06], [0.07, 0.11], [0, 0.16]];
  const RAILS = [0.5, 0.88, 1.26];

  const postSpots = [], fencePostSpots = [], tecpro = [];
  for (const side of [1, -1]) {
    const wall = side > 0 ? wallL : wallR;
    const kind = (i) => {
      const d = i * step;
      if (skipPit(side, d)) return 0;
      return isConcrete(side, d) ? 2 : 1;
    };
    for (const type of [1, 2]) {
      for (const [i0, len] of runs(Array.from({ length: N }, (_, i) => (kind(i) === type ? 1 : 0)), N)) {
        const off = (i, extra = 0) => side * (wall[i] - extra);
        if (type === 1) {
          for (const hc of RAILS) {
            for (let k = 0; k < W_PROFILE.length - 1; k++) {
              const [e1, y1] = W_PROFILE[k], [e2, y2] = W_PROFILE[k + 1];
              add(ribbon(track, i0, len + 1, (i) => ({ o: off(i, e1), y: hc + y1, u: 0 }), (i) => ({ o: off(i, e2), y: hc + y2, u: 1 }), 4), steel);
            }
          }
        } else {
          // 콘크리트 벽 (앞면 + 윗면) + 광고판
          add(ribbon(track, i0, len + 1, (i) => ({ o: off(i), y: 0, u: 0 }), (i) => ({ o: off(i), y: 1.25, u: 0.5 }), 3, true), concreteMat);
          add(ribbon(track, i0, len + 1, (i) => ({ o: off(i, -0.4), y: 1.25, u: 0 }), (i) => ({ o: off(i), y: 1.25, u: 0.2 }), 3), concreteMat);
          add(ribbon(track, i0, len + 1, (i) => ({ o: off(i, 0.02), y: 0.15, u: 0 }), (i) => ({ o: off(i, 0.02), y: 1.1, u: 1 }), side > 0 ? 48 : -48, true), adMat, false);
        }
        // 철망
        const fBase = type === 1 ? 1.45 : 1.25;
        add(ribbon(track, i0, len + 1, (i) => ({ o: off(i, -0.15), y: fBase, u: 0 }), (i) => ({ o: off(i, -0.15), y: fBase + 3, u: 1 }), 4, true), fenceMat, false);
        for (let j = 0; j <= len; j++) {
          const i = (i0 + j) % N;
          const p = track.pts[i];
          const o = off(i, -0.18);
          const pos = [p.x + p.nx * o, p.z + p.nz * o, p.h];
          if (type === 1 && j % 1 === 0) postSpots.push(pos);
          if (j % 2 === 0) fencePostSpots.push([...pos, fBase]);
        }
      }
    }
    // 코너 바깥쪽 TecPro 블록 (가드레일 앞)
    let n = 0;
    for (let d = 0; d < track.L;) {
      const i = Math.floor(d / step) % N;
      // 바깥쪽 벽은 중심선보다 길어서, 곡률만큼 촘촘하게 걸어야 블록이 붙어요
      d += 1.18 / (1 + Math.abs(track.k[i]) * wall[i]);
      if (kind(i) !== 1) continue;
      const outside = Math.sign(track.k[i]) * side < 0;
      if (!outside || track.corner[i] < 0.35) continue;
      const p = track.poseAt(d, side * (wall[i] - 0.75));
      tecpro.push([p.x, p.z, p.h, n++ % 2]);
    }
  }

  // 기둥들 (인스턴싱으로 한 번에)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const inst = (geo, mat, spots, place, cast = true) => {
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((sp, i) => im.setMatrixAt(i, place(sp)));
    im.castShadow = cast;
    im.receiveShadow = true;
    group.add(im);
    return im;
  };
  inst(new THREE.BoxGeometry(0.12, 1.5, 0.1).translate(0, 0.75, 0), postMat, postSpots, ([x, z, h]) => m4.compose(v.set(x, 0, z), q.setFromEuler(e.set(0, h, 0)), one));
  inst(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 8).translate(0, 1.55, 0), postMat, fencePostSpots, ([x, z, h, b]) => m4.compose(v.set(x, b, z), q.setFromEuler(e.set(0, h, 0)), one));
  const tp = inst(new THREE.BoxGeometry(1.15, 1.0, 1.15).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ map: TX.makeTecpro(), roughness: 0.6 }), tecpro,
    ([x, z, h]) => m4.compose(v.set(x, 0, z), q.setFromEuler(e.set(0, h, 0)), one));
  const white = new THREE.Color(0xf0f0f0), red = new THREE.Color(0xd01025);
  tecpro.forEach(([, , , c], i) => tp.setColorAt(i, c ? red : white));
}

/** 출발선, 그리드 칸, 피트레인 선 */
function buildLineMarkings(track, group) {
  const paint = new THREE.MeshStandardMaterial({
    color: 0xf2f0ea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const geos = [];
  const quad = (d, lat, w, l, y = 0.002) => {
    const p = track.poseAt(d, lat);
    const g = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
    g.rotateY(p.h);
    g.translate(p.x, y, p.z);
    geos.push(g);
  };
  // 출발/결승선
  quad(0, 0, TRACK.width, 0.6);
  // 그리드 칸 (왼쪽/오른쪽 엇갈리게 10줄)
  for (let r = 0; r < 10; r++) {
    for (const [side, lag] of [[1, 0], [-1, 8]]) {
      const d = -10 - r * 16 - lag;
      const lat = side * 3.4;
      quad(d, lat, 2.6, 0.22);
      quad(d - 0.5, lat + 1.2, 0.18, 1.0);
      quad(d - 0.5, lat - 1.2, 0.18, 1.0);
    }
  }
  const m = new THREE.Mesh(mergeGeometries(geos), paint);
  m.receiveShadow = true;
  group.add(m);

  // 결승선 옆 체크무늬
  const chk = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.width, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: TX.makeCheckered(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const p = track.poseAt(1.2, 0);
  chk.rotation.y = p.h;
  chk.position.set(p.x, 0.002, p.z);
  chk.receiveShadow = true;
  group.add(chk);
}

/** 급한 코너 앞에 300/200/100 브레이킹 표지판 */
function buildBrakingBoards(track, group) {
  const { k, N, step, wrap } = track;
  const textures = { 300: TX.makeBoard('300'), 200: TX.makeBoard('200'), 100: TX.makeBoard('100') };
  const postMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8);
  const boardGeo = new THREE.PlaneGeometry(0.9, 1.1);
  let lastEntry = -1e9;
  for (let i = 0; i < N; i++) {
    const d = i * step;
    const tight = Math.abs(k[i]) > 1 / 45;
    const prevTight = Math.abs(k[(i - 1 + N) % N]) > 1 / 45;
    if (!tight || prevTight || d - lastEntry < 400) continue;
    // 앞 400m 동안 비교적 직선이었을 때만 (진짜 브레이킹 구간)
    let straight = true;
    for (let j = 40; j < 200; j++) if (Math.abs(k[(i - j + N) % N]) > 1 / 120) { straight = false; break; }
    if (!straight) continue;
    lastEntry = d;
    const side = -Math.sign(k[i]) || 1; // 코너 바깥쪽
    for (const dist of [300, 200, 100]) {
      const dd = wrap(d - dist - 20);
      const ii = Math.floor(dd / step) % N;
      const wall = side > 0 ? track.wallL[ii] : track.wallR[ii];
      const lat = side * Math.min(wall - 1.5, track.hw + 5);
      const p = track.poseAt(dd, lat);
      const board = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ map: textures[dist], roughness: 0.5 }));
      board.position.set(p.x, 1.6, p.z);
      board.rotation.y = p.h + Math.PI;
      board.castShadow = true;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(p.x, 0.7, p.z);
      group.add(board, post);
    }
  }
}

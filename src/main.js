import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BAHRAIN } from './bahrain-data.js';
import { TRACK, TYRE, CAR } from './config.js';
import { CornerGuard } from './guard.js';
import { setMaxAnisotropy } from './textures.js';
import { createTrack, buildTrackMeshes } from './track.js';
import { buildEnvironment, makeReflectionEnv } from './environment.js';
import { createCar } from './car.js';
import { CarPhysics, SURFACE } from './physics.js';
import { CameraRig } from './cameras.js';
import { PitStop } from './pitstop.js';
import { Hud, fmtTime } from './hud.js';
import { Net } from './net.js';
import { RemoteCars, RACE_LAPS } from './race.js';
import { AiField } from './ai.js';
import { createTuning } from './tuning.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SECTORS = [0.31, 0.7]; // 구간 경계 (한 바퀴 대비 비율)
const BEST_KEY = 'bahrainBestLap.v1';

// ============================================================
// 렌더러 · 후처리
// ============================================================
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);

const target = new THREE.WebGLRenderTarget(innerWidth * pixelRatio, innerHeight * pixelRatio, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
// NaN·Inf 픽셀 정리: 블룸이 이런 픽셀 하나를 검은 사각형으로 번지게 해서 깜빡임이 생김
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = !(c.r < 1e4 && c.g < 1e4 && c.b < 1e4) || !(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0);
      gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(min(c.rgb, vec3(32.0)), c.a);
    }`,
}));
// 속도감: 화면 가장자리가 중심 방향으로 번져요 (빠를수록, 가속할수록 강하게)
const speedBlur = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float k = amount * smoothstep(0.12, 0.6, length(d));
      vec4 c = vec4(0.0);
      for (int i = 0; i < 10; i++) c += texture2D(tDiffuse, vUv - d * k * float(i) / 9.0);
      gl_FragColor = c / 10.0;
    }`,
});
composer.addPass(speedBlur);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.55, 1.0));
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ============================================================
// 입력
// ============================================================
const input = { left: false, right: false, up: false, down: false, drift: false };
const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Space: 'drift' };
addEventListener('keydown', (e) => {
  if (KEYS[e.code]) { input[KEYS[e.code]] = true; e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.code === 'KeyC' && game.state !== 'menu') cams.toggle();
  if (e.code === 'KeyP') togglePitRequest();
  if (e.code === 'KeyG' && tuning) tuning.toggle();
  if (e.code === 'KeyR' && game.session !== 'race' && (game.state === 'running' || game.state === 'countdown')) startSession(game.session);
  if (e.code === 'Enter' && game.state === 'lobby') toggleReady();
  if (e.code === 'Escape') togglePause();
});
addEventListener('keyup', (e) => { if (KEYS[e.code]) input[KEYS[e.code]] = false; });
addEventListener('blur', () => { for (const k in input) input[k] = false; });

// ============================================================
// 게임 상태
// ============================================================
let track, env, car, phys, cams, pit, hud, net, remotes, ai, guard, tuning;
// 친구와 레이스 상태
const race = { id: null, slot: -1, finished: false, finishTime: null, endAt: 0, resultsShown: false, uiT: 0 };
const game = { state: 'loading', session: 'attack', time: 0, countdown: 0, lightsOutAt: 0, prevState: null };
const timing = {};
const fx = { kerb: 0, sand: 0, kerbSide: 0, phase: 0 };
let loc = null;
let radioStep = 0;
let displayT = 0;

function loadBest() {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY));
    return v && typeof v.time === 'number' ? v : null;
  } catch { return null; }
}
function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ }
}

function gridPose(k) {
  const row = Math.floor(k / 2), right = k % 2 === 1;
  return track.poseAt(-10 - row * 16 - (right ? 8 : 0), right ? -3.4 : 3.4);
}

function startSession(type) {
  game.session = type;
  hud.setSession(type);
  hud.show(true);
  ['menu', 'pause', 'results'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById('lobby').classList.toggle('hidden', type !== 'race');
  document.getElementById('standings').classList.add('hidden');
  if (type === 'race') { net.askName(); net.ensureRoom(); }
  net.set({ mode: type, phase: type === 'race' ? 'lobby' : 'drive', ready: false, start: null, rid: null, rp: null });
  race.slot = -1;
  resetRun(gridPose(0));

  game.time = 0;
  ai.hide();
  if (type === 'gp') {
    // AI 7대와 레이스: 나는 6번 그리드에서 출발
    resetRun(gridPose(5));
    ai.reset([0, 1, 2, 3, 4, 6, 7].map(gridPose));
    Object.assign(race, { id: 'gp', finished: false, finishTime: null, resultsShown: false, uiT: 0 });
    document.getElementById('standings').classList.remove('hidden');
    game.state = 'countdown';
    game.countdown = 0;
    game.lightsOutAt = 4.4 + Math.random() * 1.2;
    hud.message(`🏁 ${RACE_LAPS}바퀴 그랑프리! 6번 그리드에서 출발 — 신호등이 꺼지면 출발`, 4, 'good');
  } else if (type === 'attack') {
    game.state = 'countdown';
    game.countdown = 0;
    game.lightsOutAt = 4.4 + Math.random() * 1.2;
    hud.message('신호등이 모두 꺼지면 출발!', 3);
  } else if (type === 'race') {
    game.state = 'lobby';
    hud.setLights(0, false);
    hud.message('🏁 레이스 대기실 — 모두 <b>Enter</b>(준비)를 누르면 출발해요', 5);
  } else {
    game.state = 'running';
    hud.setLights(0, false);
    hud.message('자유 주행 — 마음껏 달려 보세요', 3);
  }
}

/** 차를 그 위치에 세우고 랩 기록을 처음부터 */
function resetRun(p) {
  phys.reset(p.x, p.z, p.h);
  phys.newTyres();
  guard.reset();
  pit.reset();
  resetWheels();
  cams.override = null;
  cams.snap(phys);
  loc = track.locate(phys.x, phys.z);
  radioStep = 0;

  const best = loadBest();
  Object.assign(timing, {
    prog: loc.d > track.L / 2 ? loc.d - track.L : loc.d,
    lastD: loc.d,
    lap: 1,
    lapStart: 0,
    sector: 0,
    sectorStart: 0,
    trace: [],
    hadPit: false,
    best: best?.time ?? null,
    bestTrace: best?.trace ?? null,
    bestSectors: best?.sectors ?? [null, null, null],
  });
  hud.setLap(1);
  hud.setLapTime(0);
  hud.setDelta(null);
  [0, 1, 2].forEach((i) => hud.setSector(i, null));
  hud.setBest(timing.best);
  hud.setLast(null, false);
  hud.setPitTimer(null);
}

function resetWheels() {
  car.wheels.forEach((w) => { w.mount.position.set(0, 0, 0); w.spin.visible = true; });
}

function togglePause() {
  if (game.state === 'running' || game.state === 'countdown') {
    game.prevState = game.state;
    game.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
  } else if (game.state === 'paused') {
    game.state = game.prevState;
    document.getElementById('pause').classList.add('hidden');
  }
}

function showMenu() {
  game.state = 'menu';
  hud.show(false);
  ai.hide();
  net.set({ mode: 'menu', phase: null, ready: false, start: null, rid: null, rp: null });
  ['lobby', 'results', 'standings'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  const best = loadBest();
  document.getElementById('menuBest').innerHTML = best ? `최고 랩 <b>${fmtTime(best.time)}</b>` : '';
}

function togglePitRequest() {
  if (game.state !== 'running' || pit.active) return;
  pit.requested = !pit.requested;
  if (pit.requested) hud.message('📻 <b>BOX, BOX.</b> 이번 랩 끝에 피트로 들어와요', 4, 'box');
  else hud.message('📻 피트인 취소. 계속 달려요', 2.5);
}

// ============================================================
// 친구와 레이스: 대기실 → 동시에 출발 → 순위
// ============================================================
function toggleReady() {
  net.set({ ready: !net.state.ready });
  renderLobby(true);
}

/** 대기실에 있는 사람들 (나 포함), peer 이름순으로 정렬 → 그리드 순서 */
function lobbyPlayers() {
  const list = [];
  if (net.me) list.push({ peer: net.me.peer, me: true, ready: !!net.state.ready, name: '나' });
  net.peers.forEach((p, i) => {
    const pr = p.presence || {};
    if (pr.mode === 'race' && pr.phase === 'lobby') list.push({ peer: p.peer, me: false, ready: !!pr.ready, name: net.nameOf(p, i), p });
  });
  return list.sort((a, b) => (a.peer < b.peer ? -1 : 1));
}

function updateLobby(dt) {
  const players = lobbyPlayers();
  const myIdx = players.findIndex((p) => p.me);
  if (myIdx >= 0 && myIdx !== race.slot) {
    race.slot = myIdx;
    resetRun(gridPose(myIdx));
  }
  race.uiT -= dt;
  if (race.uiT <= 0) { race.uiT = 0.25; renderLobby(false, players); }
  // 가장 앞 사람이 '호스트': 2명 이상이 모두 준비되면 출발 시각을 정해요
  const host = players[0];
  const allReady = players.length >= 2 && players.every((p) => p.ready);
  if (host && host.me && allReady && !net.state.start) {
    const now = Date.now();
    net.set({ start: { id: Math.random().toString(36).slice(2, 10), at: now + 5500, sent: now, grid: players.map((p) => p.peer) } });
  }
  const start = host ? (host.me ? net.state.start : host.p.presence.start) : null;
  if (start && typeof start.id === 'string' && start.id !== race.id && Array.isArray(start.grid) && net.me && start.grid.includes(net.me.peer)) {
    // 호스트 시계 기준 출발 시각을 내 시계로 바꿔요 (받은 시각 + 남은 시간)
    const localStart = host.me ? start.at : host.p.updatedAt + (start.at - start.sent);
    beginRace(start, localStart);
  }
}

function renderLobby(force, players = lobbyPlayers()) {
  const el = document.getElementById('lobbyList');
  const info = document.getElementById('roomInfo');
  const code = net.code ? `방 코드 <b>${net.code}</b>` : '';
  if (info.innerHTML !== code) info.innerHTML = code;
  if (!net.ready || !net.me) { el.innerHTML = '<div class="lobby-note">방에 연결 중…</div>'; return; }
  el.innerHTML = '';
  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = `lobby-row ${p.ready ? 'ready' : ''}`;
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = `P${i + 1}`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.me ? `${p.name} (나)` : p.name;
    const st = document.createElement('span');
    st.className = 'state';
    st.textContent = p.ready ? '준비 완료' : '대기 중';
    row.append(pos, name, st);
    el.append(row);
  });
  if (players.length < 2) {
    const note = document.createElement('div');
    note.className = 'lobby-note';
    note.textContent = '친구를 기다리는 중… (친구도 RACE를 눌러야 해요)';
    el.append(note);
  }
  document.getElementById('readyBtn').textContent = net.state.ready ? '준비 취소 (Enter)' : '준비 완료 (Enter)';
}

function beginRace(start, localStart) {
  race.id = start.id;
  race.finished = false;
  race.finishTime = null;
  race.resultsShown = false;
  resetRun(gridPose(start.grid.indexOf(net.me.peer)));
  game.time = 0;
  game.state = 'countdown';
  game.countdown = 0;
  game.lightsOutAt = Math.max(1, (localStart - Date.now()) / 1000);
  net.set({ phase: 'race', ready: false, rid: race.id, rp: [race.id, Math.round(timing.prog), null] });
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('standings').classList.remove('hidden');
  hud.message(`🏁 ${RACE_LAPS}바퀴 레이스! 신호등이 꺼지면 출발`, 4, 'good');
}

/** 같은 레이스에 참가한 사람들의 순위 */
function raceStandings() {
  const list = [{ me: true, name: '나', prog: timing.prog, fin: race.finishTime }];
  if (game.session === 'gp') ai.cars.forEach((a) => list.push({ me: false, name: a.name, prog: a.prog, fin: a.fin }));
  else net.peers.forEach((p, i) => {
    const rp = p.presence && p.presence.rp;
    if (Array.isArray(rp) && rp[0] === race.id && typeof rp[1] === 'number') {
      list.push({ me: false, name: net.nameOf(p, i), prog: rp[1], fin: typeof rp[2] === 'number' ? rp[2] : null });
    }
  });
  return list.sort((a, b) => {
    if (a.fin != null && b.fin != null) return a.fin - b.fin;
    if (a.fin != null) return -1;
    if (b.fin != null) return 1;
    return b.prog - a.prog;
  });
}

function renderStandings(list) {
  const el = document.getElementById('standingsList');
  el.innerHTML = '';
  const leader = list[0];
  list.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = `st-row ${s.me ? 'me' : ''}`;
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = i + 1;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.name;
    const info = document.createElement('span');
    info.className = 'info';
    if (s.fin != null) info.textContent = i === 0 ? fmtTime(s.fin) : `+${fmtTime(s.fin - leader.fin)}`;
    else info.textContent = `LAP ${Math.min(RACE_LAPS, Math.max(1, Math.floor(s.prog / track.L) + 1))}`;
    row.append(pos, name, info);
    el.append(row);
  });
}

function finishRace() {
  race.finished = true;
  race.finishTime = game.time;
  race.endAt = performance.now() + 45000;
  net.set({ rp: [race.id, Math.round(timing.prog), race.finishTime] });
  const pos = raceStandings().findIndex((s) => s.me) + 1;
  hud.message(`🏁 피니시! <b>${pos}위</b> — ${fmtTime(race.finishTime)}`, 6, 'good');
}

function updateRace(dt) {
  race.uiT -= dt;
  if (race.uiT > 0) return;
  race.uiT = 0.25;
  const list = raceStandings();
  renderStandings(list);
  // 모두 들어왔거나, 내가 들어오고 45초가 지나면 결과 화면
  if (race.finished && !race.resultsShown && (list.every((s) => s.fin != null) || performance.now() > race.endAt)) {
    race.resultsShown = true;
    const el = document.getElementById('resultsList');
    el.innerHTML = '';
    const leader = list[0];
    list.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = `st-row ${s.me ? 'me' : ''}`;
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = i + 1;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.name;
      const info = document.createElement('span');
      info.className = 'info';
      info.textContent = s.fin == null ? 'DNF' : i === 0 ? fmtTime(s.fin) : `+${fmtTime(s.fin - leader.fin)}`;
      row.append(pos, name, info);
      el.append(row);
    });
    document.getElementById('results').classList.remove('hidden');
  }
}

// ============================================================
// 주행 한 프레임
// ============================================================
function stepRunning(dt) {
  game.time += dt;
  if (pit.active) {
    phys.guardSteer = phys.autoBrake = 0;
    const wasStopped = pit.stopped;
    const done = pit.update(dt, phys, car);
    timing.hadPit = true;
    cams.override = pit.stopped ? 'pit' : null;
    hud.setPitTimer(pit.stopped ? pit.stopTime : null);
    if (wasStopped && !pit.stopped) hud.message(`🔧 타이어 4개 교체 완료 — <b>${pit.lastStopTime.toFixed(2)}s</b>`, 3.5, 'good');
    if (done) {
      resetWheels();
      cams.override = null;
      hud.message('피트 출구 — 다시 레이스!', 2.5);
    }
    loc = track.locate(phys.x, phys.z, loc.idx);
    fx.kerb = fx.sand = 0;
  } else {
    // 왼쪽/오른쪽 바퀴가 각각 어떤 노면 위에 있는지
    const rel = Math.cos(phys.yaw - loc.h);
    const sL = track.surface(loc.d, loc.lat + CAR.halfTrack * rel);
    const sR = track.surface(loc.d, loc.lat - CAR.halfTrack * rel);
    const surf = {
      grip: (SURFACE[sL].grip + SURFACE[sR].grip) / 2,
      drag: (SURFACE[sL].drag + SURFACE[sR].drag) / 2,
    };
    fx.kerb = (sL === 'kerb' ? 0.5 : 0) + (sR === 'kerb' ? 0.5 : 0);
    fx.kerbSide = (sL === 'kerb' ? 1 : 0) - (sR === 'kerb' ? 1 : 0);
    fx.sand = (sL === 'sand' ? 0.5 : 0) + (sR === 'sand' ? 0.5 : 0);

    phys.cornerK = Math.abs(track.k[loc.idx] || 0);
    // 코너 정도 0~1 (코너 조금 전부터 커져요) → 코너에서만 핸들이 더 꺾여요
    const ct = clamp(((track.corner[loc.idx] || 0) - 0.1) / 0.3, 0, 1);
    phys.cornerAmt = ct * ct * (3 - 2 * ct);
    const SUB = 8;
    for (let i = 0; i < SUB; i++) phys.step(dt / SUB, input, surf);
    loc = track.locate(phys.x, phys.z, loc.idx);
    guard.update(dt, phys, loc, track.inPitZone(loc.d) && loc.lat < 0);
    collide();
    collideCars();
    if (pit.checkEntry(timing.lastD, loc)) {
      pit.begin(phys, loc);
      hud.message('피트레인 진입 — 제한속도 <b>80 km/h</b>', 3);
    }
  }
  if (!pit.active) pit.idle(dt);
  updateTiming();
  tyreRadio();
}

/** 방호벽에 부딪히면 튕겨 나와요 */
function collide() {
  const lim = track.limits(loc.d, loc.lat);
  const ext = TRACK.carHalfWidth + 1.7 * Math.abs(Math.sin(phys.yaw - loc.h));
  let side = 0, pen = 0;
  if (loc.lat > lim.left - ext) { side = 1; pen = loc.lat - (lim.left - ext); }
  else if (loc.lat < lim.right + ext) { side = -1; pen = lim.right + ext - loc.lat; }
  if (!side) return;
  const nx = loc.nx * side, nz = loc.nz * side; // 벽 쪽 방향
  phys.x -= nx * pen;
  phys.z -= nz * pen;
  const { vx, vz } = phys.worldVel();
  const vn = vx * nx + vz * nz;
  if (vn <= 0) return;
  const e = 0.3;
  const scrub = Math.max(0.55, 1 - vn * 0.025);
  phys.setWorldVel((vx - (1 + e) * vn * nx) * scrub, (vz - (1 + e) * vn * nz) * scrub);
  phys.r *= 0.4;
  if (vn > 2) cams.addShake(clamp(vn / 14, 0.15, 1.2));
  if (vn > 12) hud.message('💥 방호벽 충돌!', 1.6, 'box');
}

/** 다른 사람 차와 부딪힘: 차를 원 4개로 보고 겹치면 서로 밀어내요 (상대도 자기 쪽에서 똑같이 계산해요) */
const CAR_CIRCLES = [-1.7, -0.57, 0.57, 1.7];
const CAR_RADIUS = 0.98;
function collideCars() {
  const others = game.session === 'gp' ? ai.obstacles() : remotes.obstacles();
  if (!others.length) return;
  const sy = Math.sin(phys.yaw), cy = Math.cos(phys.yaw);
  for (const o of others) {
    if (Math.hypot(o.x - phys.x, o.z - phys.z) > 7) continue;
    const osy = Math.sin(o.yaw), ocy = Math.cos(o.yaw);
    let best = null;
    for (const a of CAR_CIRCLES) {
      const ax = phys.x + sy * a, az = phys.z + cy * a;
      for (const b of CAR_CIRCLES) {
        const bx = o.x + osy * b, bz = o.z + ocy * b;
        const d = Math.hypot(ax - bx, az - bz);
        const pen = CAR_RADIUS * 2 - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: (ax - bx) / (d || 1), nz: (az - bz) / (d || 1), px: ax - phys.x, pz: az - phys.z };
      }
    }
    if (!best) continue;
    // 겹친 만큼 절반 밀려나요 (나머지 절반은 상대 화면에서)
    const push = o.ai ? 1 : 0.5; // AI 차는 밀리지 않아서 내가 다 밀려나요
    phys.x += best.nx * best.pen * push;
    phys.z += best.nz * best.pen * push;
    const { vx, vz } = phys.worldVel();
    const vn = (vx - o.vx) * best.nx + (vz - o.vz) * best.nz;
    if (vn >= 0) continue;
    // 살짝 튕기고 속도가 줄어드는 정도로만 (날아가거나 크게 돌지 않게)
    const e = 0.1;
    const j = Math.min(5, (-(1 + e) * vn) / 2);
    phys.setWorldVel((vx + best.nx * j) * 0.97, (vz + best.nz * j) * 0.97);
    phys.v *= 0.5; // 옆으로 미끄러지는 속도는 줄여서 바로 다시 운전할 수 있게
    phys.r = clamp(phys.r + clamp(((best.pz * best.nx - best.px * best.nz) * j * CAR.mass) / CAR.inertia * 0.08, -0.25, 0.25), -0.8, 0.8);
    cams.addShake(Math.min(1.2, -vn / 10));
    if (-vn > 6) hud.message('💥 충돌!', 1.2, 'box');
  }
}

function updateTiming() {
  const L = track.L;
  let dd = loc.d - timing.lastD;
  if (dd > L / 2) dd -= L;
  if (dd < -L / 2) dd += L;
  timing.lastD = loc.d;
  timing.prog += dd;
  if (game.session === 'race' && game.state === 'running') net.set({ rp: [race.id, Math.round(timing.prog), race.finishTime] });
  if (game.session === 'free') return;

  const lapT = game.time - timing.lapStart;
  const into = timing.prog - (timing.lap - 1) * L;
  const ti = Math.floor(into / 25);
  if (ti >= 0 && timing.trace[ti] == null) timing.trace[ti] = lapT;
  // 최고 랩과 같은 지점에서 비교한 시간 차이
  const bt = timing.bestTrace;
  if (bt && ti >= 0 && bt[ti] != null && bt[ti + 1] != null) {
    const f = into / 25 - ti;
    hud.setDelta(lapT - (bt[ti] + (bt[ti + 1] - bt[ti]) * f));
  } else hud.setDelta(null);

  if (timing.sector < 2 && into >= SECTORS[timing.sector] * L) {
    recordSector(timing.sector, lapT - timing.sectorStart);
    timing.sectorStart = lapT;
    timing.sector++;
  }
  if (into >= L) {
    recordSector(2, lapT - timing.sectorStart);
    completeLap(lapT);
  } else hud.setLapTime(lapT);
}

function recordSector(i, t) {
  const best = timing.bestSectors[i];
  const isBest = best == null || t < best;
  if (isBest) timing.bestSectors[i] = t;
  hud.setSector(i, t, isBest ? 'best' : 'done');
  timing.curSectors = timing.curSectors || [];
  timing.curSectors[i] = t;
}

function completeLap(lapT) {
  const prevBest = timing.best;
  const isBest = prevBest == null || lapT < prevBest;
  hud.setLast(lapT, timing.hadPit);
  if (isBest) {
    timing.best = lapT;
    timing.bestTrace = timing.trace.slice();
    saveBest({ time: lapT, trace: timing.bestTrace, sectors: timing.bestSectors });
    hud.setBest(lapT);
    hud.message(`🏁 LAP ${timing.lap} &nbsp;<b>${fmtTime(lapT)}</b> &nbsp;최고 기록!`, 4, 'good');
  } else {
    hud.message(`🏁 LAP ${timing.lap} &nbsp;<b>${fmtTime(lapT)}</b> &nbsp;(${fmtTime(lapT - prevBest, { sign: true })})`, 4);
    saveBest({ time: timing.best, trace: timing.bestTrace, sectors: timing.bestSectors });
  }
  timing.lap++;
  timing.lapStart = game.time;
  timing.sector = 0;
  timing.sectorStart = 0;
  timing.trace = [0];
  timing.hadPit = pit.active;
  hud.setLap(timing.lap);
  if ((game.session === 'race' || game.session === 'gp') && !race.finished && timing.lap > RACE_LAPS) finishRace();
  setTimeout(() => { if (timing.sector === 0) [0, 1, 2].forEach((i) => hud.setSector(i, null)); }, 4000);
}

function tyreRadio() {
  const worst = Math.max(...phys.wear);
  if (radioStep < TYRE.radioAt.length && worst >= TYRE.radioAt[radioStep]) {
    const pct = Math.round(worst * 100);
    const lines = [
      `📻 타이어 마모 <b>${pct}%</b> — 피트인하려면 <b>P</b>`,
      `📻 타이어가 많이 닳았어요 (<b>${pct}%</b>). 접지력이 떨어지는 중 — <b>P</b>로 피트인`,
      `📻 타이어 한계! (<b>${pct}%</b>) 지금 들어오는 걸 추천해요 — <b>P</b>`,
    ];
    if (!pit.requested && !pit.active) hud.message(lines[radioStep], 5, 'box');
    radioStep++;
  }
}

// ============================================================
// 화면 (차 모델, 핸들 화면, HUD)
// ============================================================
function updateCarVisual(dt) {
  car.root.position.set(phys.x, 0, phys.z);
  car.root.rotation.y = phys.yaw;
  // 연석·모래 위에서 덜컹거림
  const sp = phys.speed;
  fx.phase += dt * clamp(sp / 0.55, 0, 140) * Math.PI * 2;
  const kerbAmp = fx.kerb * clamp(sp / 25, 0.2, 1);
  const sandAmp = fx.sand * clamp(sp / 15, 0.2, 1);
  const bounce = kerbAmp * (0.012 * Math.abs(Math.sin(fx.phase)) + (Math.random() - 0.5) * 0.008) + sandAmp * (Math.random() - 0.5) * 0.035;
  car.body.position.y = bounce + pit.lift;
  const pitch = clamp(-phys.ax * 0.0016, -0.02, 0.025) + sandAmp * (Math.random() - 0.5) * 0.012;
  const roll = clamp(phys.ay * 0.001, -0.02, 0.02) + fx.kerbSide * kerbAmp * (0.006 + Math.sin(fx.phase * 0.5) * 0.006);
  car.body.rotation.x += (pitch - car.body.rotation.x) * Math.min(1, dt * 12);
  car.body.rotation.z += (roll - car.body.rotation.z) * Math.min(1, dt * 14);

  car.wheels.forEach((w, i) => {
    if (i < 2) w.pivot.rotation.y = phys.steer;
    w.spin.rotation.x = phys.wheelSpin;
  });
  car.steering.group.rotation.z = -phys.steerIn * 2.6;
  car.setBrake?.(phys.brake);
  // 액티브 에어로: 고속 직선에서 풀스로틀이면 날개가 눕고, 브레이크·코너에선 바로 다시 세워요
  const wantOpen = game.state === 'running' && !pit.active && phys.u > 230 / 3.6 && phys.throttle > 0.95 && Math.abs(phys.steerIn) < 0.15 ? 1 : 0;
  phys.aeroOpen = (phys.aeroOpen || 0) + (wantOpen - (phys.aeroOpen || 0)) * Math.min(1, dt * (wantOpen ? 4 : 10));
  car.setAero(phys.aeroOpen);
  document.getElementById('drs').classList.toggle('on', phys.aeroOpen > 0.5);
  if (car.rainLight) {
    const blink = pit.active && Math.floor(game.time * 4) % 2 === 0;
    car.rainLight.color.setRGB(blink ? 5 : 0.25, blink ? 0.2 : 0.01, blink ? 0.15 : 0.01);
  }

  // 핸들 화면 + 변속 표시등 (초당 15번 갱신)
  displayT -= dt;
  if (displayT <= 0) {
    displayT = 1 / 15;
    drawWheelDisplay();
  }
}

function drawWheelDisplay() {
  const { canvas: c, tex, leds } = car.steering;
  const g = c.getContext('2d');
  g.fillStyle = '#04060b';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffcc00';
  g.font = '900 72px "Titillium Web", sans-serif';
  const gear = phys.gear === -1 ? 'R' : phys.gear;
  g.fillText(String(gear), 128, 58);
  g.font = '700 30px "Titillium Web", sans-serif';
  g.fillStyle = '#f4f5f8';
  g.fillText(String(Math.round(phys.speed * 3.6)), 46, 58);
  const deltaEl = document.getElementById('delta');
  g.fillStyle = deltaEl.classList.contains('faster') ? '#19d36b' : '#ff5a6e';
  g.font = '700 22px "Titillium Web", sans-serif';
  g.fillText(game.session === 'attack' ? deltaEl.textContent || '' : '', 210, 58);
  g.fillStyle = 'rgba(244,245,248,0.7)';
  g.font = '600 18px "Titillium Web", sans-serif';
  g.fillText(`TYRE ${Math.round(Math.max(...phys.wear) * 100)}%   LAP ${timing.lap || 1}`, 128, 112);
  tex.needsUpdate = true;
  const frac = clamp((phys.rpm - 9500) / 3000, 0, 1);
  const on = Math.round(frac * leds.length);
  leds.forEach((m, i) => {
    const col = i < 4 ? [0.1, 2.2, 0.4] : i < 7 ? [2.6, 0.1, 0.1] : [0.4, 0.6, 3];
    if (i < on) m.color.setRGB(...col); else m.color.setRGB(0.04, 0.04, 0.05);
  });
}

function updateHud(dt) {
  hud.tick(dt);
  hud.setSpeed(phys.speed * 3.6, phys.gear, cams.active === 'cockpit');
  hud.setTyres(phys.wear);
  hud.setBox(pit.requested, pit.active);
  hud.drawMinimap(phys.x, phys.z, phys.yaw, game.session === 'gp' ? ai.dots() : []);
}

// ============================================================
// 메인 루프
// ============================================================
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (game.state === 'loading') return;
  update(dt);
  speedBlur.uniforms.amount.value = clamp((phys.speed * 3.6 - 80) / 240, 0, 1) * 0.12 + Math.max(0, cams.kick || 0) * 0.06;
  if (cams.active === 'cockpit') speedBlur.uniforms.amount.value *= 0.4; // 운전석에선 앞이 또렷하게
  composer.render();
}

function update(dt) {
  if (game.state === 'countdown') {
    game.countdown += dt;
    const n = Math.min(5, Math.floor(game.countdown / 0.85));
    if (game.countdown < game.lightsOutAt) {
      hud.setLights(n, true);
      env.startLights.set(n);
      // 출발 전: 브레이크 잡은 채 엔진만 (핸들은 움직여요)
      phys.throttle += ((input.up ? 1 : 0) - phys.throttle) * Math.min(1, dt * 8);
      phys.steerIn += (((input.left ? 1 : 0) - (input.right ? 1 : 0)) - phys.steerIn) * Math.min(1, dt * 6);
      phys.rpm += ((5000 + phys.throttle * 7500) - phys.rpm) * Math.min(1, dt * 6);
    } else {
      hud.setLights(0, false);
      env.startLights.set(0);
      game.state = 'running';
      game.time = 0;
      timing.lapStart = 0;
      hud.message('<b>LIGHTS OUT!</b> 출발!', 2, 'good');
    }
  } else if (game.state === 'running') {
    stepRunning(dt);
    if (game.session === 'gp') ai.update(dt, game.time, { prog: timing.prog, lat: pit.active ? 99 : loc.lat, v: phys.u }, RACE_LAPS);
  } else if (game.state === 'lobby') {
    updateLobby(dt);
  }
  if ((game.session === 'race' || game.session === 'gp') && (game.state === 'running' || game.state === 'countdown')) updateRace(dt);
  net.tick(dt, game.state === 'menu' || game.state === 'loading' ? null : phys);
  remotes.update(dt, (peer, i) => net.nameOf(peer, i));

  if (game.state !== 'menu') {
    updateCarVisual(dt);
    updateHud(dt);
  } else {
    // 메뉴 화면: 차 주위를 천천히 도는 카메라
    cams.override = 'pit';
  }
  env.update(phys.x, phys.z);
  cams.update(dt, phys, car, fx);
}

// ============================================================
// 시작
// ============================================================
async function init() {
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  track = createTrack(BAHRAIN.coords);
  guard = new CornerGuard(track);
  tuning = createTuning(guard);
  const trackGroup = buildTrackMeshes(track, scene);
  env = buildEnvironment(scene, track);
  const reflection = makeReflectionEnv(renderer, scene.background);
  trackGroup.userData.reflective.forEach((m) => { m.envMap = reflection; m.needsUpdate = true; });
  document.getElementById('loading').textContent = '차량 준비 중…';
  car = await createCar(reflection);
  scene.add(car.root);
  if (car.credit) document.getElementById('carCredit').textContent = `Car model: ${car.credit}`;
  phys = new CarPhysics();
  cams = new CameraRig(camera);
  pit = new PitStop(track, scene);
  hud = new Hud(track);
  net = new Net();
  remotes = new RemoteCars(net, scene, reflection);
  ai = new AiField(track, scene, reflection);
  net.init().then((ok) => {
    const btn = document.querySelector('[data-mode="race"] .d');
    if (!ok && btn) btn.textContent = '인터넷 연결이 필요해요. (지금은 혼자 연습)';
  });

  // 메뉴 뒤 배경: 그리드 위의 차
  const p = track.poseAt(-10, 3.4);
  phys.reset(p.x, p.z, p.h);
  updateCarVisual(0);

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('modeButtons').classList.remove('hidden');
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    cams.override = null;
    startSession(b.dataset.mode);
  }));
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.action;
    if (a === 'resume') togglePause();
    if (a === 'restart') startSession(game.session);
    if (a === 'menu') showMenu();
    if (a === 'lobby') startSession(game.session === 'gp' ? 'gp' : 'race');
    if (a === 'ready') toggleReady();
    if (a === 'invite') {
      const link = net.inviteLink();
      const done = () => hud.message('초대 링크를 복사했어요. 친구에게 보내 주세요!', 2.5, 'good');
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => prompt('이 링크를 친구에게 보내 주세요', link));
      else prompt('이 링크를 친구에게 보내 주세요', link);
    }
    if (a === 'join') {
      const c = prompt('친구에게 받은 방 코드를 입력하세요', '');
      if (c) { net.connect(c); race.slot = -1; }
    }
  }));
  showMenu();
  debugShot();
}

// 개발용: 주소 뒤에 ?shot=1&d=500&speed=70&cam=cockpit 처럼 붙이면 그 장면에서 바로 시작해요
function debugShot() {
  const q = new URLSearchParams(location.search);
  if (!q.has('shot')) return;
  if (q.get('mode') === 'race') {
    startSession('race');
    if (q.has('hold')) input.up = true;
    // 개발용 빨리 감기: ff초 만큼 게임을 미리 진행
    const ff = Number(q.get('ff') || 0);
    if (ff) setTimeout(() => { for (let i = 0; i < ff * 30; i++) update(1 / 30); }, 1500);
    return;
  }
  startSession('free');
  const d = Number(q.get('d') || 0), lat = Number(q.get('lat') || 0);
  const p = track.poseAt(d, lat);
  phys.reset(p.x, p.z, p.h + Number(q.get('yaw') || 0));
  phys.u = Number(q.get('speed') || 0);
  loc = track.locate(phys.x, phys.z);
  timing.lastD = loc.d;
  cams.snap(phys);
  if (q.get('cam') === 'cockpit') cams.mode = 'cockpit';
  if (q.get('cam') === 'orbit') { cams.override = 'show'; cams.showAngle = Number(q.get('angle') || 0.8); cams.showDist = Number(q.get('dist') || 7); cams.showHeight = Number(q.get('h') || 1.6); }
  if (q.has('hold')) input.up = true;
  if (q.has('freeze')) game.state = 'paused';
  if (q.has('noui')) hud.show(false);
}

init().catch((err) => {
  console.error(err);
  document.getElementById('loading').textContent = `오류가 났어요: ${err.message}`;
});
frame();

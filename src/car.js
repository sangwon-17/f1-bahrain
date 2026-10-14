import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR } from './config.js';
import { designF1, WHEELS } from './f1design.js';
import { buildMuscleCar } from './muscle.js';

// F1 차량: 3D 모델 파일(assets 폴더)이 있으면 그걸 쓰고, 없으면 코드로 만든 차를 써요.
// 어떤 경우든 같은 구조를 돌려줘요:
//   root(위치/방향) → body(기울기/덜컹거림) → 차체 + wheels[앞왼, 앞오, 뒤왼, 뒤오]
//   각 바퀴: pivot(앞바퀴 조향) → mount(피트스탑 때 빠지는 부분) → spin(굴러가는 회전)

// 모델 제작자 표기 (CC BY 4.0 라이선스 조건)
export const MODEL_CREDIT = '"2026 Redbull RB22" by Dave Love SketchFab (Tyler_Dave), CC BY 4.0 — sketchfab.com/3d-models/2026-redbull-rb22-0a3d24a58e0549d591a5a48c22eec383';

export const MODEL_CANDIDATES = [
  'assets/scene.gltf',
  'assets/scene.glb',
  'assets/model.glb',
  'assets/rb19.glb',
];

export async function createCar(envMap) {
  for (const url of MODEL_CANDIDATES) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) continue;
      const car = await loadModelCar(url, envMap);
      if (car) return car;
    } catch (err) {
      console.warn('모델을 불러오지 못했어요:', url, err);
    }
  }
  return buildProceduralCar(envMap);
}

// ------------------------------------------------------------
// 공통: 바퀴 구조 만들기
// ------------------------------------------------------------
function makeWheelRig(body, center) {
  const pivot = new THREE.Group();
  pivot.position.copy(center);
  const mount = new THREE.Group();
  const spin = new THREE.Group();
  pivot.add(mount);
  mount.add(spin);
  body.add(pivot);
  return { pivot, mount, spin, home: center.clone() };
}

function makeSteeringWheel() {
  const g = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.13, 0.035), carbon);
  const gl = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.1, 6, 12), grip);
  gl.position.set(-0.155, -0.005, 0);
  const gr = gl.clone();
  gr.position.x = 0.155;
  // 핸들 화면 (속도, 기어, 랩 차이를 그려 넣어요)
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(0, 0.012, -0.019);
  screen.rotation.y = Math.PI;
  // 위쪽 변속 표시등 (회전수에 따라 켜져요)
  const leds = [];
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 10), mat);
    led.position.set(-0.054 + i * 0.012, 0.052, -0.019);
    led.rotation.y = Math.PI;
    g.add(led);
    leds.push(mat);
  }
  // 버튼들
  const btnColors = [0xd61f3a, 0xffcc00, 0x1e90ff, 0x22c55e];
  btnColors.forEach((c, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
    b.rotation.x = Math.PI / 2;
    b.position.set(i < 2 ? -0.09 : 0.09, i % 2 ? -0.035 : 0.0, -0.02);
    g.add(b);
  });
  g.add(body, gl, gr, screen);
  return { group: g, canvas, tex, leds };
}

// ------------------------------------------------------------
// 3D 모델 파일 불러오기
// ------------------------------------------------------------
async function loadModelCar(url, envMap) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  // 1) 크기와 방향 맞추기: 가장 긴 수평 방향 = 앞뒤, 길이 5.63m
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  const holder = new THREE.Group();
  holder.add(model);
  if (size.x > size.z) model.rotation.y = Math.PI / 2;
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  size = box.getSize(new THREE.Vector3());
  const s = CAR.length / size.z;
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);

  // 2) 앞뒤 구분: 가장 높은 곳(뒷날개)이 있는 쪽이 뒤
  box = new THREE.Box3().setFromObject(holder);
  const top = box.max.y - (box.max.y - box.min.y) * 0.12;
  let zSum = 0, count = 0;
  const v = new THREE.Vector3();
  holder.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y > top) { zSum += v.z; count++; }
    }
  });
  const center = box.getCenter(new THREE.Vector3());
  if (count && zSum / count > center.z) model.rotation.y += Math.PI;
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  center.copy(box.getCenter(new THREE.Vector3()));
  holder.position.set(-center.x, -box.min.y, -center.z);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(holder);
  root.updateMatrixWorld(true);

  // 3) 재질 정리: 반사 환경, 그림자
  holder.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (m.isMeshStandardMaterial) {
        m.envMap = envMap;
        m.envMapIntensity = 1.2;
        m.needsUpdate = true;
      }
    });
  });

  // 4) 바퀴 찾기 (이름 → 위치 순서로 시도)
  const wheels = findModelWheels(holder, body)
    || [[0.8, 1.8], [-0.8, 1.8], [0.78, -1.8], [-0.78, -1.8]].map(([x, z]) => makeWheelRig(body, new THREE.Vector3(x, 0.36, z)));
  const steering = makeSteeringWheel();
  steering.group.position.set(0, 0.6, 0.62);
  steering.group.rotation.x = -0.25;
  body.add(steering.group);

  return {
    root, body, wheels, steering,
    eye: new THREE.Vector3(0, 0.8, 0.2),
    driverParts: [],
    isModel: true,
    setAero() {},
    credit: MODEL_CREDIT,
  };
}

function findModelWheels(holder, body) {
  holder.updateMatrixWorld(true);
  const isWheelName = (n) => /wheel|tyre|tire|rim|reifen|pneu/i.test(n);
  const quads = [[], [], [], []]; // 앞왼, 앞오, 뒤왼, 뒤오
  const b = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  const pick = (o) => {
    b.setFromObject(o);
    b.getCenter(c);
    b.getSize(sz);
    const q = (c.z > 0 ? 0 : 2) + (c.x > 0 ? 0 : 1); // +x = 왼쪽
    return { o, q, c: c.clone(), sz: sz.clone() };
  };
  const named = [];
  holder.traverse((o) => { if (o.isMesh && (isWheelName(o.name) || isWheelName(o.parent?.name || ''))) named.push(pick(o)); });
  let parts = named.filter((p) => Math.abs(p.c.x) > 0.4 && p.c.y < 0.6);
  if (parts.length < 4) {
    // 이름으로 못 찾으면: 네 귀퉁이에 있는 바퀴 크기의 부품
    parts = [];
    holder.traverse((o) => {
      if (!o.isMesh) return;
      const p = pick(o);
      if (Math.abs(p.c.x) > 0.55 && p.c.y > 0.15 && p.c.y < 0.55 && p.sz.y > 0.35 && p.sz.y < 0.85 && Math.abs(Math.abs(p.c.z) - 1.8) < 0.6) parts.push(p);
    });
  }
  parts.forEach((p) => quads[p.q].push(p));
  if (quads.some((q) => q.length === 0)) return null;
  return quads.map((list) => {
    const bb = new THREE.Box3();
    list.forEach((p) => bb.expandByObject(p.o));
    const centerW = bb.getCenter(new THREE.Vector3());
    const local = body.worldToLocal(centerW.clone());
    const rig = makeWheelRig(body, local);
    rig.spin.updateMatrixWorld(true);
    list.forEach((p) => rig.spin.attach(p.o));
    return rig;
  });
}

// ------------------------------------------------------------
// 코드로 만든 F1 (Red Bull 풍 — 무광 네이비 + 레드 + 옐로, 로고 없음)
// ------------------------------------------------------------
const NAVY = '#16224f', RED = '#d4102b', YELLOW = '#f5c400', CARBON = '#121316';

function canvasTex(w, h, draw, { repeat = false, color = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// 카본 직조 무늬
function carbonTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#101113';
    g.fillRect(0, 0, w, h);
    const s = 16;
    for (let y = 0; y < h; y += s / 2) {
      for (let x = 0; x < w; x += s) {
        const off = ((y / (s / 2)) % 2) * (s / 2);
        const grad = g.createLinearGradient(x + off, y, x + off + s / 2, y + s / 2);
        grad.addColorStop(0, '#1d1f24');
        grad.addColorStop(0.5, '#2c2f36');
        grad.addColorStop(1, '#16171a');
        g.fillStyle = grad;
        g.fillRect(x + off, y, s / 2, s / 2);
      }
    }
  }, { repeat: true });
}

// 차체 도장. u: 0 왼쪽 옆 → 0.25 위 → 0.5 오른쪽 옆 → 0.75 아래, v: 0 꼬리 → 1 노즈 끝
function chassisLivery() {
  return canvasTex(2048, 2048, (g, W, H) => {
    const U = (u) => u * W, V = (v) => (1 - v) * H; // 캔버스는 위가 v=1
    g.fillStyle = NAVY;
    g.fillRect(0, 0, W, H);
    // 아래쪽은 카본
    g.fillStyle = CARBON;
    g.fillRect(U(0.56), 0, U(0.38), H);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(U(0.54), 0, U(0.02), H);
    g.fillRect(U(0.94), 0, U(0.02), H);
    // 좌우 대칭으로 모양 그리기 (u → 0.5 - u)
    const sym = (fn) => { fn((u) => U(u)); fn((u) => U(0.5 - u)); };
    // 노즈: 빨간 띠 + 노란 끝
    sym((X) => {
      g.fillStyle = RED;
      g.beginPath();
      g.moveTo(X(0.06), V(0.86)); g.lineTo(X(0.25), V(0.88)); g.lineTo(X(0.25), V(0.95)); g.lineTo(X(0.04), V(0.93));
      g.fill();
    });
    g.fillStyle = YELLOW;
    g.fillRect(0, 0, W, V(0.955));
    // 노즈 위 노란 핀스트라이프
    g.fillStyle = YELLOW;
    g.fillRect(U(0.245), V(0.86), U(0.01), V(0.6) - V(0.86));
    // 엔진 커버 옆: 큰 빨간 스우시 + 노란 줄
    sym((X) => {
      g.fillStyle = RED;
      g.beginPath();
      g.moveTo(X(0.02), V(0.07)); g.lineTo(X(0.02), V(0.2));
      g.quadraticCurveTo(X(0.08), V(0.33), X(0.2), V(0.4));
      g.lineTo(X(0.21), V(0.34));
      g.quadraticCurveTo(X(0.12), V(0.25), X(0.1), V(0.07));
      g.fill();
      g.strokeStyle = YELLOW;
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(X(0.115), V(0.07));
      g.quadraticCurveTo(X(0.135), V(0.24), X(0.225), V(0.33));
      g.stroke();
    });
    // 조종석 옆 흰 숫자 대신 얇은 흰 줄
    sym((X) => {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(X(0.06), V(0.56), X(0.18) - X(0.06), 6);
    });
    // 미세한 결
    for (let i = 0; i < 40000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
  });
}

function sidepodLivery() {
  return canvasTex(1024, 1024, (g, W, H) => {
    const U = (u) => u * W, V = (v) => (1 - v) * H;
    g.fillStyle = NAVY;
    g.fillRect(0, 0, W, H);
    g.fillStyle = CARBON;
    g.fillRect(U(0.58), 0, U(0.34), H);
    // 앞쪽 흡입구는 검게
    g.fillStyle = '#050506';
    g.fillRect(0, 0, W, V(0.975));
    // 위쪽 빨간 띠 + 노란 줄
    g.fillStyle = RED;
    g.beginPath();
    g.moveTo(U(0.1), V(0.92)); g.lineTo(U(0.4), V(0.92)); g.lineTo(U(0.33), V(0.45)); g.lineTo(U(0.17), V(0.45));
    g.fill();
    g.fillStyle = YELLOW;
    g.beginPath();
    g.moveTo(U(0.1), V(0.94)); g.lineTo(U(0.4), V(0.94)); g.lineTo(U(0.4), V(0.925)); g.lineTo(U(0.1), V(0.925));
    g.fill();
  });
}

// 타이어 옆면 (컴파운드 색 띠 + 글씨) — RingGeometry의 평면 uv에 맞춰 동그랗게 그려요
function sidewallTexture(compound) {
  return canvasTex(512, 512, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.fillStyle = '#141416';
    g.beginPath(); g.arc(0, 0, 256, 0, Math.PI * 2); g.fill();
    g.strokeStyle = compound;
    g.lineWidth = 9;
    g.beginPath(); g.arc(0, 0, 214, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e8e8e8';
    g.font = 'bold 30px "Titillium Web", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const words = ['SOFT', '18', 'RACING', 'SOFT', '18', 'RACING'];
    words.forEach((word, i) => {
      g.save();
      g.rotate((i / words.length) * Math.PI * 2);
      g.translate(0, -186);
      g.fillText(word, 0, 0);
      g.restore();
    });
  });
}

// 휠 커버 (가운데 너트 + 바깥 테두리)
function wheelCoverTexture(accent) {
  return canvasTex(512, 512, (g, w, h) => {
    g.translate(w / 2, h / 2);
    const grad = g.createRadialGradient(0, 0, 10, 0, 0, 256);
    grad.addColorStop(0, '#2a2e3a');
    grad.addColorStop(1, '#0d0f14');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, 256, 0, Math.PI * 2); g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 10;
    g.beginPath(); g.arc(0, 0, 232, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      g.rotate(Math.PI / 5);
      g.beginPath(); g.moveTo(60, 0); g.lineTo(220, 0); g.stroke();
    }
    g.fillStyle = accent;
    g.beginPath(); g.arc(0, 0, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9dbe0';
    g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
  });
}

function toGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(geo.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uvs, 2));
  g.setIndex(geo.indices);
  g.computeVertexNormals();
  return g;
}

// 텍스처는 한 번만 만들어 여러 대가 같이 써요 (AI 차량용)
const TEX = {};
const once = (key, make) => TEX[key] || (TEX[key] = make());
export const isLiveryTex = (t) => !!t && (t === TEX.chassis || t === TEX.sidepod);

export function buildProceduralCar(envMap) {
  const carbonTex = once('carbon', carbonTexture);
  const paint = (opts) => new THREE.MeshPhysicalMaterial({
    metalness: 0.25, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, envMap, envMapIntensity: 1.1, ...opts,
  });
  const M = {
    livery: paint({ map: once('chassis', chassisLivery), roughness: 0.48 }),
    sidepod: paint({ map: once('sidepod', sidepodLivery), roughness: 0.48 }),
    navy: paint({ color: NAVY, roughness: 0.46 }),
    wingNavy: paint({ color: NAVY, roughness: 0.4, side: THREE.DoubleSide }),
    red: paint({ color: RED, roughness: 0.32, clearcoat: 0.7, side: THREE.DoubleSide }),
    yellow: paint({ color: YELLOW, roughness: 0.3, clearcoat: 0.7 }),
    carbon: new THREE.MeshPhysicalMaterial({
      map: carbonTex, color: 0x6a6c72, metalness: 0.2, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25, envMap, envMapIntensity: 0.5, side: THREE.DoubleSide,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.75 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.86, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b0d12, metalness: 1, roughness: 0.04, envMap, envMapIntensity: 1.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ccd4, metalness: 1, roughness: 0.18, envMap }),
    helmet: paint({ color: 0xf3f3f5, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    rain: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.01, 0.01) }),
  };
  carbonTex.repeat.set(8, 8);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (mesh, parent = body) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // ---------- 설계도의 큰 부품들 (차체, 사이드포드, 날개) ----------
  const aero = { rear: null, front: null, open: 0 };
  for (const part of designF1()) {
    const mesh = new THREE.Mesh(toGeometry(part.geo), M[part.mat]);
    if (part.name === 'rwFlap' || part.name === 'fwFlap2') {
      // 액티브 에어로: 날개 앞전을 축으로 회전하는 플랩
      const pivot = new THREE.Group();
      const axis = part.name === 'rwFlap' ? new THREE.Vector3(0, 0.94, -2.5) : new THREE.Vector3(0, 0.16, 2.42);
      pivot.position.copy(axis);
      mesh.position.copy(axis).negate();
      add(mesh, pivot);
      body.add(pivot);
      if (part.name === 'rwFlap') aero.rear = pivot; else aero.front = pivot;
    } else add(mesh);
  }

  // ---------- 조종석 ----------
  const opening = add(new THREE.Mesh(new THREE.CircleGeometry(1, 48), M.black));
  opening.rotation.x = -Math.PI / 2;
  opening.scale.set(0.235, 0.33, 1);
  opening.position.set(0, 0.618, 0.3);
  const rim = add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 48), M.black));
  rim.rotation.x = -Math.PI / 2;
  rim.scale.set(0.24, 0.335, 0.4);
  rim.position.set(0, 0.62, 0.3);
  // 헤드레스트 (머리 양옆 쿠션)
  for (const s of [1, -1]) {
    const pad = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 6, 12), M.navy));
    pad.rotation.x = Math.PI / 2;
    pad.position.set(0.17 * s, 0.66, 0.08);
  }

  // 드라이버 헬멧
  const driverParts = [];
  const helmet = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 24), M.helmet));
  helmet.position.set(0, 0.73, 0.16);
  helmet.scale.set(1, 1.02, 1.12);
  const visor = add(new THREE.Mesh(new THREE.SphereGeometry(0.132, 32, 12, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.36, Math.PI * 0.2), M.glass));
  visor.position.copy(helmet.position);
  visor.scale.copy(helmet.scale);
  const hStripe = add(new THREE.Mesh(new THREE.TorusGeometry(0.131, 0.014, 8, 40), M.red));
  hStripe.position.copy(helmet.position);
  hStripe.rotation.y = Math.PI / 2;
  hStripe.scale.set(1.12, 1.02, 1);
  driverParts.push(helmet, visor, hStripe);

  // ---------- 헤일로 (곡선 튜브) ----------
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.28, 0.6, -0.08), new THREE.Vector3(0.33, 0.79, 0.08), new THREE.Vector3(0.29, 0.84, 0.32),
    new THREE.Vector3(0.13, 0.85, 0.47), new THREE.Vector3(0, 0.85, 0.5), new THREE.Vector3(-0.13, 0.85, 0.47),
    new THREE.Vector3(-0.29, 0.84, 0.32), new THREE.Vector3(-0.33, 0.79, 0.08), new THREE.Vector3(-0.28, 0.6, -0.08),
  ]);
  add(new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 96, 0.03, 14), M.navy));
  const pillar = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.85, 0.5), new THREE.Vector3(0, 0.77, 0.66), new THREE.Vector3(0, 0.6, 0.8)]);
  add(new THREE.Mesh(new THREE.TubeGeometry(pillar, 24, 0.032, 12), M.navy));

  // ---------- 에어박스 흡입구 + 카메라 포드 ----------
  const intake = add(new THREE.Mesh(new THREE.CircleGeometry(1, 32), M.black));
  intake.scale.set(0.11, 0.08, 1);
  intake.position.set(0, 0.86, -0.255);
  intake.rotation.x = -0.5;
  const tcam = add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.035, 0.13), M.yellow));
  tcam.position.set(0, 0.965, -0.42);

  // ---------- 사이드미러 ----------
  for (const s of [1, -1]) {
    const pod = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.09, 6, 12), M.navy));
    pod.rotation.z = Math.PI / 2;
    pod.scale.set(1, 1, 0.75);
    pod.position.set(0.43 * s, 0.68, 0.64);
    const glass = add(new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.05), M.chrome));
    glass.position.set(0.43 * s, 0.68, 0.612);
    glass.rotation.y = Math.PI;
    rodBetween(add, [0.43 * s * 0.7, 0.66, 0.66], [0.27 * s, 0.58, 0.7], 0.012, M.carbon);
  }

  // ---------- 서스펜션 (날개 단면 모양의 팔) ----------
  for (const s of [1, -1]) {
    const F = WHEELS.front.z, Rz = WHEELS.rear.z;
    const arms = [
      [[0.2, 0.46, F + 0.24], [0.66, 0.52, F]], [[0.24, 0.48, F - 0.26], [0.66, 0.52, F]],
      [[0.18, 0.18, F + 0.3], [0.68, 0.2, F]], [[0.22, 0.17, F - 0.28], [0.68, 0.2, F]],
      [[0.66, 0.22, F + 0.02], [0.2, 0.47, F - 0.08]], [[0.2, 0.34, F + 0.18], [0.66, 0.36, F + 0.16]],
      [[0.14, 0.47, Rz + 0.25], [0.62, 0.52, Rz]], [[0.12, 0.46, Rz - 0.25], [0.62, 0.52, Rz]],
      [[0.14, 0.18, Rz + 0.3], [0.64, 0.2, Rz]], [[0.12, 0.18, Rz - 0.3], [0.64, 0.2, Rz]],
      [[0.62, 0.5, Rz + 0.02], [0.15, 0.22, Rz + 0.15]], [[0.12, 0.33, Rz - 0.25], [0.62, 0.35, Rz - 0.2]],
    ];
    for (const [a, b] of arms) rodBetween(add, [a[0] * s, a[1], a[2]], [b[0] * s, b[1], b[2]], 0.017, M.carbon, true);
  }

  // ---------- 레인라이트 (뒤쪽 가운데 + 뒷날개 끝판) ----------
  const rainCenter = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.03), M.rain));
  rainCenter.position.set(0, 0.3, -2.34);
  for (const s of [1, -1]) {
    const strip = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), M.rain));
    strip.position.set(0.525 * s, 0.86, -2.69);
  }

  // ---------- 바퀴 ----------
  const R = WHEELS.radius;
  const tyreGeo = (width) => {
    const hw = width / 2, prof = [];
    const rr = 0.235, sh = 0.06; // 휠 반지름, 타이어 어깨 둥글기
    prof.push(new THREE.Vector2(rr, -hw * 0.9));
    prof.push(new THREE.Vector2(R - sh * 1.4, -hw));
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); prof.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh)); }
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh)); }
    prof.push(new THREE.Vector2(R - sh * 1.4, hw));
    prof.push(new THREE.Vector2(rr, hw * 0.9));
    return new THREE.LatheGeometry(prof, 48).rotateZ(Math.PI / 2);
  };
  const sidewall = new THREE.MeshStandardMaterial({ map: sidewallTexture(RED), roughness: 0.8, side: THREE.DoubleSide });
  const covers = [wheelCoverTexture(RED), wheelCoverTexture(YELLOW)].map((map) => new THREE.MeshPhysicalMaterial({
    map, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMap,
  }));
  const wheelDefs = [
    [WHEELS.front.x, WHEELS.front.z, WHEELS.front.width, 0], [-WHEELS.front.x, WHEELS.front.z, WHEELS.front.width, 0],
    [WHEELS.rear.x, WHEELS.rear.z, WHEELS.rear.width, 1], [-WHEELS.rear.x, WHEELS.rear.z, WHEELS.rear.width, 1],
  ];
  const wheels = wheelDefs.map(([x, z, width, rear]) => {
    const side = Math.sign(x);
    const rig = makeWheelRig(body, new THREE.Vector3(x, R, z));
    add(new THREE.Mesh(tyreGeo(width), M.tyre), rig.spin);
    for (const s of [1, -1]) {
      const wall = add(new THREE.Mesh(new THREE.RingGeometry(0.236, R - 0.012, 64, 1), sidewall), rig.spin);
      wall.rotation.y = s * Math.PI / 2;
      wall.position.x = (s * width) / 2 + s * 0.001;
    }
    // 바깥쪽 휠 커버 + 안쪽 림
    const cover = add(new THREE.Mesh(new THREE.CircleGeometry(0.236, 48), covers[rear]), rig.spin);
    cover.rotation.y = side * Math.PI / 2;
    cover.position.x = side * (width / 2 - 0.02);
    const inner = add(new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, width * 0.8, 40, 1, true).rotateZ(Math.PI / 2), M.chrome), rig.spin);
    void inner;
    // 브레이크 덕트 드럼 (회전하지 않고 조향만 따라가요)
    const drum = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 32).rotateZ(Math.PI / 2), M.carbon), rig.pivot);
    drum.position.x = -side * (width / 2 + 0.05);
    return rig;
  });

  const steering = makeSteeringWheel();
  steering.group.position.set(0, 0.655, 0.56);
  steering.group.rotation.x = -0.32;
  body.add(steering.group);

  return {
    root, body, wheels, steering, rainLight: M.rain,
    eye: new THREE.Vector3(0, 0.9, 0.15), // 운전석 눈 높이 (조금 높게 → 앞과 바닥이 더 잘 보여요)
    driverParts,
    isModel: false,
    credit: '',
    /** 액티브 에어로: 0 = 코너 모드(날개 세움), 1 = 직선 모드(날개 눕힘) */
    setAero(open) {
      aero.open = open;
      if (aero.rear) aero.rear.rotation.x = -open * 0.42;
      if (aero.front) aero.front.rotation.x = -open * 0.22;
    },
  };
}

/** 두 점을 잇는 막대. aero=true면 납작한 날개 단면 모양 */
function rodBetween(add, a, b, r, mat, aeroShape = false) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  dir.normalize();
  const geo = new THREE.CylinderGeometry(r, r, len, 12);
  if (aeroShape) geo.scale(2.2, 1, 0.6);
  const m = add(new THREE.Mesh(geo, mat));
  m.position.copy(A).add(B).multiplyScalar(0.5);
  // 막대의 넓은 면이 수평이 되도록 좌표축 직접 만들기
  const up = new THREE.Vector3(0, 1, 0);
  let xAxis = new THREE.Vector3().crossVectors(up, dir);
  if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, dir).normalize();
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, dir, zAxis));
  return m;
}

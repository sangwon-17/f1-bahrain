import * as THREE from 'three';

// 1970년식 머슬카 (차저 스타일) — 긴 보닛, 블로워, 꽉 찬 검은 그릴, 크롬 범퍼
// 로고·상표는 넣지 않아요. 좌표: x = 왼쪽, y = 위, z = 앞, 원점 = 앞뒤 바퀴 사이 바닥

export const MUSCLE = {
  wheelbase: 2.97,
  front: { x: 0.8, z: 1.48, r: 0.345, width: 0.25 },
  rear: { x: 0.79, z: -1.49, r: 0.36, width: 0.33 },
};

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function grilleTexture() {
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#050505';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1c1e';
    for (let y = 6; y < h; y += 12) g.fillRect(0, y, w, 4);
    g.fillStyle = '#262628';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 3, h);
  });
}

function tailTexture() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#5a0408';
    g.fillRect(0, 0, w, h);
    for (let x = 8; x < w; x += 24) {
      const grad = g.createLinearGradient(x, 0, x + 18, 0);
      grad.addColorStop(0, '#ff3b30');
      grad.addColorStop(1, '#a3070e');
      g.fillStyle = grad;
      g.fillRect(x, 8, 18, h - 16);
    }
  });
}

function sidewallTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.fillStyle = '#121214';
    g.beginPath(); g.arc(0, 0, 256, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d8d8d8';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['STREET', 'RACER', '275/60R15', 'STREET', 'RACER', '275/60R15'].forEach((word, i) => {
      g.save();
      g.rotate((i / 6) * Math.PI * 2);
      g.translate(0, -205);
      g.fillText(word, 0, 0);
      g.restore();
    });
  });
}

function rimTexture() {
  // 광택 크롬 5스포크 (스포크 사이는 깊게 어둡게)
  return canvasTex(512, 512, (g) => {
    g.translate(256, 256);
    g.fillStyle = '#0c0c0e';
    g.beginPath(); g.arc(0, 0, 256, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 5; i++) {
      g.save();
      g.rotate((i / 5) * Math.PI * 2);
      const grad = g.createLinearGradient(-40, 0, 40, 0);
      grad.addColorStop(0, '#9a9ea6');
      grad.addColorStop(0.5, '#f4f6fa');
      grad.addColorStop(1, '#8c9098');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(-30, 50); g.lineTo(-46, 214); g.lineTo(46, 214); g.lineTo(30, 50);
      g.fill();
      g.restore();
    }
    // 깊은 림 (바깥 테두리)
    const lip = g.createRadialGradient(0, 0, 200, 0, 0, 256);
    lip.addColorStop(0, '#6e727a');
    lip.addColorStop(0.4, '#f7f8fb');
    lip.addColorStop(1, '#8a8e96');
    g.fillStyle = lip;
    g.beginPath(); g.arc(0, 0, 256, 0, Math.PI * 2); g.arc(0, 0, 214, 0, Math.PI * 2, true); g.fill();
    const hub = g.createRadialGradient(-10, -10, 4, 0, 0, 62);
    hub.addColorStop(0, '#ffffff');
    hub.addColorStop(1, '#9ea2aa');
    g.fillStyle = hub;
    g.beginPath(); g.arc(0, 0, 62, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2b2e';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
      g.beginPath(); g.arc(Math.cos(a) * 40, Math.sin(a) * 40, 7, 0, Math.PI * 2); g.fill();
    }
  });
}

/** 선분을 일정 간격으로 잘게 나눠요 */
function densify(points, step) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const [az, ay] = points[i], [bz, by] = points[(i + 1) % points.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bz - az, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([az + ((bz - az) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** 옆모습(z, y)을 폭만큼 두껍게 */
function sideExtrude(points, width, mat, bevel) {
  const shape = new THREE.Shape(densify(points, 0.12).map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 16,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

function arch(points, cz, cy, r, steps = 14) {
  // 뒤쪽(-z)에서 위로 돌아 앞쪽(+z)으로 (바닥선을 따라 앞으로 가는 방향)
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (i / steps) * Math.PI;
    points.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

export function buildMuscleCar(envMap, { paint = 0x0b0b0d } = {}) {
  const M = {
    paint: new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.05, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMap, envMapIntensity: 0.55 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 1, roughness: 0.08, envMap, envMapIntensity: 1.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0.1, roughness: 0.03, envMap, envMapIntensity: 1.4, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.75 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.5, metalness: 0.3 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, side: THREE.DoubleSide }),
    grille: new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.6, metalness: 0.4 }),
    tail: new THREE.MeshStandardMaterial({ map: tailTexture(), emissive: 0xff1a10, emissiveIntensity: 0.15, roughness: 0.3 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.88, side: THREE.DoubleSide }),
    sidewall: new THREE.MeshStandardMaterial({ map: sidewallTexture(), roughness: 0.8, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ map: rimTexture(), metalness: 1, roughness: 0.14, envMap, envMapIntensity: 1.5 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 }),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (mesh, parent = body) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const box = (w, h, d, mat, x, y, z, parent) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), parent); m.position.set(x, y, z); return m; };

  const F = MUSCLE.front, R = MUSCLE.rear;

  // ---------- 차체 (옆모습 + 바퀴 아치) ----------
  const BV = 0.08; // 모서리 둥글기
  const prof = [[2.6 - BV, 0.36 + BV], [2.66 - BV, 0.6], [2.6 - BV, 0.9 - BV], [2.45 - BV, 0.96 - BV], [0.7, 1.0 - BV], [-1.6, 1.0 - BV], [-2.5 + BV, 0.98 - BV], [-2.66 + BV, 0.9 - BV], [-2.68 + BV, 0.36 + BV], [-2.45 + BV, 0.27 + BV]];
  prof.push([R.z - 0.47 - BV, 0.27 + BV]);
  arch(prof, R.z, 0.36, 0.47 + BV);
  prof.push([R.z + 0.47 + BV, 0.27 + BV], [F.z - 0.45 - BV, 0.27 + BV]);
  arch(prof, F.z, 0.35, 0.45 + BV);
  prof.push([F.z + 0.45 + BV, 0.27 + BV], [2.4 - BV, 0.28 + BV]);
  const bodyGeo = sideExtrude(prof, 1.86 - 2 * BV, M.paint, BV);
  // 머슬카 특유의 몸매: 뒷바퀴 쪽 허리가 불룩(콜라병), 보닛과 트렁크 가운데가 살짝 볼록
  {
    const p = bodyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      if (y > 0.9) p.setY(i, y + 0.035 * Math.max(0, 1 - (x / 0.98) ** 2));
    }
    bodyGeo.computeVertexNormals();
  }
  add(new THREE.Mesh(bodyGeo, M.paint));
  // 바퀴 아치 안쪽 (검은 펜더 라이너 — 차 반대편이 비쳐 보이지 않게)
  const liner = (cz, cy, r, x0, x1) => {
    const pos = [], idx = [];
    const N = 20;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI;
      for (const x of [x0, x1]) pos.push(x, cy + Math.sin(a) * r, cz + Math.cos(a) * r);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.DoubleSide });
  for (const [z, cy, r] of [[F.z, 0.35, 0.45], [R.z, 0.36, 0.47]]) {
    for (const s of [1, -1]) add(new THREE.Mesh(liner(z, cy, r, s * 0.45, s * 0.97), linerMat));
    // 아치 안쪽 벽
    const wall = add(new THREE.Mesh(new THREE.CircleGeometry(r, 24, 0, Math.PI), linerMat));
    wall.rotation.y = Math.PI / 2;
    wall.position.set(0.45, cy, z);
    const wall2 = wall.clone();
    wall2.position.x = -0.45;
    body.add(wall2);
  }

  // ---------- 캐빈 (지붕 + 창문) ----------
  const cabProf = [[0.72, 1.0], [0.05, 1.37], [-0.8, 1.38], [-1.55, 1.02], [-1.55, 0.99], [0.72, 0.99]];
  const cabGeo = sideExtrude(cabProf, 1.46, M.paint, 0.04);
  // 위로 갈수록 안쪽으로 좁아지게 (텀블홈)
  const cp = cabGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i);
    cp.setX(i, cp.getX(i) * (1 - 0.14 * Math.min(1, Math.max(0, (y - 1.0) / 0.38))));
  }
  cabGeo.computeVertexNormals();
  add(new THREE.Mesh(cabGeo, M.paint));
  // 창문: 캐빈 겉면에 살짝 띄운 어두운 유리
  const winShape = (pts) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))));
  for (const s of [1, -1]) {
    // 옆 창문: 캐빈 옆면 기울기를 따라 붙여요
    const g = winShape([[0.6, 1.07], [0.04, 1.33], [-0.72, 1.33], [-1.02, 1.07]]);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getX(i), y = p.getY(i);
      p.setXYZ(i, s * (0.768 - (y - 1.06) * 0.3), y, z);
    }
    g.computeVertexNormals();
    add(new THREE.Mesh(g, M.glass));
    // 창문 둘레 크롬 몰딩
    const outline = [[0.62, 1.05], [0.04, 1.345], [-0.74, 1.345], [-1.05, 1.05]].map(([z, y]) => new THREE.Vector3(s * (0.772 - (y - 1.06) * 0.3), y, z));
    const trimCurve = new THREE.CatmullRomCurve3(outline, true, 'catmullrom', 0.1);
    add(new THREE.Mesh(new THREE.TubeGeometry(trimCurve, 80, 0.011, 8, true), M.chrome));
  }
  // 앞유리, 뒷유리 (경사면, 차체에서 살짝 띄워요)
  const wsA = -(Math.PI / 2 - Math.atan2(0.37, 0.67));
  const ws = add(new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.74), M.glass));
  ws.rotation.x = wsA;
  ws.position.set(0, 1.185 + 0.876 * 0.014, 0.385 + 0.484 * 0.014);
  const rwA = Math.atan2(0.75, 0.36);
  const rw = add(new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), M.glass));
  rw.rotation.x = rwA;
  rw.position.set(0, 1.2 + 0.9 * 0.014, -1.175 - 0.433 * 0.014);

  // ---------- 보닛 위 크롬 블로워 (슈퍼차저) ----------
  const blower = new THREE.Group();
  box(0.66, 0.07, 0.86, M.chrome, 0, 1.04, 0, blower);              // 흡기 매니폴드
  box(0.48, 0.26, 0.74, M.chrome, 0, 1.2, 0, blower);               // 블로워 케이스
  for (let i = -4; i <= 4; i++) box(0.5, 0.22, 0.014, M.trim, 0, 1.2, i * 0.08, blower); // 케이스 홈
  const pulley = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24).rotateX(Math.PI / 2), M.chrome), blower);
  pulley.position.set(0, 1.18, 0.41);
  box(0.06, 0.3, 0.02, M.black, 0, 1.08, 0.43, blower);             // 벨트
  box(0.54, 0.05, 0.56, M.chrome, 0, 1.355, 0.02, blower);          // 모자 받침
  box(0.5, 0.16, 0.5, M.chrome, 0, 1.46, 0.02, blower);             // 흡입구 모자
  for (const x of [-0.12, 0.12]) {
    box(0.18, 0.1, 0.02, M.black, x, 1.46, 0.275, blower);          // 앞쪽 흡입 구멍
    const flap = box(0.17, 0.008, 0.09, M.chrome, x, 1.5, 0.3, blower);
    flap.rotation.x = -0.6;
  }
  // 위로 솟은 흡기 나팔 8개
  for (let i = 0; i < 8; i++) {
    const stack = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 16, 1, true), M.chrome), blower);
    stack.position.set((i % 2 ? 0.1 : -0.1), 1.58, -0.17 + Math.floor(i / 2) * 0.12);
  }
  blower.position.set(0, 0, 1.15);
  body.add(blower);
  // 보닛 가운데 불룩한 부분
  box(0.7, 0.04, 1.7, M.paint, 0, 1.0, 1.55);

  // ---------- 앞모습: 그릴을 감싸는 크롬 루프 범퍼 ----------
  const grille = add(new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.36), M.grille));
  grille.position.set(0, 0.68, 2.675);
  box(0.03, 0.36, 0.03, M.chrome, 0, 0.68, 2.69);                    // 가운데 칸막이
  const bar = (len, x, y, z, vertical) => {
    const m = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.03, len, 6, 14), M.chrome));
    if (!vertical) m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    m.scale.set(1, 1, 0.75);
    return m;
  };
  bar(1.76, 0, 0.88, 2.69, false);    // 위
  bar(1.84, 0, 0.46, 2.7, false);     // 아래 (조금 더 넓게)
  bar(0.4, 0.9, 0.67, 2.69, true);    // 양옆
  bar(0.4, -0.9, 0.67, 2.69, true);
  box(1.7, 0.12, 0.06, M.black, 0, 0.33, 2.62);                      // 아래 검은 립

  // ---------- 뒷모습: 테일램프 + 범퍼 ----------
  box(1.78, 0.2, 0.02, M.black, 0, 0.74, -2.705);
  const tails = [];
  for (const x of [0.46, -0.46]) {
    const t = box(0.78, 0.13, 0.02, M.tail, x, 0.74, -2.716);
    tails.push(t);
  }
  for (const y of [0.85, 0.63]) box(1.82, 0.02, 0.03, M.chrome, 0, y, -2.71);
  for (const x of [0.9, -0.9, 0]) box(0.02, 0.24, 0.03, M.chrome, x, 0.74, -2.71);
  const bumperR = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.72, 6, 16).rotateZ(Math.PI / 2), M.chrome));
  bumperR.position.set(0, 0.45, -2.72);
  bumperR.scale.set(1, 1, 0.8);
  // 머플러 두 개
  for (const x of [0.5, -0.5]) {
    const pipe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 16).rotateX(Math.PI / 2), M.chrome));
    pipe.position.set(x, 0.26, -2.7);
  }

  // ---------- 사이드미러 ----------
  for (const s of [1, -1]) {
    const m = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), M.chrome));
    m.scale.set(1, 0.8, 1.5);
    m.position.set(s * 1.0, 1.06, 0.5);
  }

  // ---------- 실내 (1인칭에서 보여요): 대시보드, 기둥, 천장, 운전대 ----------
  box(1.5, 0.14, 0.32, M.interior, 0, 0.98, 0.5);
  for (const s of [1, -1]) {
    const pillar = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.78, 0.035), M.interior));
    pillar.position.set(s * 0.7, 1.185, 0.38);
    pillar.rotation.x = -(Math.PI / 2 - Math.atan2(0.37, 0.67));
    pillar.rotation.z = s * 0.1;
    const door = add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.42), M.interior));
    door.rotation.y = s * Math.PI / 2;
    door.position.set(s * 0.86, 0.8, -0.2);
  }
  // 실내 바닥/좌석 (차체 윗면이 안에서 보이지 않게)
  const tub = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.0), M.interior));
  tub.rotation.x = -Math.PI / 2;
  tub.position.set(0, 1.05, -0.42);
  for (const x of [0.38, -0.38]) box(0.5, 0.5, 0.12, M.interior, x, 1.15, -0.55);
  const roofIn = add(new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.95), M.interior));
  roofIn.rotation.x = Math.PI / 2;
  roofIn.position.set(0, 1.33, -0.38);
  const mirror = box(0.22, 0.06, 0.02, M.trim, 0, 1.28, 0.2);
  void mirror;

  // 운전석은 왼쪽 (x +0.38)
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const cluster = add(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
  cluster.position.set(0.38, 1.0, 0.42);
  cluster.rotation.set(-0.35, Math.PI, 0);
  const steering = { group: new THREE.Group(), canvas, tex, leds: [] };
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.016, 10, 40), M.trim);
  steering.group.add(wheel);
  for (const a of [Math.PI / 2, Math.PI * 7 / 6, -Math.PI / 6]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.012), M.chrome);
    spoke.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0);
    spoke.rotation.z = a;
    steering.group.add(spoke);
  }
  steering.group.position.set(0.38, 0.9, 0.3);
  steering.group.rotation.x = -0.6;
  body.add(steering.group);

  // 운전자 머리 (밖에서 볼 때)
  const driverParts = [];
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), M.skin));
  head.position.set(0.38, 1.16, -0.18);
  driverParts.push(head);

  // ---------- 바퀴 ----------
  const tyreGeo = (r, width) => {
    const hw = width / 2, rr = r * 0.74, sh = 0.04, prof = [];
    prof.push(new THREE.Vector2(rr, -hw * 0.9));
    prof.push(new THREE.Vector2(r - sh * 1.5, -hw));
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh)); }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh)); }
    prof.push(new THREE.Vector2(r - sh * 1.5, hw));
    prof.push(new THREE.Vector2(rr, hw * 0.9));
    return new THREE.LatheGeometry(prof, 40).rotateZ(Math.PI / 2);
  };
  const wheels = [[F.x, F.z, F.r, F.width], [-F.x, F.z, F.r, F.width], [R.x, R.z, R.r, R.width], [-R.x, R.z, R.r, R.width]].map(([x, z, r, width]) => {
    const side = Math.sign(x);
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const mount = new THREE.Group();
    const spin = new THREE.Group();
    pivot.add(mount);
    mount.add(spin);
    body.add(pivot);
    add(new THREE.Mesh(tyreGeo(r, width), M.tyre), spin);
    const wall = add(new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r - 0.01, 48), M.sidewall), spin);
    wall.rotation.y = side * Math.PI / 2;
    wall.position.x = side * (width / 2 + 0.001);
    const rim = add(new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, 40), M.rim), spin);
    rim.rotation.y = side * Math.PI / 2;
    rim.position.x = side * (width / 2 - 0.05);
    // 깊은 크롬 림 테두리
    const lip = add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.745, 0.016, 8, 40).rotateY(Math.PI / 2), M.chrome), spin);
    lip.position.x = side * (width / 2 - 0.01);
    const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.74, r * 0.74, 0.05, 40, 1, true).rotateZ(Math.PI / 2), M.chrome), spin);
    barrel.position.x = side * (width / 2 - 0.035);
    return { pivot, mount, spin, home: pivot.position.clone() };
  });

  return {
    root, body, wheels, steering, driverParts,
    eye: new THREE.Vector3(0.38, 1.15, -0.1),
    chase: { dist: 7.4, height: 2.35, look: 1.0 },
    isModel: false,
    credit: '',
    setAero() {},
    /** 브레이크 등 */
    setBrake(b) { M.tail.emissiveIntensity = 0.15 + b * 2.2; },
  };
}

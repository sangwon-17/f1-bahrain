import * as THREE from 'three';
import { TRACK, PIT } from './config.js';
import * as TX from './textures.js';

// 야간 경기장: 하늘, 조명, 사막, 조명탑, 관중석, 피트 건물, 출발 신호등

const HDR = (r, g, b) => new THREE.Color(r, g, b); // 1보다 큰 값 = 블룸으로 빛나요

/** 차체에 비칠 반사 환경 (낮: 파란 하늘 + 해 + 모래 바닥) */
export function makeReflectionEnv(renderer, skyTex) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: HDR(30, 27, 22) }));
  sun.position.copy(SUN_DIR).multiplyScalar(90);
  env.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x3a342e }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  env.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.43).normalize();

export function buildEnvironment(scene, track) {
  scene.background = TX.makeDaySky();
  // 사막 아지랑이: 멀리 있는 건 흐려져서 끝없는 허허벌판이 안 보여요
  scene.fog = new THREE.Fog(0xdcd3c2, 280, 1500);

  // ---------- 조명 (오후의 햇빛) ----------
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0xa88d6a, 1.15));
  const flood = new THREE.DirectionalLight(0xfff0d8, 3.1);
  flood.castShadow = true;
  flood.shadow.mapSize.set(4096, 4096);
  Object.assign(flood.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 300 });
  flood.shadow.bias = -0.0002;
  flood.shadow.normalBias = 0.02;
  scene.add(flood, flood.target);
  const FLOOD_OFFSET = SUN_DIR.clone().multiplyScalar(140);

  buildLightPoles(scene, track);
  buildGrandstands(scene, track);
  buildPitBuilding(scene, track);
  buildScenery(scene, track);
  const startLights = buildGantry(scene, track);

  return {
    flood,
    startLights,
    update(carX, carZ) {
      flood.position.set(carX + FLOOD_OFFSET.x, FLOOD_OFFSET.y, carZ + FLOOD_OFFSET.z);
      flood.target.position.set(carX, 0, carZ);
    },
  };
}

/** 주변을 채우는 풍경: 야자수, 모래 언덕, 멀리 도시, 건물들 */
function buildScenery(scene, track) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const awayFromTrack = (x, z, min) => Math.abs(track.locate(x, z).lat) > min;

  // 야자수 (줄기 + 잎 9장)
  const leafTex = TX.makePalmLeaf();
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6e4f, roughness: 0.95 });
  const trunkGeo = new THREE.CylinderGeometry(0.26, 0.42, 9, 10).translate(0, 4.5, 0);
  const leaves = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.PlaneGeometry(1.8, 6.2, 1, 6).translate(0, 3.1, 0);
    // 잎이 아래로 휘어지게
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      pos.setZ(k, -(y * y) * 0.07);
    }
    g.rotateX(-Math.PI / 2 + (i % 2 ? 0.75 : 0.35));
    g.rotateY((i / 14) * Math.PI * 2 + rnd(-0.1, 0.1));
    g.translate(0, 9, 0);
    leaves.push(g);
  }
  const crownGeo = mergeAll(leaves);
  const spots = [];
  for (let d = 0; d < track.L; d += 14) {
    for (const side of [1, -1]) {
      if (Math.random() < 0.35) continue;
      if (side < 0 && track.inPitZone(d)) continue;
      const i = Math.floor(d / track.step) % track.N;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const p = track.poseAt(d + rnd(-8, 8), side * (wall + rnd(9, 40)));
      if (awayFromTrack(p.x, p.z, 26)) spots.push([p.x, p.z, rnd(0.8, 1.25), rnd(0, Math.PI * 2)]);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, leafMat, spots.length);
  spots.forEach(([x, z, s, r], i) => {
    m4.compose(v.set(x, 0, z), q.setFromEuler(e.set(rnd(-0.06, 0.06), r, rnd(-0.06, 0.06))), sc.set(s, s, s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // 모래 위 작은 덤불
  const bushes = [];
  for (let d = 0; d < track.L; d += 4) {
    for (const side of [1, -1]) {
      if (Math.random() < 0.5) continue;
      const i = Math.floor(d / track.step) % track.N;
      const wall = side > 0 ? track.wallL[i] : track.wallR[i];
      const p = track.poseAt(d, side * (wall + rnd(3, 70)));
      if (awayFromTrack(p.x, p.z, 25)) bushes.push([p.x, p.z, rnd(0.4, 1.3)]);
    }
  }
  const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).scale(1, 0.55, 1), new THREE.MeshStandardMaterial({ color: 0x6f7a3c, roughness: 1, flatShading: true }), bushes.length);
  const bushCol = new THREE.Color();
  bushes.forEach(([x, z, s], i) => {
    bushMesh.setMatrixAt(i, m4.compose(v.set(x, 0.1, z), q.setFromEuler(e.set(0, rnd(0, 3), 0)), sc.set(s, s, s)));
    bushMesh.setColorAt(i, bushCol.setHSL(rnd(0.12, 0.2), rnd(0.25, 0.45), rnd(0.22, 0.34)));
  });
  bushMesh.castShadow = true;
  scene.add(bushMesh);

  // 서킷을 둘러싼 낮은 모래 언덕 (지평선을 가려줘요)
  const duneMat = new THREE.MeshStandardMaterial({ color: 0xc2a77f, roughness: 1 });
  const duneGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const center = new THREE.Vector3(380, 0, 0);
  const dunes = new THREE.InstancedMesh(duneGeo, duneMat, 70);
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rnd(-0.05, 0.05);
    const r = rnd(900, 1250);
    m4.compose(v.set(center.x + Math.cos(a) * r, -2, center.z + Math.sin(a) * r), q.identity(), sc.set(rnd(90, 200), rnd(14, 38), rnd(90, 200)));
    dunes.setMatrixAt(i, m4);
  }
  scene.add(dunes);

  // 멀리 보이는 도시 건물들 (아지랑이 속 실루엣)
  const cityMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c2, roughness: 0.9 });
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), cityMat, 90);
  for (let i = 0; i < 90; i++) {
    const a = rnd(-0.9, 1.4);
    const r = rnd(1350, 1500);
    m4.compose(v.set(center.x + Math.cos(a) * r, 0, center.z - Math.sin(a) * r), q.setFromEuler(e.set(0, rnd(0, 3), 0)), sc.set(rnd(25, 60), rnd(25, 110), rnd(25, 60)));
    city.setMatrixAt(i, m4);
  }
  scene.add(city);

  // 트랙 안쪽 건물들 (호스피탈리티, 미디어 센터 느낌)
  const white = new THREE.MeshStandardMaterial({ color: 0xf0eee8, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a5878, metalness: 0.8, roughness: 0.15 });
  for (const [d, side, w, h, dep] of [[180, -1, 60, 14, 22], [700, 1, 50, 10, 30], [1500, -1, 70, 12, 25], [2700, 1, 45, 16, 20], [3600, -1, 60, 10, 28], [4300, 1, 55, 12, 24]]) {
    const i = Math.floor(track.wrap(d) / track.step) % track.N;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const p = track.poseAt(d, side * (wall + 22 + dep / 2));
    if (!awayFromTrack(p.x, p.z, 30)) continue;
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(dep, h, w), white);
    body.position.y = h / 2;
    const band = new THREE.Mesh(new THREE.BoxGeometry(dep + 0.2, h * 0.3, w + 0.2), glass);
    band.position.y = h * 0.62;
    b.add(body, band);
    b.position.set(p.x, 0, p.z);
    b.rotation.y = p.h;
    b.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(b);
  }
}

function mergeAll(geos) {
  // 간단한 병합 (위치/노멀/uv/인덱스)
  let vCount = 0;
  const pos = [], nor = [], uv = [], idx = [];
  for (const g of geos) {
    g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(i + vCount);
    vCount += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** 트랙을 따라 늘어선 조명탑 */
function buildLightPoles(scene, track) {
  const { N, step } = track;
  const spots = [];
  let side = 1;
  for (let d = 0; d < track.L; d += 55) {
    side = -side;
    const i = Math.floor(d / step) % N;
    if (side < 0 && track.inPitZone(d)) continue;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    spots.push({ ...track.poseAt(d, side * (wall + 3)), side });
  }
  const poleGeo = new THREE.CylinderGeometry(0.22, 0.35, 24, 10).translate(0, 12, 0);
  const headGeo = new THREE.BoxGeometry(4.2, 1.3, 0.35);
  const backGeo = new THREE.BoxGeometry(4.4, 1.5, 0.5);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x5a5e66, metalness: 0.7, roughness: 0.45 }), spots.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.3, roughness: 0.3 }), spots.length);
  const backs = new THREE.InstancedMesh(backGeo, new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.5, roughness: 0.6 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  spots.forEach((sp, i) => {
    poles.setMatrixAt(i, m.compose(p.set(sp.x, 0, sp.z), q.identity(), s));
    // 조명은 트랙 쪽을 아래로 비스듬히 바라봐요
    const yaw = sp.h + (sp.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    q.setFromEuler(e.set(0.45, yaw, 0, 'YXZ'));
    const fx = Math.sin(yaw) * 0.3, fz = Math.cos(yaw) * 0.3;
    heads.setMatrixAt(i, m.compose(p.set(sp.x + fx, 24.2, sp.z + fz), q, s));
    backs.setMatrixAt(i, m.compose(p.set(sp.x, 24.2, sp.z), q, s));
  });
  poles.castShadow = true;
  scene.add(poles, heads, backs);
}

/** 계단식 관중석 하나 (local +x 쪽으로 올라가요) */
function makeGrandstand(length, rows, crowdTex) {
  const g = new THREE.Group();
  const stepD = 0.9, stepH = 0.42, base = 2.2;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6d6f76, roughness: 0.9 });
  const depth = rows * stepD;
  const height = base + rows * stepH;
  // 아래 구조물
  const body = new THREE.Mesh(new THREE.BoxGeometry(depth, height, length), concrete);
  body.position.set(depth / 2 + 0.6, height / 2 - 0.4, 0);
  // 관중 (기울어진 면)
  const tex = crowdTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(length / 9, rows / 10);
  const slope = Math.hypot(depth, rows * stepH);
  const crowd = new THREE.Mesh(new THREE.PlaneGeometry(slope, length), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  crowd.rotation.set(-Math.PI / 2, 0, 0);
  crowd.rotateOnAxis(new THREE.Vector3(0, 1, 0), -Math.atan2(rows * stepH, depth));
  crowd.position.set(depth / 2 + 0.3, base + (rows * stepH) / 2 + 0.05, 0);
  // 앞 난간
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, length), new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.4, roughness: 0.4 }));
  rail.position.set(0.3, base + 0.55, 0);
  // 지붕 + 기둥 + 지붕 아래 조명
  const roof = new THREE.Mesh(new THREE.BoxGeometry(depth + 3, 0.4, length + 2), new THREE.MeshStandardMaterial({ color: 0xe6e6ea, metalness: 0.3, roughness: 0.5 }));
  roof.position.set(depth / 2 - 0.5, height + 5.5, 0);
  roof.rotation.z = -0.08;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, length), new THREE.MeshBasicMaterial({ color: HDR(4, 4, 4.4) }));
  strip.position.set(-0.6, height + 5.1, 0);
  g.add(body, crowd, rail, roof, strip);
  for (let z = -length / 2; z <= length / 2; z += 18) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8), concrete);
    col.position.set(depth + 0.3, height + 2.6, z);
    g.add(col);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function buildGrandstands(scene, track) {
  const crowdTex = TX.makeCrowd();
  // [진행거리 d, 쪽(+1 왼쪽), 길이, 줄 수]
  const list = [
    [-60, 1, 300, 16],   // 메인 그랜드스탠드
    [520, 1, 120, 12],   // T1 바깥
    [1290, 1, 110, 10],  // T4 바깥
    [2490, -1, 90, 10],  // T10 바깥
    [3880, 1, 100, 10],  // T13 바깥
    [4660, 1, 110, 12],  // T14 바깥
  ];
  for (const [d, side, len, rows] of list) {
    const i = Math.floor(track.wrap(d) / track.step) % track.N;
    const wall = side > 0 ? track.wallL[i] : track.wallR[i];
    const p = track.poseAt(d, side * (wall + 6));
    const gs = makeGrandstand(len, rows, crowdTex);
    gs.position.set(p.x, 0, p.z);
    gs.rotation.y = side > 0 ? p.h : p.h + Math.PI;
    scene.add(gs);
  }
}

/** 피트레인 옆 차고 건물 + 사키르 타워 */
function buildPitBuilding(scene, track) {
  const front = PIT.laneOffset + PIT.laneWidth / 2 + 1.5;
  const modW = 12, depth = 18, height = 9;
  const shell = new THREE.MeshStandardMaterial({ color: 0xd9dbe0, metalness: 0.2, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1220, metalness: 0.9, roughness: 0.08, emissive: 0x1a2a50, emissiveIntensity: 0.6 });
  const garageTex = TX.makeGarage(false);
  const teamTex = TX.makeGarage(true);
  const garageMat = new THREE.MeshStandardMaterial({ map: garageTex, emissiveMap: garageTex, emissive: 0xffffff, emissiveIntensity: 0.9 });
  const teamMat = new THREE.MeshStandardMaterial({ map: teamTex, emissiveMap: teamTex, emissive: 0xffffff, emissiveIntensity: 1.1 });
  const stripMat = new THREE.MeshBasicMaterial({ color: HDR(3.5, 3.6, 4) });
  const g = new THREE.Group();
  for (let d = PIT.wallStart; d < PIT.wallEnd; d += modW) {
    const p = track.poseAt(d + modW / 2, -(front + depth / 2));
    const mod = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(depth, height, modW - 0.3), shell);
    box.position.y = height / 2;
    const isTeam = Math.abs(d + modW / 2 - PIT.boxD) < modW / 2;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(modW - 1.6, 5), isTeam ? teamMat : garageMat);
    door.position.set(-depth / 2 - 0.01, 2.5, 0);
    door.rotation.y = -Math.PI / 2;
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, modW - 0.3), glass);
    win.position.set(-depth / 2 - 0.05, 6.8, 0);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, modW - 0.3), stripMat);
    strip.position.set(-depth / 2 - 0.2, 5.4, 0);
    mod.add(box, door, win, strip);
    mod.position.set(p.x, 0, p.z);
    mod.rotation.y = p.h + Math.PI; // local -x가 트랙을 바라보게
    mod.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(mod);
  }
  scene.add(g);

  // 사키르 타워 (피트 건물 뒤의 상징적인 탑)
  const tp = track.poseAt(40, -(front + depth + 30));
  const tower = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 46, 24), shell);
  stem.position.y = 23;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(13, 9, 9, 32), glass);
  crown.position.y = 50;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(13.2, 0.25, 8, 64), stripMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 54.4;
  const ring2 = ring.clone();
  ring2.position.y = 45.6;
  ring2.scale.setScalar(0.7);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(10, 13, 2, 32), shell);
  cap.position.y = 55.5;
  tower.add(stem, crown, ring, ring2, cap);
  tower.position.set(tp.x, 0, tp.z);
  scene.add(tower);
}

/** 출발선 위 신호등 게이트 — 빨간불 5개를 돌려줘요 */
function buildGantry(scene, track) {
  const p = track.poseAt(0, 0);
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 0.7, roughness: 0.35 });
  const leftX = track.wallL[0] - 0.6;
  const rightX = track.pitWallOffset;
  const span = leftX - rightX;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.0, 0.8), metal);
  beam.position.set((leftX + rightX) / 2, 7.6, 0);
  for (const x of [leftX, rightX]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), metal);
    col.position.set(x, 4, 0);
    g.add(col);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 0.5), metal);
  panel.position.set(0, 6.6, -0.2);
  g.add(beam, panel);
  const lights = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x220405 });
    for (const y of [6.95, 6.3]) {
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), mat);
      bulb.position.set(-2.2 + i * 1.1, y, -0.46);
      bulb.rotation.y = Math.PI;
      g.add(bulb);
    }
    lights.push(mat);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // local +x = 트랙 왼쪽, local -z가 다가오는 차를 바라보게
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.h;
  scene.add(g);
  return {
    set(count) {
      lights.forEach((m, i) => m.color.copy(i < count ? HDR(6, 0.25, 0.2) : new THREE.Color(0x220405)));
    },
  };
}

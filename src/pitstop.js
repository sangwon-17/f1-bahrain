import * as THREE from 'three';
import { PIT, CAR } from './config.js';
import { MUSCLE } from './muscle.js';

// 피트스탑: 피트레인 자동 주행(제한속도 80km/h) → 박스 정지 → 타이어 4개 교체 연출 → 출구 합류

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// 타이어 교체 타임라인 (초)
const T = {
  lift: [0.0, 0.22],      // 잭으로 차 들어올리기
  off: [0.28, 0.62],      // 헌 타이어 빼기
  away: [0.62, 0.9],      // 헌 타이어 치우기
  on: [0.95, 1.4],        // 새 타이어 끼우기
  drop: [1.7, 1.88],      // 차 내려놓기
  go: 2.05,               // 출발
};

function makeCrewMember(colorSuit, colorAccent) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: colorSuit, roughness: 0.75 });
  const accent = new THREE.MeshStandardMaterial({ color: colorAccent, roughness: 0.6 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3, metalness: 0.2 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.1, metalness: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 6, 12), suit);
  torso.position.y = 1.15;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 16), accent);
  belt.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), helmet);
  head.position.y = 1.62;
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.152, 16, 8, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.35, Math.PI * 0.25), visor);
  vis.position.y = 1.62;
  const legs = [];
  for (const x of [0.1, -0.1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.6, 4, 8), suit);
    leg.position.set(x, 0.45, 0);
    legs.push(leg);
    g.add(leg);
  }
  const arms = [];
  for (const x of [0.27, -0.27]) {
    const arm = new THREE.Group();
    arm.position.set(x, 1.38, 0);
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.5, 4, 8), suit);
    a.position.y = -0.3;
    arm.add(a);
    arms.push(arm);
    g.add(arm);
  }
  g.add(torso, belt, head, vis);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { g, torso, head, vis, legs, arms };
}

export class PitStop {
  constructor(track, scene) {
    this.track = track;
    this.scene = scene;
    this.state = 'none';  // none | entry | stop | exit
    this.requested = false;
    this.lift = 0;        // 잭으로 들어올린 높이 (main에서 차체에 더해요)
    this.lastStopTime = 0;
    const sBox = track.pitS(PIT.boxD);
    this.sBox = sBox;
    const latBox = track.pitLaneOffset(sBox);
    this.boxPose = track.poseAt(PIT.boxD, latBox);
    this.buildCrew();
  }

  // ---------- 피트 크루 ----------
  buildCrew() {
    this.crew = [];
    this.crewGroup = new THREE.Group();
    const { x, z, h } = this.boxPose;
    this.crewGroup.position.set(x, 0, z);
    this.crewGroup.rotation.y = h; // local +x = 트랙 왼쪽, +z = 진행 방향
    this.scene.add(this.crewGroup);
    const garageX = -(PIT.laneWidth / 2 + 0.2); // 차고 앞 (오른쪽)
    const add = (role, target, extra = {}) => {
      const m = makeCrewMember(0x1b2350, Math.random() < 0.5 ? 0xd61f3a : 0xffcc00);
      const wait = new THREE.Vector3(garageX + Math.random() * 0.4, 0, target.z + (Math.random() - 0.5) * 0.6);
      m.g.position.copy(wait);
      m.g.rotation.y = Math.PI / 2; // 피트레인 쪽을 바라봐요
      this.crewGroup.add(m.g);
      this.crew.push({ ...m, role, wait, target, ...extra });
    };
    const { front: F, rear: Rr } = MUSCLE;
    const wheelPos = [[F.x, F.z], [-F.x, F.z], [Rr.x, Rr.z], [-Rr.x, Rr.z]];
    wheelPos.forEach(([wx, wz], i) => {
      const side = Math.sign(wx);
      add('gun', new THREE.Vector3(wx + side * 0.75, 0, wz), { wheel: i, face: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      add('off', new THREE.Vector3(wx + side * 0.95, 0, wz - 0.55), { wheel: i, face: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      add('on', new THREE.Vector3(wx + side * 0.95, 0, wz + 0.6), { wheel: i, face: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    });
    add('jackF', new THREE.Vector3(0, 0, 3.75), { face: Math.PI });
    add('jackR', new THREE.Vector3(0, 0, -3.3), { face: 0 });
    add('stab', new THREE.Vector3(1.15, 0, 0.1), { face: -Math.PI / 2 });
    add('stab', new THREE.Vector3(-1.15, 0, 0.1), { face: Math.PI / 2 });
    // 잭 (앞/뒤)
    const jackMat = new THREE.MeshStandardMaterial({ color: 0x2a2d35, metalness: 0.7, roughness: 0.4 });
    this.jacks = [3.1, -2.85].map((zz) => {
      const j = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 1.1), jackMat);
      j.position.set(0, 0.08, zz + Math.sign(zz) * 0.9);
      j.castShadow = true;
      this.crewGroup.add(j);
      return { mesh: j, home: j.position.clone(), z: zz };
    });
  }

  updateCrew(dt, phase, tStop) {
    // phase: 0 = 대기, 1 = 차가 다가옴/작업 중, 2 = 차 떠난 뒤 복귀
    for (const c of this.crew) {
      const goal = phase === 1 ? c.target : c.wait;
      const p = c.g.position;
      const dx = goal.x - p.x, dz = goal.z - p.z;
      const dist = Math.hypot(dx, dz);
      const sp = 4.2 * dt;
      if (dist > 0.02) {
        p.x += (dx / dist) * Math.min(sp, dist);
        p.z += (dz / dist) * Math.min(sp, dist);
        c.g.rotation.y = Math.atan2(dx, dz);
        const ph = performance.now() * 0.018;
        c.legs[0].rotation.x = Math.sin(ph) * 0.6;
        c.legs[1].rotation.x = -Math.sin(ph) * 0.6;
      } else {
        c.g.rotation.y = phase === 1 && c.face !== undefined ? c.face : Math.PI / 2;
        c.legs[0].rotation.x = c.legs[1].rotation.x = 0;
      }
      // 작업 자세: 휠건은 무릎 꿇고, 타이어 담당은 허리 숙이기
      const working = phase === 1 && dist < 0.05;
      const crouch = working && (c.role === 'gun' || c.role === 'off' || c.role === 'on') ? 1 : 0;
      c.g.scale.y += ((crouch ? 0.72 : 1) - c.g.scale.y) * Math.min(1, dt * 10);
      const armDown = working ? -1.1 : 0;
      c.arms.forEach((a) => { a.rotation.x += (armDown - a.rotation.x) * Math.min(1, dt * 10); });
      if (working && c.role === 'gun' && tStop > T.off[0] && tStop < T.on[1] + 0.1) {
        c.arms.forEach((a) => { a.rotation.z = (Math.random() - 0.5) * 0.08; }); // 휠건 진동
      }
    }
    // 잭: 작업 중이면 차 밑으로
    for (const j of this.jacks) {
      const target = phase === 1 && tStop > 0 ? j.z : j.home.z;
      j.mesh.position.z += (target - j.mesh.position.z) * Math.min(1, dt * 12);
    }
  }

  reset() {
    this.state = 'none';
    this.requested = false;
    this.lift = 0;
    this.tStop = 0;
    this.swapped = false;
    for (const c of this.crew) {
      c.g.position.copy(c.wait);
      c.g.rotation.y = Math.PI / 2;
      c.g.scale.y = 1;
      c.arms.forEach((a) => a.rotation.set(0, 0, 0));
      c.legs.forEach((l) => l.rotation.set(0, 0, 0));
    }
    this.jacks.forEach((j) => j.mesh.position.copy(j.home));
  }

  /** 피트스탑이 아닐 때: 크루는 차고 앞으로 돌아가 대기 */
  idle(dt) { this.updateCrew(dt, 2, 0); }

  // ---------- 피트 진입 판정 ----------
  /** 이번 프레임에 피트로 들어가야 하는지 (요청했거나, 직접 피트레인 입구로 들어왔거나) */
  checkEntry(prevD, loc) {
    if (this.state !== 'none') return false;
    const s = this.track.pitS(loc.d);
    const sPrev = this.track.pitS(prevD);
    const crossedStart = sPrev > this.track.pitLen + 50 && s < 60;
    if (this.requested && crossedStart) return true;
    if (s < PIT.rampIn && loc.lat < -(this.track.hw + 3.5)) return true; // 직접 핸들 꺾어 들어옴
    return false;
  }

  begin(phys, loc) {
    this.state = 'entry';
    this.s = this.track.pitS(loc.d);
    this.lat0 = loc.lat - this.track.pitLaneOffset(this.s);
    this.v = Math.max(phys.u, 5);
    this.tStop = 0;
    this.requested = false;
  }

  /** 피트레인 경로 위의 위치와 방향 */
  pathPose(s) {
    const tr = this.track;
    const fade = 1 - smooth01(s / (PIT.rampIn * 0.85));
    const lat = tr.pitLaneOffset(s) + this.lat0 * fade;
    return tr.poseAt(tr.wrap(PIT.startD + s), lat);
  }

  /** 자동 주행. 피트가 끝나면 true를 돌려줘요 */
  update(dt, phys, car) {
    const tr = this.track;
    let done = false;
    if (this.state === 'entry') {
      const toBox = this.sBox - this.s;
      let target = PIT.limiter;
      if (toBox < 60) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 6.5 * (toBox - 0.05))));
      const decel = this.v > PIT.limiter + 1 ? 22 : 7;
      this.v = this.v > target ? Math.max(target, this.v - decel * dt) : Math.min(target, this.v + 6 * dt);
      if (toBox <= 0.06 || (toBox < 0.6 && this.v < 0.3)) {
        this.s = this.sBox;
        this.v = 0;
        this.state = 'stop';
        this.tStop = 0;
        this.gunsFired = 0;
      }
    } else if (this.state === 'stop') {
      this.tStop += dt;
      this.animateTyres(phys, car);
      if (this.tStop >= T.go) {
        this.lastStopTime = this.tStop;
        this.state = 'exit';
      }
    } else if (this.state === 'exit') {
      const exitStart = tr.pitLen - PIT.rampOut;
      const target = this.s < exitStart ? PIT.limiter : 45;
      const acc = this.s < exitStart ? 7 : 11;
      this.v = Math.min(target, this.v + acc * dt);
      if (this.s >= tr.pitLen - 1) done = true;
    }
    this.s += this.v * dt;

    // 차를 경로 위에 놓기
    const p = this.pathPose(this.s);
    const p2 = this.pathPose(this.s + 1);
    phys.x = p.x;
    phys.z = p.z;
    phys.yaw = Math.atan2(p2.x - p.x, p2.z - p.z);
    phys.u = this.v;
    phys.v = 0;
    phys.r = 0;
    phys.steerIn *= 0.9;
    phys.steer = 0;
    phys.throttle = this.state === 'exit' ? 0.7 : 0.15;
    phys.brake = 0;
    phys.wheelSpin += (this.v / CAR.wheelRadius) * dt;
    phys.updateGear(dt);

    // 크루 움직임: 차가 박스 80m 앞부터 나와 있어요
    const near = this.state === 'entry' ? this.sBox - this.s < 80 : this.state === 'stop';
    this.updateCrew(dt, near ? 1 : 2, this.state === 'stop' ? this.tStop : 0);

    if (done) {
      this.state = 'none';
      this.lift = 0;
    }
    return done;
  }

  animateTyres(phys, car) {
    const t = this.tStop;
    const inT = ([a, b]) => smooth01((t - a) / (b - a));
    this.lift = 0.075 * inT(T.lift) * (1 - inT(T.drop));
    const offK = inT(T.off), awayK = inT(T.away), onK = inT(T.on);
    if (t >= T.on[0] && !this.swapped) {
      this.swapped = true;
      phys.newTyres();
    }
    car.wheels.forEach((w, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      let out, drop;
      if (t < T.on[0]) {
        // 헌 타이어: 바깥으로 빠졌다가 멀리 치워져요
        out = offK * 0.55 + awayK * 1.4;
        drop = awayK * 0.15;
        w.spin.visible = t < T.away[1];
      } else {
        // 새 타이어: 바깥에서 들어와 끼워져요
        out = (1 - onK) * 0.7;
        drop = 0;
        w.spin.visible = true;
      }
      w.mount.position.set(side * out, -drop, 0);
    });
    if (t >= T.drop[1]) this.swapped = false;
  }

  /** 휠건 소리 등 이벤트용: 이번 정지의 진행 시간 */
  get stopTime() { return this.tStop || 0; }
  get active() { return this.state !== 'none'; }
  get stopped() { return this.state === 'stop'; }
}

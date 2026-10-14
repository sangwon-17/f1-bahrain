import { buildProceduralCar } from './car.js';
import { CAR } from './config.js';
import { nameTag, tintCar } from './race.js';

// AI 차량: 트랙 중심선을 따라 진행거리(prog)와 옆 위치(lat)로 달려요
// 코너 곡률로 '이 지점에서 낼 수 있는 최고 속도'를 미리 계산하고, 앞차가 있으면 옆으로 비켜 추월해요

export const AI_COUNT = 7;
const DRIVERS = [
  ['K. ARDEN', 0xd4102b, '#ff5a6e'],
  ['L. MORA', 0x19a0d8, '#19d3ff'],
  ['T. VANCE', 0xf08a12, '#fb923c'],
  ['R. SATO', 0x2f9e4a, '#a3e635'],
  ['M. COSTA', 0x7b3fd1, '#c084fc'],
  ['J. BRANDT', 0xc8c8cc, '#e5e7eb'],
  ['E. LUND', 0x0e7c7b, '#2dd4bf'],
];
const SKILL = [1.07, 1.06, 1.05, 1.04, 1.03, 1.02, 1.01]; // 앞 그리드일수록 빨라요 (1 = 나와 비슷)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AiField {
  constructor(track, scene, envMap) {
    this.track = track;
    this.cars = DRIVERS.slice(0, AI_COUNT).map(([name, paint, color], i) => {
      const car = buildProceduralCar(envMap);
      tintCar(car, paint);
      car.driverParts.forEach((p) => { p.visible = true; });
      const tag = nameTag();
      tag.set(name, color);
      car.root.add(tag.sprite);
      car.root.visible = false;
      scene.add(car.root);
      return { car, name, color, skill: SKILL[i], profile: this.profile(SKILL[i]), prog: 0, lat: 0, latV: 0, v: 0, spin: 0, fin: null };
    });
  }

  /** 트랙 각 지점의 목표 속도 (코너 한계 → 뒤에서부터 브레이크 거리 반영) */
  profile(skill) {
    const { k, N, step } = this.track;
    const mu = CAR.mu * CAR.cornerAssist * 1.08 * skill, c = (mu * 1.92) / CAR.mass; // 다운포스 덕분에 빠를수록 더 잡아요
    const top = 99 * (0.97 + 0.03 * skill);
    const v = Array.from({ length: N }, (_, i) => Math.min(top, Math.sqrt((mu * 9.81) / Math.max(Math.abs(k[i]) - c, 1e-5))));
    const brake = 50 * skill;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % N] ** 2 + 2 * brake * step));
    }
    return v;
  }

  /** slots: 각 AI가 설 그리드 번호 → gridPose(slot) */
  reset(poses) {
    this.cars.forEach((a, i) => {
      const p = poses[i];
      const loc = this.track.locate(p.x, p.z);
      a.prog = loc.d > this.track.L / 2 ? loc.d - this.track.L : loc.d;
      a.lat = loc.lat;
      a.lane = (Math.random() - 0.5) * 3;
      a.latV = 0;
      a.v = 0;
      a.fin = null;
      a.launch = 0.05 + Math.random() * 0.15; // 출발 반응 시간
      a.car.root.visible = true;
      this.place(a, 0);
    });
  }

  hide() { this.cars.forEach((a) => { a.car.root.visible = false; }); }

  /** player: { prog, lat, v } — 나도 피해야 할 차로 넣어요 */
  update(dt, raceTime, player, laps) {
    const { track } = this;
    const L = track.L, hw = track.hw - 1.6;
    const all = [...this.cars.map((a) => ({ prog: a.prog, lat: a.lat, v: a.v, self: a })), player];
    for (const a of this.cars) {
      if (raceTime < a.launch) { this.place(a, dt); continue; }
      const d = track.wrap(a.prog);
      const i = Math.floor(d / track.step) % track.N;
      // 따라잡기: 나보다 뒤에 있으면 조금 더 빠르게, 많이 앞서 있으면 살짝 느리게 (끝까지 경쟁하도록)
      let behind = player.prog - a.prog;
      behind -= Math.round(behind / L) * L;
      const catchUp = 1 + clamp(behind / 250, -0.01, 0.08);
      let target = a.profile[i] * catchUp;
      // 앞차 찾기
      let lead = null;
      for (const o of all) {
        if (o.self === a) continue;
        let gap = o.prog - a.prog;
        gap -= Math.round(gap / L) * L;
        if (gap > 0 && gap < 30 && Math.abs(o.lat - a.lat) < 2.6 && (!lead || gap < lead.gap)) lead = { ...o, gap };
      }
      let latTarget = a.lane;
      if (lead) {
        // 옆에 자리가 있으면 비켜서 추월, 아니면 뒤에서 속도 맞추기
        const side = lead.lat > 0 ? -1 : 1;
        const pass = clamp(lead.lat + side * 3.3, -hw, hw);
        const blocked = all.some((o) => o.self !== a && Math.abs(o.lat - pass) < 2.2 && Math.abs(((o.prog - a.prog + L / 2) % L + L) % L - L / 2) < 8);
        if (!blocked && a.v > lead.v - 2) latTarget = pass;
        else if (a.v > lead.v) target = Math.min(target, lead.v + Math.max(0, lead.gap - 6) * 1.5); // 너무 붙으면 속도 맞추기
      }
      // 가속 (F1 출력 / 공기저항), 브레이크
      const accel = Math.min(14.5 * CAR.traction / 1.25, CAR.power / CAR.mass / Math.max(a.v, 6)) - (0.6 * CAR.dragArea * a.v * a.v) / CAR.mass;
      a.braking = target < a.v - 0.5;
      a.v = clamp(a.v + clamp(target - a.v, -45 * dt, accel * (0.9 + 0.1 * a.skill) * catchUp * dt), 0, 100);
      a.prog += a.v * dt;
      // 옆 이동 (부드럽게)
      const want = clamp((latTarget - a.lat) * 1.4, -3.2, 3.2) * clamp(a.v / 15, 0.2, 1);
      a.latV += (want - a.latV) * Math.min(1, dt * 4);
      a.lat = clamp(a.lat + a.latV * dt, -hw, hw);
      if (a.fin == null && a.prog >= laps * L) a.fin = raceTime;
      this.place(a, dt);
    }
  }

  place(a, dt) {
    const p = this.track.poseAt(a.prog, a.lat);
    const yaw = p.h + Math.atan2(a.latV, Math.max(a.v, 1));
    a.x = p.x; a.z = p.z; a.yaw = yaw;
    const { car } = a;
    car.root.position.set(p.x, 0, p.z);
    car.root.rotation.y = yaw;
    const k = this.track.k[Math.floor(this.track.wrap(a.prog) / this.track.step) % this.track.N];
    a.spin += (a.v / CAR.wheelRadius) * dt;
    car.wheels.forEach((w, wi) => {
      if (wi < 2) w.pivot.rotation.y = Math.atan(k * (CAR.cgToFront + CAR.cgToRear)) * 1.5;
      w.spin.rotation.x = a.spin;
    });
    car.setBrake?.(a.braking ? 1 : 0);
  }

  /** 부딪힘 계산용 */
  obstacles() {
    return this.cars.filter((a) => a.car.root.visible).map((a) => ({
      x: a.x, z: a.z, yaw: a.yaw, vx: Math.sin(a.yaw) * a.v, vz: Math.cos(a.yaw) * a.v, ai: true,
    }));
  }

  /** 미니맵 점 */
  dots() { return this.cars.filter((a) => a.car.root.visible).map((a) => ({ x: a.x, z: a.z, color: a.color })); }
}

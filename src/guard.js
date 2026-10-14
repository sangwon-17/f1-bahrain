import { TRACK, GUARD, STEER, CAR } from './config.js';

// 코너 이탈 방지 (설정: config.js GUARD)
// - 코너에 들어가기 직전부터 코너가 끝날 때까지만 켜져요. 지나온 코너 뒤 직선에선 꺼져요.
// - 곧 연석 밖으로 나갈 것 같으면 핸들을 살짝 대신 꺾어줘요 (phys.guardSteer → physics.js가 핸들 입력에 더해요).
// - 너무 빨리 들어와서 핸들 보조로도 못 돌면 막지 않아요. 그대로 밀려나가요 (런오프·모래에서 자연스럽게 느려져요).
// - 직선에서 내가 트랙 밖으로 나갔으면 그대로 두고, 트랙에 돌아올 때까지 보조를 쉬어요.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** 각 지점에서 '앞쪽 GUARD.aheadM 미터 안에 코너가 얼마나 있는지' (0~1) — 뒤쪽(지나온 코너)은 안 봐요 */
export function buildGuardZone(track) {
  const { k, N, step } = track;
  const raw = k.map((v) => clamp((Math.abs(v) - 1 / 300) / (1 / 70 - 1 / 300), 0, 1));
  const ahead = Math.max(0, Math.round(GUARD.aheadM / step));
  const zone = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let j = 0; j <= ahead; j++) m = Math.max(m, raw[(i + j) % N]);
    zone[i] = m;
  }
  return zone;
}

export class CornerGuard {
  constructor(track) {
    this.track = track;
    this.zone = buildGuardZone(track);
    this.armed = true; // false = 직선에서 트랙 밖으로 나간 상태 (보조 쉬는 중)
  }

  reset() { this.armed = true; }

  /** off = 피트 등에서 끄기 */
  update(dt, phys, loc, off = false) {
    const { track } = this;
    const edge = track.hw + TRACK.kerbWidth - TRACK.carHalfWidth - GUARD.margin;
    const absLat = Math.abs(loc.lat);
    const w = !GUARD.on || off || phys.reverse ? 0 : smooth01((this.zone[loc.idx] - GUARD.cornerFrom) / (GUARD.cornerFull - GUARD.cornerFrom));

    // 보조 켜고 끄기: 트랙에 돌아오면 다시 켜요. 직선에서 벗어났거나, 코너에서도 이미 꽤 밀려나갔으면 꺼요.
    if (absLat <= edge - 0.5) this.armed = true;
    else if (absLat > edge && (w < 0.5 || absLat > edge + GUARD.letGo)) this.armed = false;

    const side = loc.lat >= 0 ? 1 : -1; // 가까운 쪽 가장자리 (+ = 왼쪽)
    const { vx, vz } = phys.worldVel();
    const out = (vx * loc.nx + vz * loc.nz) * side;
    const along = vx * Math.sin(loc.h) + vz * Math.cos(loc.h);

    // 미리 보고 핸들을 살짝 대신 꺾어주기
    let want = 0;
    if (this.armed && w > 0 && along > 5) {
      const excess = out - Math.max(0, edge - absLat) / GUARD.lookahead;
      if (excess > 0) {
        const needRate = Math.atan2(excess, along) / GUARD.lookahead; // 이만큼 더 돌아야 해요 (rad/s)
        const perSteer = (along * Math.tan(STEER.cornerDeg * Math.PI / 180)) / (CAR.cgToFront + CAR.cgToRear); // 핸들 끝까지 = 이만큼 돌아요
        want = -side * w * Math.min(GUARD.maxSteer, (needRate / perSteer) * GUARD.strength);
      }
    }
    phys.guardSteer += (want - phys.guardSteer) * Math.min(1, dt * GUARD.smooth);
  }
}

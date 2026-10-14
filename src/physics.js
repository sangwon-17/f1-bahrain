import { CAR, TYRE, GEARS, DRIFT, STEER } from './config.js';

// F1 주행 물리 — 자전거 모델(앞/뒤 바퀴 두 개로 단순화) + 다운포스 + 타이어 마모
// 좌표: u = 앞으로 가는 속도, v = 옆(왼쪽 +) 속도, r = 회전 속도(왼쪽 +)

const G = 9.81, RHO = 1.2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (cur, target, maxStep) => cur + clamp(target - cur, -maxStep, maxStep);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// 타이어가 옆으로 미는 힘: 미끄러짐 각도가 약 6~7도일 때 최대, 그 이상은 살짝 줄어요
function tyreForce(alpha, maxForce) {
  return maxForce * Math.sin(1.6 * Math.atan(13.6 * alpha));
}

export const SURFACE = {
  track: { grip: 1.0, drag: 0 },
  pit: { grip: 1.0, drag: 0 },
  kerb: { grip: 0.94, drag: 250 },
  runoff: { grip: 0.96, drag: 120 },
  sand: { grip: 0.5, drag: 5200 },
};

export class CarPhysics {
  constructor() {
    this.wear = [0, 0, 0, 0]; // 앞왼, 앞오, 뒤왼, 뒤오
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, z, yaw,
      u: 0, v: 0, r: 0,
      steerIn: 0, steer: 0, guardSteer: 0, throttle: 0, brake: 0,
      gear: 1, rpm: 4000, shiftT: 0, reverse: false, reverseHold: 0,
      ax: 0, ay: 0, wheelSpin: 0, slipF: 0, slipR: 0, lockup: 0, drift: 0,
    });
  }

  newTyres() { this.wear = [0, 0, 0, 0]; }

  get speed() { return Math.hypot(this.u, this.v); }

  tyreGrip(i, j) {
    const w = (this.wear[i] + this.wear[j]) / 2;
    return 1 - TYRE.gripLossAtFull * Math.pow(w, 1.5);
  }

  /** input: { left, right, up, down, drift }, surf: { grip, drag } */
  step(dt, input, surf) {
    const a = CAR.cgToFront, b = CAR.cgToRear, Lw = a + b, m = CAR.mass;

    // ---- 키 입력을 부드럽게 (키보드라도 핸들이 천천히 돌아가요) ----
    // guardSteer = 코너 이탈 방지가 살짝 대신 꺾어주는 양 (main.js cornerGuard)
    const steerTarget = clamp((input.left ? 1 : 0) - (input.right ? 1 : 0) + (this.guardSteer || 0), -1, 1);
    const returning = steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(this.steerIn);
    this.steerIn = approach(this.steerIn, steerTarget, (returning ? 5.5 : 4.5) * dt);
    this.throttle = approach(this.throttle, input.up ? 1 : 0, (input.up ? 9 : 7) * dt);
    this.brake = approach(this.brake, input.down ? 1 : 0, (input.down ? 8 : 8) * dt); // 키를 누르면 빠르게 세게

    const u = this.u, au = Math.abs(u);
    // 드리프트: 스페이스바를 누르고 어느 정도 속도가 있으면 서서히 뒤가 미끄러지기 시작해요
    const wantDrift = input.drift && !this.reverse && u > 8 ? 1 : 0;
    this.drift = approach(this.drift, wantDrift, (wantDrift ? DRIFT.blendIn : DRIFT.blendOut) * dt);
    const d = this.drift;
    // 빠를수록 핸들이 조금만 꺾여요 (실제 F1도 고속에선 아주 작게 꺾어요)
    // 핸들 최대 각도 (config.js STEER): 직선은 속도에 따라 작게, 코너 구간에선 cornerDeg까지
    // cornerAmt = 지금 위치가 얼마나 코너인지 (0 = 직선, 1 = 코너, main.js에서 넣어줘요)
    const kmh = au * 3.6;
    const straightDeg = STEER.straightSlowDeg + (STEER.straightFastDeg - STEER.straightSlowDeg) * clamp((kmh - 60) / (250 - 60), 0, 1);
    let deg = straightDeg + (STEER.cornerDeg - straightDeg) * (this.cornerAmt || 0);
    deg += (Math.max(deg, STEER.parkingDeg) - deg) * smooth01((40 - kmh) / 25); // 거의 멈췄을 땐 크게 (유턴·피트)
    deg += STEER.driftExtraDeg * d;
    this.steer = this.steerIn * deg * (Math.PI / 180);
    const steerWant = this.steer; // 운전자가 꺾고 싶은 만큼 (아래 조향 보조로 줄이기 전)
    // 조향 보조: 앞바퀴가 최대 접지력을 내는 각도(약 7°)보다 더 미끄러지지 않게 꺾는 양을 맞춰요
    // 드리프트 중엔 카운터스티어가 되도록 여유를 더 줘요
    // (한도를 너무 넓히면 앞바퀴가 최대 접지력 각도를 넘어 미끄러져서 코너에서 앞이 밀려요)
    if (au > 5) {
      const phi = Math.atan2(this.v + a * this.r, au);
      const lim = 0.12 + 0.63 * d; // 평소 약 7°, 드리프트 중 최대 약 43°
      this.steer = clamp(this.steer, phi - lim, phi + lim);
    }

    // 후진: 멈춘 상태에서 ↓를 계속 누르면
    if (input.down && !input.up && au < 0.8) this.reverseHold += dt; else this.reverseHold = 0;
    if (this.reverseHold > 0.45) this.reverse = true;
    if (input.up && u > -0.5) this.reverse = false;

    // ---- 무게와 다운포스 ----
    // 액티브 에어로(직선 모드)가 열리면 다운포스와 공기저항이 줄어요
    const open = this.aeroOpen || 0;
    const DF = 0.5 * RHO * CAR.liftArea * (1 - 0.35 * open) * u * u;
    const transfer = (m * this.ax * 0.12) / Lw; // 브레이크 밟으면 앞쪽이 살짝 눌려요
    const FzF = Math.max(800, (m * G * b) / Lw + DF * CAR.aeroFront - transfer);
    const FzR = Math.max(800, (m * G * a) / Lw + DF * (1 - CAR.aeroFront) + transfer);
    const muF = CAR.mu * surf.grip * this.tyreGrip(0, 1);
    const muRbase = CAR.mu * surf.grip * this.tyreGrip(2, 3);
    const muR = muRbase * (1 - (1 - DRIFT.rearGrip) * d); // 드리프트 중 뒷바퀴가 덜 잡아요

    // ---- 앞뒤 방향 힘 ----
    let Fdrive = 0, Fbrake = 0, engineBrake = 0;
    if (this.reverse) {
      if (input.down && u > -7) Fdrive = -3500;
      if (input.up) Fbrake = 6000 * Math.sign(u);
    } else {
      Fdrive = (CAR.power * this.throttle) / Math.max(au, 6);
      if (this.shiftT > 0) Fdrive *= 0.8; // F1은 기어 변속이 아주 빨라요 // 기어 바꾸는 순간 살짝 힘이 빠져요
      Fdrive = Math.min(Fdrive, muRbase * FzR * CAR.traction); // 트랙션 컨트롤: 바퀴가 헛돌지 않게
      // 뒷바퀴가 옆으로 많이 미끄러지면 힘을 줄여서 스핀을 막아요 (키보드용 보조, 드리프트 중엔 꺼져요)
      const rearSlip = Math.abs(Math.atan2(this.v - b * this.r, Math.max(au, 3)));
      Fdrive *= 1 - clamp((rearSlip - 0.12) / 0.1, 0, 0.5) * (1 - d); // 코너에서도 액셀이 잘 먹게 덜 끊어요
      if (u > 0.05) {
        Fbrake = this.brake * Math.min(CAR.maxBrake, (muF * FzF + muR * FzR) * CAR.brakeGrip); // ABS (게임용으로 강하게)
        engineBrake = (1 - this.throttle) * (1200 + au * 35); // 엔진 브레이크 (뒷바퀴)
      }
    }
    const dir = Math.sign(u);
    const Fres = 0.5 * RHO * CAR.dragArea * (1 - 0.2 * open) * u * u * dir + 170 * dir + surf.drag * clamp(u / 3, -1, 1);
    const Fx = Fdrive - Fbrake - engineBrake - Fres;

    // ---- 옆 방향 힘 (타이어 미끄러짐 각도) ----
    const uu = Math.max(au, 3);
    const alphaF = Math.atan2(this.v + a * this.r, uu) - this.steer * (u >= 0 ? 1 : -1);
    const alphaR = Math.atan2(this.v - b * this.r, uu);
    // 타이어 한 개가 낼 수 있는 힘은 정해져 있어요: 브레이크/가속에 쓰면 옆으로 버티는 힘이 줄어요
    // 브레이크 배분: 앞 60% / 뒤 40%
    const useF = clamp((Fbrake * 0.6) / (muF * FzF), 0, 0.9);
    const useR = clamp((Fbrake * 0.4 + engineBrake + Math.abs(Fdrive)) / (muR * FzR), 0, 0.9);
    const FyF = -tyreForce(alphaF, muF * FzF) * Math.sqrt(1 - useF * useF * 0.6);
    const FyR = -tyreForce(alphaR, muR * FzR) * Math.sqrt(1 - useR * useR * 0.45);
    this.slipF = alphaF;
    this.slipR = alphaR;

    // ---- 운동 방정식 ----
    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
    const du = (Fx - FyF * sn * 0.35) / m + this.v * this.r; // 코너링 보조: 핸들을 꺾어도 속도가 덜 빠져요
    const dv = (FyR + FyF * cs) / m - u * this.r;
    const dr = (a * FyF * cs - b * FyR) / CAR.inertia;
    let nu = u + du * dt;
    let nv = this.v + dv * dt;
    let nr = this.r + dr * dt;
    if (au > 5) {
      // 핸들 각도와 접지력으로 정해지는 '자연스러운' 회전 속도
      const boost = 1 + (DRIFT.yawBoost - 1) * d;
      const gripLimit = (((muF * FzF + muRbase * FzR) / m) / au) * boost * CAR.cornerAssist;
      // 목표 회전은 실제 바퀴 각도가 아니라 운전자가 꺾은 만큼으로 정해요 (바퀴는 접지력 최대 각도에 머물러요)
      const rRef = clamp(((u * Math.tan(steerWant)) / Lw) * boost, -gripLimit, gripLimit);
      if (Math.sign(nr) !== Math.sign(rRef) || Math.abs(nr) > Math.abs(rRef)) {
        nr += (rRef - nr) * Math.min(1, dt * (7 - 4 * d)); // 스핀 방지 (오버스티어 잡기), 드리프트 중엔 느슨하게
      } else if (this.steerIn !== 0) {
        nr += (rRef - nr) * Math.min(1, dt * CAR.assistRate * (1 - 0.6 * d)); // 코너링 보조: 밀려나가지 않게 차를 돌려줘요
      }
      // 옆미끄러짐 줄이기: 평소엔 약 5°, 드리프트 중엔 최대 DRIFT.maxAngle까지 허용
      // 줄인 옆 속도는 앞 속도로 돌려줘서 속도가 덜 빠져요
      const maxBeta = 0.09 + (DRIFT.maxAngle - 0.09) * d;
      const beta = Math.atan2(nv, Math.max(nu, 1));
      if (Math.abs(beta) > maxBeta) {
        const sp = Math.hypot(nu, nv);
        nv -= (nv - Math.tan(maxBeta * Math.sign(beta)) * nu) * Math.min(1, dt * (8 - 5 * d));
        const keep = Math.max(d, 0.95); // 옆으로 미끄러지던 속도를 앞으로 돌려줘서 코너에서도 속도 유지
        if (nu > 0) nu = Math.sqrt(Math.max(0, sp * sp - nv * nv)) * keep + nu * (1 - keep);
      }
      // 드리프트 중 속도가 갑자기 빠지지 않게 (브레이크를 밟으면 그대로 감속)
      if (d > 0 && !input.down && surf.drag < 1000) {
        const before = Math.hypot(u, this.v), after = Math.hypot(nu, nv);
        const floor = before - DRIFT.speedLoss * dt;
        if (after > 0.1 && after < floor) {
          const k = 1 + (floor / after - 1) * d;
          nu *= k;
          nv *= k;
        }
      }
    }
    if (!this.reverse && u >= 0 && nu < 0) nu = 0; // 브레이크로 뒤로 가지는 않아요
    if (this.reverse && u <= 0 && nu > 0 && !input.up) nu = 0;

    // 아주 느릴 때는 단순한 바퀴 굴림 모델로 (흔들림 방지)
    const w = smooth01((Math.abs(nu) - 1) / 4);
    const rKin = (nu * Math.tan(this.steer)) / Lw;
    nr = nr * w + rKin * (1 - w);
    nv = nv * w + rKin * b * (1 - w);

    this.u = nu;
    this.v = nv;
    this.r = nr;
    this.yaw += this.r * dt;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.x += (sy * this.u + cy * this.v) * dt;
    this.z += (cy * this.u - sy * this.v) * dt;

    // 가속도 (무게 이동, 카메라 흔들림, 마모용)
    this.ax += ((Fx / m) - this.ax) * Math.min(1, dt * 8);
    this.ay += ((this.u * this.r) - this.ay) * Math.min(1, dt * 8);
    this.wheelSpin += (this.u / CAR.wheelRadius) * dt;
    this.lockup = this.brake > 0.9 && au > 20 ? this.brake : 0;

    this.updateGear(dt);
    this.updateWear(dt, FyF, FyR, alphaF, alphaR, Fdrive, Fbrake);
  }

  updateGear(dt) {
    this.shiftT = Math.max(0, this.shiftT - dt);
    const au = Math.abs(this.u);
    this.shifted = 0;
    if (this.reverse) {
      this.gear = -1;
      this.rpm = 1500 + au * 300;
      return;
    }
    if (this.gear < 1) this.gear = 1;
    if (this.gear < GEARS.length - 1 && au > GEARS[this.gear] * 0.97) { this.gear++; this.shiftT = 0.03; this.shifted = 1; }
    else if (this.gear > 1 && au < GEARS[this.gear - 1] * 0.82) { this.gear--; this.shifted = -1; }
    const lo = this.gear > 1 ? GEARS[this.gear - 1] * 0.78 : 0;
    const hi = GEARS[this.gear];
    const t = clamp((au - lo) / (hi - lo), 0, 1);
    // F1 엔진 회전수 (약 5,000 ~ 12,500 rpm)
    const target = (this.gear === 1 ? 5000 : 9600) + t * (this.gear === 1 ? 7400 : 2900) + this.throttle * 150;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 18);
  }

  updateWear(dt, FyF, FyR, aF, aR, Fdrive, Fbrake) {
    const au = Math.abs(this.u);
    const LAP = 5400, E_LAP = 1.7e6; // 한 바퀴 거리, 한 바퀴 동안 타이어가 받는 대략적인 에너지
    const eF = (Math.abs(FyF * aF) + Fbrake * 0.03) * au;
    const eR = (Math.abs(FyR * aR) + Math.abs(Fdrive) * 0.03) * au;
    const base = (0.35 * au * dt) / LAP;
    const side = clamp(this.ay / 25, -0.7, 0.7); // 왼쪽으로 돌면 오른쪽 타이어가 더 눌려요
    const k = TYRE.wearPerLap;
    const add = (i, e, s) => { this.wear[i] = Math.min(1, this.wear[i] + k * (base + (0.65 * e * (1 + s) * dt) / E_LAP)); };
    add(0, eF, -side);
    add(1, eF, side);
    add(2, eR, -side);
    add(3, eR, side);
  }

  /** 월드 기준 속도 */
  worldVel() {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    return { vx: sy * this.u + cy * this.v, vz: cy * this.u - sy * this.v };
  }

  /** 월드 기준 속도를 다시 차 기준(u, v)으로 */
  setWorldVel(vx, vz) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.u = vx * sy + vz * cy;
    this.v = vx * cy - vz * sy;
  }
}

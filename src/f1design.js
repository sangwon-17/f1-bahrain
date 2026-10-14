import { loftBody, loftWing, plate } from './f1geometry.js';

// 2026 규정 느낌의 F1 차체 설계도 (길이 약 5.4m, 휠베이스 3.4m, 폭 1.9m)
// 각 부품: { name, geo, mat }. mat 이름은 car.js의 재질 목록과 맞춰요.

export const WHEELS = {
  radius: 0.36,
  front: { x: 0.8, z: 1.7, width: 0.28 },
  rear: { x: 0.76, z: -1.7, width: 0.375 },
};

const deg = Math.PI / 180;

export function designF1() {
  const parts = [];
  const add = (name, geo, mat) => parts.push({ name, geo, mat });

  // ---------- 노즈 + 모노코크 + 엔진 커버 (하나로 매끈하게) ----------
  add('chassis', loftBody([
    { z: -2.22, w: 0.035, top: 0.32, bot: 0.22, n: 2.2 },
    { z: -2.05, w: 0.09, top: 0.39, bot: 0.17, n: 2.3 },
    { z: -1.7, w: 0.14, top: 0.5, bot: 0.13, n: 2.4 },
    { z: -1.3, w: 0.2, top: 0.65, bot: 0.11, n: 2.6 },
    { z: -0.9, w: 0.26, top: 0.81, bot: 0.1, n: 2.7 },
    { z: -0.5, w: 0.3, top: 0.94, bot: 0.09, n: 2.9 },
    { z: -0.25, w: 0.33, top: 0.9, bot: 0.08, n: 3.2 },
    { z: 0.0, w: 0.36, top: 0.62, bot: 0.08, n: 4 },
    { z: 0.35, w: 0.36, top: 0.6, bot: 0.08, n: 4 },
    { z: 0.65, w: 0.33, top: 0.58, bot: 0.08, n: 3.6 },
    { z: 1.0, w: 0.27, top: 0.53, bot: 0.1, n: 3.4 },
    { z: 1.35, w: 0.22, top: 0.47, bot: 0.15, n: 3.1 },
    { z: 1.65, w: 0.18, top: 0.42, bot: 0.17, n: 2.9 },
    { z: 2.0, w: 0.15, top: 0.37, bot: 0.16, n: 2.7 },
    { z: 2.3, w: 0.12, top: 0.33, bot: 0.15, n: 2.5 },
    { z: 2.52, w: 0.08, top: 0.29, bot: 0.15, n: 2.3 },
    { z: 2.62, w: 0.035, top: 0.25, bot: 0.17, n: 2.1 },
  ], { radial: 96, sub: 10 }), 'livery');

  // ---------- 사이드포드 (콜라병 모양) ----------
  for (const s of [1, -1]) {
    add(`sidepod${s}`, loftBody([
      { z: -1.38, cx: 0.3 * s, w: 0.05, top: 0.22, bot: 0.12, n: 2.2 },
      { z: -1.0, cx: 0.38 * s, w: 0.13, top: 0.31, bot: 0.1, n: 2.6 },
      { z: -0.5, cx: 0.47 * s, w: 0.2, top: 0.41, bot: 0.09, n: 3 },
      { z: 0.0, cx: 0.53 * s, w: 0.24, top: 0.51, bot: 0.09, n: 3.4 },
      { z: 0.5, cx: 0.54 * s, w: 0.24, top: 0.57, bot: 0.1, n: 3.8 },
      { z: 0.82, cx: 0.53 * s, w: 0.22, top: 0.57, bot: 0.15, n: 4 },
      { z: 0.95, cx: 0.52 * s, w: 0.2, top: 0.55, bot: 0.22, n: 4.5 },
    ], { radial: 72, sub: 8 }), 'sidepod');
  }

  // ---------- 바닥판 + 디퓨저 ----------
  add('floor', loftBody([
    { z: -1.4, w: 0.5, top: 0.075, bot: 0.045, n: 10 },
    { z: -1.2, w: 0.62, top: 0.075, bot: 0.045, n: 10 },
    { z: -0.8, w: 0.78, top: 0.075, bot: 0.045, n: 10 },
    { z: 0.2, w: 0.79, top: 0.075, bot: 0.045, n: 10 },
    { z: 0.9, w: 0.74, top: 0.075, bot: 0.045, n: 10 },
    { z: 1.25, w: 0.42, top: 0.075, bot: 0.045, n: 10 },
    { z: 1.4, w: 0.22, top: 0.075, bot: 0.05, n: 8 },
  ], { radial: 48, sub: 6 }), 'carbon');
  add('diffuser', loftBody([
    { z: -2.3, w: 0.5, top: 0.37, bot: 0.33, n: 10 },
    { z: -2.0, w: 0.5, top: 0.23, bot: 0.19, n: 10 },
    { z: -1.7, w: 0.5, top: 0.12, bot: 0.08, n: 10 },
    { z: -1.4, w: 0.5, top: 0.075, bot: 0.045, n: 10 },
  ], { radial: 48, sub: 6 }), 'carbon');
  for (const x of [-0.45, -0.2, 0.2, 0.45]) {
    add('strake', plate([[-1.45, 0.06], [-2.3, 0.33], [-2.3, 0.42], [-1.55, 0.13]], x, 0.012), 'carbon');
  }

  // ---------- 앞날개 (얇은 4단, 바깥으로 갈수록 높고 각도가 커요) ----------
  const fw = (le, y, chord, aoa, lift, rise, thick = 0.07) => [-0.94, -0.75, -0.5, -0.3, -0.16, 0, 0.16, 0.3, 0.5, 0.75, 0.94].map((x) => {
    const a = Math.abs(x);
    const out = Math.pow(Math.max(0, (a - 0.16) / 0.78), 1.3);
    return { x, le: le - out * 0.06, y: y + out * rise, chord: chord * (1 - out * 0.12), aoa: aoa + out * lift, thick, camber: 0.07 };
  });
  add('fwMain', loftWing(fw(2.74, 0.075, 0.27, 3 * deg, 5 * deg, 0.02, 0.06)), 'carbon');
  add('fwFlap1', loftWing(fw(2.53, 0.115, 0.17, 14 * deg, 10 * deg, 0.05)), 'wingNavy');
  add('fwFlap2', loftWing(fw(2.42, 0.16, 0.13, 24 * deg, 10 * deg, 0.08)), 'wingNavy');
  add('fwFlap3', loftWing(fw(2.34, 0.205, 0.1, 34 * deg, 10 * deg, 0.1, 0.06)), 'red');
  for (const s of [1, -1]) {
    add('fwEndplate', plate([[2.8, 0.035], [2.38, 0.035], [2.33, 0.08], [2.33, 0.26], [2.46, 0.29], [2.62, 0.2], [2.8, 0.1]], 0.95 * s, 0.01), 'navy');
    add('fwFoot', plate([[2.8, 0.03], [2.4, 0.03], [2.4, 0.06], [2.8, 0.06]], 0.95 * s, 0.012), 'red');
    add('fwPylon', plate([[2.6, 0.08], [2.36, 0.08], [2.3, 0.18], [2.5, 0.2]], 0.075 * s, 0.01), 'carbon');
  }
  // 바닥 앞쪽 작은 날개들 (바지보드 / 플로어 펜스)
  for (const s of [1, -1]) {
    for (const [x, z0, z1, h] of [[0.66, 1.25, 0.95, 0.2], [0.72, 1.18, 0.88, 0.16], [0.78, 1.1, 0.82, 0.12]]) {
      add('fence', plate([[z0, 0.07], [z1, 0.07], [z1 + 0.05, 0.07 + h], [z0 - 0.04, 0.07 + h * 0.7]], x * s, 0.008), 'carbon');
    }
  }

  // ---------- 뒷날개 ----------
  const rw = (le, y, chord, aoa) => [-0.5, -0.25, 0, 0.25, 0.5].map((x) => ({ x, le, y: y + Math.abs(x) * 0.02, chord, aoa, thick: 0.1, camber: 0.07 }));
  add('rwMain', loftWing(rw(-2.28, 0.8, 0.3, 9 * deg)), 'wingNavy');
  add('rwFlap', loftWing(rw(-2.5, 0.94, 0.2, 32 * deg)), 'red');
  add('beamWing', loftWing([-0.42, 0, 0.42].map((x) => ({ x, le: -2.22, y: 0.4, chord: 0.2, aoa: 14 * deg, thick: 0.1, camber: 0.05 }))), 'carbon');
  for (const s of [1, -1]) {
    add('rwEndplate', plate([[-2.24, 0.66], [-2.62, 0.66], [-2.68, 0.74], [-2.68, 1.04], [-2.46, 1.06], [-2.26, 1.0], [-2.22, 0.84]], 0.515 * s, 0.012), 'carbon');
    add('rwEndTrim', plate([[-2.3, 1.0], [-2.68, 1.035], [-2.68, 1.05], [-2.46, 1.065], [-2.28, 1.015]], 0.517 * s, 0.014), 'red');
  }
  add('swanNeck', plate([[-1.95, 0.38], [-2.15, 0.38], [-2.32, 0.78], [-2.2, 0.82]], 0, 0.02), 'carbon');
  // 엔진 커버 핀
  add('fin', plate([[-0.62, 0.92], [-1.55, 0.78], [-1.55, 0.6], [-0.95, 0.76]], 0, 0.01), 'navy');

  return parts;
}

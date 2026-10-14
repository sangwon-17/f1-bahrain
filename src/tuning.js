import GUI from 'lil-gui';
import { CAR, STEER, GUARD, CAMERA } from './config.js';
import { buildSafeSpeed } from './guard.js';

// 화면 오른쪽 위 '주행 설정' 패널: 슬라이더로 값을 바꾸면 바로 적용돼요 (G 키로 열고 닫기)
// 바꾼 값은 이 브라우저에 저장돼요. '기본값으로 되돌리기'로 처음 값으로 돌아가요.

const KEY = 'f1-bahrain-tuning-v1';
const GROUPS = { CAR, STEER, GUARD, CAMERA };
const DEFAULTS = JSON.parse(JSON.stringify(GROUPS));

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return;
    for (const g in saved) for (const k in saved[g]) {
      if (GROUPS[g] && typeof DEFAULTS[g][k] === typeof saved[g][k]) GROUPS[g][k] = saved[g][k];
    }
  } catch { /* 저장된 값이 없거나 읽을 수 없으면 기본값 */ }
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(GROUPS)); } catch { /* 저장 불가 환경 */ } };

/** 예상 최고속도 (km/h): 구동력 = 공기저항이 되는 속도 */
function topSpeed(open) {
  const net = (u) => Math.min(CAR.power / u, CAR.launchForce + CAR.launchForcePerMs * u) - (0.6 * CAR.dragArea * (1 - 0.2 * open) * u * u + 170);
  let lo = 1, hi = 200;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (net(mid) > 0) lo = mid; else hi = mid; }
  return `${Math.round(lo * 3.6)} km/h`;
}

export function createTuning(guard) {
  load();
  guard.safe = buildSafeSpeed(guard.track);
  const gui = new GUI({ title: '⚙ 주행 설정 (G 키)' });
  gui.domElement.style.top = '130px';
  gui.close();
  const info = { drs: '', closed: '' };
  const refresh = () => {
    info.drs = topSpeed(1);
    info.closed = topSpeed(0);
    guard.safe = buildSafeSpeed(guard.track);
    save();
  };
  refresh();
  const done = () => document.activeElement?.blur?.(); // 슬라이더를 놓으면 방향키가 다시 운전에 쓰이게
  const add = (folder, obj, key, min, max, step, name) => folder.add(obj, key, min, max, step).name(name).onChange(refresh).onFinishChange(done);

  const speed = gui.addFolder('속도 · 가속');
  add(speed, CAR, 'power', 300e3, 1.2e6, 5e3, '엔진 출력 (최고속도)');
  add(speed, CAR, 'launchForce', 1000, 10000, 100, '출발 가속');
  add(speed, CAR, 'launchForcePerMs', 0, 200, 5, '가속 한도 (속도당 증가)');
  add(speed, CAR, 'dragArea', 1, 3, 0.05, '공기저항');
  speed.add(info, 'drs').name('예상 최고속도 (DRS)').listen().disable();
  speed.add(info, 'closed').name('예상 최고속도 (DRS 닫힘)').listen().disable();

  const grip = gui.addFolder('접지 · 코너');
  add(grip, CAR, 'mu', 1, 2.5, 0.05, '타이어 접지력');
  add(grip, CAR, 'liftArea', 0, 6, 0.1, '다운포스');
  add(grip, CAR, 'cornerAssist', 1, 2, 0.05, '코너링 보조 (차 돌려주기)');

  const steer = gui.addFolder('핸들');
  add(steer, STEER, 'straightSlowDeg', 2, 20, 0.5, '저속 최대 각도 (°)');
  add(steer, STEER, 'straightMaxG', 0.5, 3, 0.1, '고속 직선 민감도 (옆 G)');
  add(steer, STEER, 'cornerDeg', 4, 25, 0.5, '코너 구간 최대 각도 (°)');

  const assist = gui.addFolder('코너 보조');
  assist.add(GUARD, 'on').name('이탈 방지 핸들 보조').onChange(refresh);
  add(assist, GUARD, 'strength', 0, 4, 0.1, '핸들 보조 세기');
  assist.add(GUARD, 'speedOn').name('코너 속도 자동 조절').onChange(refresh);
  add(assist, GUARD, 'speedGrip', 0.6, 1.4, 0.01, '코너 한계 속도 (낮을수록 일찍 감속)');
  add(assist, GUARD, 'speedMaxBrake', 0, 1, 0.05, '자동 브레이크 최대');

  const cam = gui.addFolder('카메라');
  add(cam, CAMERA, 'chaseFov', 40, 100, 1, '3인칭 시야각');
  add(cam, CAMERA, 'cockpitFov', 50, 110, 1, '운전석 시야각');

  gui.add({
    reset() {
      for (const g in DEFAULTS) Object.assign(GROUPS[g], DEFAULTS[g]);
      refresh();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  }, 'reset').name('기본값으로 되돌리기');

  let shown = true;
  return { toggle() { shown = !shown; gui.show(shown); } };
}

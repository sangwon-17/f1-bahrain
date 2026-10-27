// 게임 전체에서 쓰는 설정값 — 숫자를 바꾸면 느낌을 조절할 수 있어요

export const TRACK = {
  step: 2,            // 중심선 점 간격 (m)
  width: 15,          // 트랙 폭
  kerbWidth: 1.6,     // 연석 폭
  shoulder: 2.5,      // 연석 바깥 아스팔트 (직선 구간)
  runoff: 11,         // 코너 바깥쪽 아스팔트 런오프 최대 폭
  wallOffset: 24,     // 중심선에서 방호벽까지 최대 거리
  carHalfWidth: 1.0,
};

export const PIT = {
  startD: -420,       // 출발선 기준 피트 입구 위치 (m, 음수 = 출발선 전)
  endD: 420,          // 피트 출구 합류 위치
  rampIn: 130,        // 입구에서 피트레인으로 옮겨 가는 거리
  rampOut: 150,
  laneOffset: 22,     // 트랙 중심선에서 피트레인 중심까지 (오른쪽)
  laneWidth: 12,
  wallStart: -260,    // 피트월(트랙과 피트레인 사이 벽) 구간
  wallEnd: 260,
  boxD: -30,          // 우리 팀 차고 위치
  limiter: 80 / 3.6,  // 피트레인 제한 속도 (80 km/h)
};

export const CAR = {
  length: 5.6,        // F1 차량 길이
  mass: 798,          // F1 최소 무게 (드라이버 포함)
  inertia: 1250,
  cgToFront: 1.75,    // 무게 배분 약 45:55 (뒤쪽이 더 무거워요)
  cgToRear: 1.45,
  halfTrack: 0.8,
  power: 655e3,       // 엔진 출력 (약 880마력) — 최고속도: DRS 열면 ≈ 320 km/h, 닫으면 ≈ 298 km/h
  dragArea: 1.9,      // 공기저항
  launchForce: 3200,  // 저속 최대 구동력 (N) — 클수록 출발이 세요 (0→100 약 7초)
  launchForcePerMs: 60, // 속도 1 m/s당 늘어나는 구동력 한도 (고속 최고속도는 그대로 유지)
  liftArea: 3.2,      // F1의 강한 다운포스
  aeroFront: 0.45,
  mu: 1.8,            // 슬릭 타이어 접지력
  maxBrake: 50000,    // 최대 제동력 (약 6G)
  brakeGrip: 1.6,
  traction: 1.8,      // 출발 가속 한계 (높을수록 확 튀어나가요)
  cornerAssist: 1.3,  // 코너링 보조: 핸들을 꺾은 만큼 차가 돌도록 도와줘요 (1 = 보조 없음, AI 차와 같은 코너 속도)
  assistRate: 6,      // 보조가 차를 돌려주는 빠르기     // 출발 가속 한계 (높을수록 확 튀어나가요)
  wheelRadius: 0.36,
};

// 핸들 — Roblox A-Chassis 방식 (Roblox F1 게임들이 쓰는 차량 엔진)
// 키를 누르면 일정한 빠르기로 꺾이고, 최대 각도는 '속도'로만 정해져요 (직선/코너 구분 없음)
// 최대 각도 = maxDeg × (1 − 속도/decayKmh), 단 maxDeg × minSteer 밑으로는 안 내려가요
export const STEER = {
  maxDeg: 30,           // 멈춰 있을 때 최대 각도 (A-Chassis SteerInner/SteerOuter)
  steerSpeed: 3,        // 꺾는 빠르기 (초당, 1 = 끝까지) — A-Chassis SteerSpeed 0.05 × 60틱
  returnSpeed: 6,       // 가운데로 돌아오는 빠르기 (손을 떼거나 반대로 꺾을 때) — ReturnSpeed 0.1 × 60틱
  decayKmh: 293,        // 이 속도에 가까워질수록 각도가 일정하게 줄어요 — SteerDecay 320 stud/s
  minSteer: 0.05,       // 아무리 빨라도 최대 각도의 이만큼은 남아요 (A-Chassis 기본 10%, F1 300 km/h 직선용으로 5%)
  driftExtraDeg: 6,     // 드리프트(Space) 중 추가 각도 — 카운터스티어용
};

// 스페이스바 드리프트
export const DRIFT = {
  rearGrip: 0.55,     // 드리프트 중 뒷바퀴 접지력 (1 = 평소)
  maxAngle: 0.55,     // 최대 미끄러짐 각도 (rad, 약 31°) — 이 이상은 스핀 안 하게 잡아줘요
  yawBoost: 1.6,      // 차가 더 많이 돌아가게
  speedLoss: 2.5,     // 드리프트 중 초당 최대 속도 손실 (m/s) — 브레이크 안 밟을 때
  blendIn: 3.0,       // 드리프트로 들어가는 속도 (클수록 빨리)
  blendOut: 2.0,      // 드리프트에서 빠져나오는 속도 (작을수록 부드럽게)
};

// 코너 이탈 방지: 코너 구간에서만 트랙 밖으로 나가려 하면 핸들을 살짝 대신 꺾어 줘요 (직선에선 꺼져요)
// 너무 빠르면 막지 않고 그대로 밀려나가요
export const GUARD = {
  on: true,           // false로 바꾸면 완전히 꺼져요
  aheadM: 40,         // 코너 몇 m 전부터 켜질지 (코너가 끝나면 바로 꺼져요)
  cornerFrom: 0.15,   // 코너 정도(0~1)가 이 값부터 보조가 켜지기 시작해요 (낮출수록 완만한 구간에서도 작동)
  cornerFull: 0.4,    // 이 값 이상이면 보조가 100%
  margin: 0.3,        // 보조가 목표로 하는 한계: 연석 바깥 끝에서 이만큼(m) 안쪽 (클수록 트랙 안쪽으로 붙잡아요)
  letGo: 1.5,         // 그 한계를 이만큼(m) 넘게 밀려나가면 보조를 놓아요 (트랙에 돌아오면 다시 켜져요)
  lookahead: 0.8,     // 몇 초 뒤 위치를 미리 보고 고칠지 (클수록 일찍, 부드럽게 잡아요)
  strength: 2,        // 대신 꺾어주는 세기 (클수록 많이 꺾어줘요)
  maxSteer: 1.0,      // 대신 꺾어주는 최대량 (1 = 방향키를 끝까지 누른 만큼)
  smooth: 5,          // 꺾어주는 양이 바뀌는 빠르기 (작을수록 부드럽고 티가 덜 나요)
  // 코너 속도 보조: 코너에 너무 빨리 들어가면 액셀을 풀고 브레이크를 살짝 대신 밟아줘요
  speedOn: false,     // true로 바꾸면 켜져요 (2026-10-27 사용자 요청으로 끔)
  speedGrip: 0.95,    // 코너 한계 속도 계산용 접지력 비율 (낮출수록 더 일찍, 더 많이 줄여요)
  speedBrake: 26,     // 코너 앞에서 속도를 줄이는 세기 (m/s², 작을수록 더 일찍 부드럽게 줄여요)
  speedBand: 6,       // 한계 속도보다 이만큼(m/s) 빠르면 최대로 브레이크
  speedMaxBrake: 0.7, // 대신 밟아주는 브레이크 최대량 (1 = 끝까지)
};

// 카메라 시야각 (속도와 상관없이 고정)
export const CAMERA = {
  chaseFov: 58,       // 3인칭
  cockpitFov: 78,     // 운전석
};

export const TYRE = {
  wearPerLap: 0.18,   // 보통으로 달리면 한 바퀴에 약 18% 닳아요
  gripLossAtFull: 0.3,
  radioAt: [0.5, 0.7, 0.85],
};

export const GEARS = [0, 23, 34, 45, 56, 67, 78, 88, 98]; // F1 8단 (각 기어 최고 속도 m/s)

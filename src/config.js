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
  length: 5.3,        // 1970년식 머슬카 길이
  mass: 1750,         // F1(798kg)보다 두 배 이상 무거워요
  inertia: 3300,
  cgToFront: 1.42,    // 휠베이스 2.97m
  cgToRear: 1.55,
  halfTrack: 0.8,
  power: 626e3,       // 약 840마력
  dragArea: 1.45,     // 최고속도 ≈ 320 km/h
  liftArea: 1.1,      // 트렁크 스포일러 정도의 약한 다운포스
  aeroFront: 0.5,
  mu: 1.6,            // 타이어 접지력 (높을수록 브레이크·코너가 강해요)
  maxBrake: 80000,    // 최대 제동력
  brakeGrip: 2.1,     // 브레이크는 타이어 한계보다 이만큼 더 세게 (게임용)
  wheelRadius: 0.355,
  maxSteer: 0.62,     // 저속 최대 핸들 각도 (rad, 약 36°)
  minSteer: 0.07,     // 고속에서 최소로 남는 핸들 각도
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

export const TYRE = {
  wearPerLap: 0.18,   // 보통으로 달리면 한 바퀴에 약 18% 닳아요
  gripLossAtFull: 0.3,
  radioAt: [0.5, 0.7, 0.85],
};

export const GEARS = [0, 24, 38, 52, 66, 80, 95]; // 6단 수동 느낌 (각 기어 최고 속도 m/s)

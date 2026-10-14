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
  power: 1.2e6,       // 엔진 출력 (게임용으로 강하게, 약 1,600마력) — 클수록 액셀이 세요
  dragArea: 1.9,      // 공기저항 — 최고속도 ≈ 365 km/h
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

// 핸들 최대 각도 (도, 방향키를 끝까지 눌렀을 때 앞바퀴 기준) — 숫자를 바꿔서 느낌을 조절해요
export const STEER = {
  straightSlowDeg: 8,   // 직선, 60 km/h 이하
  straightFastDeg: 1,   // 직선, 250 km/h 이상 (그 사이 속도는 자연스럽게 이어져요)
  cornerDeg: 12,        // 코너 구간 (속도와 상관없이 같아요)
  parkingDeg: 30,       // 거의 멈췄을 때 (15 km/h 이하, 40 km/h까지 점점 줄어요) — 유턴·피트·사고 후 탈출용
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
};

export const TYRE = {
  wearPerLap: 0.18,   // 보통으로 달리면 한 바퀴에 약 18% 닳아요
  gripLossAtFull: 0.3,
  radioAt: [0.5, 0.7, 0.85],
};

export const GEARS = [0, 23, 34, 45, 56, 67, 78, 88, 98]; // F1 8단 (각 기어 최고 속도 m/s)

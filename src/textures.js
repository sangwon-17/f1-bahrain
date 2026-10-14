import * as THREE from 'three';

// 그림 파일 없이 캔버스에 직접 그려서 텍스처를 만들어요

let maxAniso = 8;
export function setMaxAnisotropy(v) { maxAniso = v; }

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function toTexture(canvas, { color = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

const rand = (a, b) => a + Math.random() * (b - a);

// 아스팔트 알갱이 (밝고 어두운 작은 점)
function grain(g, w, h, count, lo, hi, alpha) {
  for (let i = 0; i < count; i++) {
    const v = rand(lo, hi) | 0;
    g.fillStyle = `rgba(${v},${v},${v + 3},${alpha})`;
    const s = Math.random() < 0.85 ? 1 : 2;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

// 큰 얼룩 (넓은 범위의 색 차이)
function blotches(g, w, h, count, rMin, rMax, colorFn) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = rand(rMin, rMax);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colorFn());
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** 트랙 아스팔트: u = 트랙 폭 방향(0~1), v = 진행 방향 (한 장 = 20m) */
export function makeAsphalt(trackWidth) {
  const W = 1024, H = 1024;
  const pxPerM = W / trackWidth;
  const base = makeCanvas(W, H, (g) => {
    g.fillStyle = '#34353a';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, 60, 40, 160, () => `rgba(${Math.random() < 0.5 ? '20,20,24' : '70,70,76'},0.18)`);
    // 차들이 많이 달린 라인 — 고무가 묻어 살짝 어두워요
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0.2, 'rgba(0,0,0,0)');
    grad.addColorStop(0.42, 'rgba(10,10,12,0.22)');
    grad.addColorStop(0.58, 'rgba(10,10,12,0.22)');
    grad.addColorStop(0.8, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    grain(g, W, H, 140000, 20, 90, 0.55);
    // 가장자리 흰 선 (트랙 경계)
    g.fillStyle = '#e9e6df';
    const lw = 0.22 * pxPerM;
    g.fillRect(0.12 * pxPerM, 0, lw, H);
    g.fillRect(W - 0.12 * pxPerM - lw, 0, lw, H);
    grain(g, W, H, 8000, 0, 60, 0.25);
  });
  // 울퉁불퉁한 표면 느낌 + 반사 차이
  const bump = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    grain(g, w, h, 90000, 40, 220, 0.8);
  });
  const rough = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 40, 30, 120, () => `rgba(${Math.random() < 0.5 ? '150,150,150' : '255,255,255'},0.35)`);
    grain(g, w, h, 30000, 120, 255, 0.6);
  });
  return {
    map: toTexture(base),
    bumpMap: toTexture(bump, { color: false }),
    roughnessMap: toTexture(rough, { color: false }),
  };
}

/** 런오프/피트레인용 밝은 아스팔트 (한 장 = 12m x 12m) */
export function makeRunoff() {
  const c = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4b50';
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 30, 30, 120, () => 'rgba(30,30,34,0.2)');
    grain(g, w, h, 50000, 40, 120, 0.5);
  });
  return toTexture(c);
}

/** 빨강/흰색 연석 — v 방향으로 한 장 = 2.5m */
export function makeKerb() {
  const c = makeCanvas(128, 256, (g, w, h) => {
    g.fillStyle = '#c8102e';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f1efe9';
    g.fillRect(0, h / 2, w, h / 2);
    // 경계에 살짝 그림자 + 마모
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, h / 2 - 2, w, 4);
    g.fillRect(0, h - 2, w, 2);
    grain(g, w, h, 3000, 0, 80, 0.12);
  });
  return toTexture(c);
}

/** 사막 모래 (밤) */
export function makeSand() {
  const c = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#7a6347';
    g.fillRect(0, 0, w, h);
    blotches(g, w, h, 80, 20, 90, () => (Math.random() < 0.5 ? 'rgba(60,45,30,0.3)' : 'rgba(150,120,85,0.25)'));
    for (let i = 0; i < 60000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? `rgba(50,38,25,${v})` : `rgba(190,160,120,${(v - 0.5) * 0.6})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  });
  return toTexture(c);
}

/** 방호벽 광고판 — 한 장 = 48m. 실제 브랜드 대신 일반 문구만 써요 */
export function makeWall() {
  const words = ['SAKHIR', 'DESERT GP', 'BAHRAIN', 'FULL THROTTLE', 'APEX', 'GRAND PRIX'];
  const c = makeCanvas(2048, 64, (g, w, h) => {
    const n = 6;
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const x = i * pw;
      const dark = i % 2 === 0;
      g.fillStyle = dark ? '#121a33' : '#e8e6e1';
      g.fillRect(x, 0, pw, h);
      g.fillStyle = dark ? '#d61f3a' : '#121a33';
      g.fillRect(x, h - 8, pw, 8);
      g.font = 'bold 34px "Titillium Web", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = dark ? '#ffcc00' : '#121a33';
      g.fillText(words[i], x + pw / 2, h / 2 - 2);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, 0, 2, h);
    }
    grain(g, w, h, 6000, 0, 255, 0.05);
  });
  return toTexture(c);
}

/** 방호벽 위 철망 (투명) */
export function makeFence() {
  const c = makeCanvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(190,195,200,0.9)';
    g.lineWidth = 1.2;
    const s = 16;
    for (let i = -h; i < w + h; i += s) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
    }
    g.fillStyle = 'rgba(120,125,130,1)';
    g.fillRect(0, 0, 6, h);     // 기둥
    g.fillRect(0, 0, w, 4);     // 위쪽 줄
    g.fillRect(0, h - 4, w, 4);
  });
  return toTexture(c);
}

/** 관중석 관중 */
export function makeCrowd() {
  const c = makeCanvas(512, 128, (g, w, h) => {
    g.fillStyle = '#1b1d24';
    g.fillRect(0, 0, w, h);
    const colors = ['#e8e8e8', '#c8102e', '#1e3a8a', '#ffcc00', '#2a2a2a', '#d97706', '#0f766e', '#f5d0b0', '#6b3f2a'];
    for (let y = 6; y < h; y += 12) {
      for (let x = 3; x < w; x += 7) {
        if (Math.random() < 0.12) continue;
        g.fillStyle = colors[(Math.random() * colors.length) | 0];
        g.fillRect(x + rand(-1, 1), y + rand(-1, 1), 4, 7);
        g.fillStyle = Math.random() < 0.7 ? '#c89a78' : '#5a3a28';
        g.fillRect(x + 0.5 + rand(-1, 1), y - 3, 3, 3);
      }
    }
  });
  return toTexture(c);
}

/** 차고 내부 (밝게 빛나는 차고 입구) */
export function makeGarage(team) {
  const c = makeCanvas(256, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, team ? '#2a3770' : '#3a3d45');
    grad.addColorStop(1, team ? '#121a33' : '#202228');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let x = 20; x < w; x += 54) g.fillRect(x, 6, 34, 4); // 천장 조명
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 6; i++) g.fillRect(rand(10, w - 40), rand(50, h - 30), rand(15, 40), rand(20, 50));
    if (team) {
      g.fillStyle = '#ffcc00';
      g.fillRect(0, h - 10, w, 4);
      g.fillStyle = '#d61f3a';
      g.fillRect(0, h - 6, w, 6);
    }
  });
  return toTexture(c, { repeat: false });
}

/** 밤하늘 (배경용 360도 그림) — 도시 불빛 때문에 별은 적고 희미해요 */
export function makeNightSky() {
  const c = makeCanvas(4096, 2048, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#020308');
    grad.addColorStop(0.3, '#05070f');
    grad.addColorStop(0.44, '#0d0f1c');
    grad.addColorStop(0.485, '#23202a');
    grad.addColorStop(0.5, '#3a2c26');
    grad.addColorStop(0.51, '#15110f');
    grad.addColorStop(1, '#060504');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const y = Math.pow(Math.random(), 1.4) * h * 0.42;
      g.fillStyle = `rgba(220,225,255,${rand(0.08, 0.45) * (1 - y / (h * 0.45))})`;
      g.fillRect(Math.random() * w, y, 1, 1);
    }
    // 지평선의 도시 불빛 (주황빛 점들)
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(255,${(rand(150, 210)) | 0},120,${rand(0.15, 0.6)})`;
      g.fillRect(Math.random() * w, h * 0.5 - rand(0, 5), rand(1, 2), 1);
    }
  });
  const t = toTexture(c, { repeat: false });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** 부드러운 원 (연기, 빛 번짐용) */
export function makeSoftDot() {
  const c = makeCanvas(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  return toTexture(c, { repeat: false });
}

/** 출발선 / 그리드 칸 같은 흰색 페인트 */
export function makeCheckered() {
  const c = makeCanvas(256, 32, (g, w, h) => {
    const s = 16;
    for (let x = 0; x < w; x += s) for (let y = 0; y < h; y += s) {
      g.fillStyle = ((x + y) / s) % 2 === 0 ? '#f2f2f2' : '#111';
      g.fillRect(x, y, s, s);
    }
  });
  return toTexture(c, { repeat: false });
}

/** 브레이킹 거리 표지판 (300/200/100) */
export function makeBoard(label) {
  const c = makeCanvas(128, 160, (g, w, h) => {
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#111';
    g.font = 'bold 64px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2 + 4);
  });
  return toTexture(c, { repeat: false });
}

/** 연석 홈 (노멀맵): 진행 방향으로 촘촘한 홈이 있어요 */
export function makeKerbNormal() {
  const c = makeCanvas(64, 256, (g, w, h) => {
    const ridges = 20; // 한 장(2.5m)에 홈 20개
    for (let y = 0; y < h; y++) {
      const t = (y / h) * ridges;
      const slope = Math.cos(t * Math.PI * 2); // 홈의 경사
      const ny = Math.round(128 + slope * 70);
      g.fillStyle = `rgb(128,${ny},${Math.round(255 - Math.abs(slope) * 30)})`;
      g.fillRect(0, y, w, 1);
    }
  });
  return toTexture(c, { color: false });
}

/** 연석 바깥 초록 페인트 */
export function makeGreenPaint() {
  const c = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#2c6a3f';
    g.fillRect(0, 0, w, h);
    grain(g, w, h, 20000, 0, 90, 0.18);
    blotches(g, w, h, 20, 20, 60, () => 'rgba(0,0,0,0.12)');
  });
  return toTexture(c);
}

/** TecPro 충격흡수 블록 덮개 (색은 블록마다 따로 입혀요) */
export function makeTecpro() {
  const c = makeCanvas(128, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, 3, h);
    g.fillRect(w - 3, 0, 3, h);
    g.fillRect(0, h * 0.48, w, 2);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 6; i++) g.fillRect(rand(10, w - 30), rand(10, h - 30), rand(10, 20), 3);
    grain(g, w, h, 3000, 120, 255, 0.08);
  });
  return toTexture(c);
}

/** 낮 하늘 (사막의 맑은 하늘, 지평선은 뿌옇게) */
export function makeDaySky() {
  const c = makeCanvas(2048, 1024, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2f6fc4');
    grad.addColorStop(0.28, '#5b98dc');
    grad.addColorStop(0.42, '#9cc3e6');
    grad.addColorStop(0.49, '#dfdacb');
    grad.addColorStop(0.5, '#e8dcc4');
    grad.addColorStop(0.53, '#cdb894');
    grad.addColorStop(1, '#b49c78');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // 옅은 구름
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = h * (0.12 + Math.random() * 0.3), r = rand(30, 120);
      const cg = g.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, 'rgba(255,255,255,0.22)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg;
      g.save();
      g.translate(x, y);
      g.scale(2.6, 0.5);
      g.translate(-x, -y);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
  });
  const t = toTexture(c, { repeat: false });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** 야자수 잎 (투명 배경) */
export function makePalmLeaf() {
  const c = makeCanvas(128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#5b6b2e';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    for (let y = 20; y < h - 10; y += 9) {
      const len = (w / 2 - 4) * Math.sin((y / h) * Math.PI) ** 0.6;
      const shade = 70 + Math.random() * 40;
      g.strokeStyle = `rgb(${shade * 0.6 | 0},${shade + 40 | 0},${shade * 0.35 | 0})`;
      g.lineWidth = 4;
      for (const s of [1, -1]) {
        g.beginPath();
        g.moveTo(w / 2, y);
        g.quadraticCurveTo(w / 2 + s * len * 0.6, y - 6, w / 2 + s * len, y + 14);
        g.stroke();
      }
    }
  });
  return toTexture(c, { repeat: false });
}

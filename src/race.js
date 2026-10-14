import * as THREE from 'three';
import { buildProceduralCar, isLiveryTex } from './car.js';
import { CAR } from './config.js';

// 다른 플레이어의 차를 그려요 (위치는 받은 정보 사이를 부드럽게 이어서)

export const RACE_LAPS = 3;

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function nameTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.position.y = 1.9;
  let last = '';
  return {
    sprite,
    set(text, color) {
      if (text === last) return;
      last = text;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      g.font = '700 54px "Titillium Web", "Noto Sans KR", sans-serif';
      const w = Math.min(500, g.measureText(text).width + 60);
      g.fillStyle = 'rgba(10,12,22,0.75)';
      g.beginPath();
      g.roundRect(256 - w / 2, 20, w, 88, 20);
      g.fill();
      g.fillStyle = color;
      g.fillRect(256 - w / 2 + 18, 46, 10, 36);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256 + 10, 66);
      tex.needsUpdate = true;
    },
  };
}

/** F1 차 색 바꾸기: 리버리(무늬)와 남색 부분에 팀 색을 입혀요 */
export function tintCar(car, paint) {
  const tint = new THREE.Color(paint), seen = new Set();
  car.root.traverse((o) => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (seen.has(m) || !m.color) return;
      seen.add(m);
      if (isLiveryTex(m.map)) m.color.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.25);
      else if (m.color.getHexString() === '16224f') m.color.copy(tint).multiplyScalar(0.45);
    });
  });
}

const COLORS = ['#ffcc00', '#19d3ff', '#ff5a6e', '#a3e635', '#c084fc', '#fb923c'];
const PAINTS = [0x0b0b0d, 0x8a0f14, 0x123a7a, 0xd27a12, 0x1f5a2e, 0xb8b8bc];

export class RemoteCars {
  constructor(net, scene, envMap) {
    this.net = net;
    this.scene = scene;
    this.envMap = envMap;
    this.cars = new Map(); // peer → { car, tag, pos, yaw, target, recvAt }
  }

  colorFor(index) { return COLORS[index % COLORS.length]; }

  /** 부딪힘 계산용: 다른 차들의 위치, 방향, 속도 */
  obstacles() {
    const out = [];
    for (const [peer, r] of this.cars) {
      const p = this.net.peers.find((q) => q.peer === peer);
      const c = p && p.presence && p.presence.c;
      if (Array.isArray(c)) out.push({ x: r.x, z: r.z, yaw: r.yaw, vx: c[3], vz: c[4] });
    }
    return out;
  }

  update(dt, labelFor) {
    const seen = new Set();
    this.net.peers.forEach((peer, i) => {
      const c = peer.presence && peer.presence.c;
      if (!Array.isArray(c) || c.length < 7 || !c.every((v) => typeof v === 'number' && isFinite(v))) return;
      seen.add(peer.peer);
      let r = this.cars.get(peer.peer);
      if (!r) {
        const car = buildProceduralCar(this.envMap);
        tintCar(car, PAINTS[(i + 1) % PAINTS.length]);
        car.driverParts.forEach((p) => { p.visible = true; });
        const tag = nameTag();
        car.root.add(tag.sprite);
        this.scene.add(car.root);
        r = { car, tag, x: c[0], z: c[1], yaw: c[2], recv: null, spin: 0 };
        this.cars.set(peer.peer, r);
      }
      // 새 정보가 오면 받은 시각을 기억해요
      if (r.recv !== peer.presence) {
        r.recv = peer.presence;
        r.recvAt = performance.now();
      }
      const age = Math.min(0.25, (performance.now() - r.recvAt) / 1000);
      const [x, z, yaw, vx, vz, steer, speed] = c;
      // 마지막 위치 + 속도 × 지난 시간으로 지금 위치를 예측하고, 부드럽게 따라가요
      const tx = x + vx * age, tz = z + vz * age;
      const k = 1 - Math.exp(-14 * dt);
      if (Math.hypot(tx - r.x, tz - r.z) > 30) { r.x = tx; r.z = tz; r.yaw = yaw; }
      r.x += (tx - r.x) * k;
      r.z += (tz - r.z) * k;
      r.yaw += wrapAngle(yaw - r.yaw) * k;
      r.spin += (speed / CAR.wheelRadius) * dt;
      const { car } = r;
      car.root.position.set(r.x, 0, r.z);
      car.root.rotation.y = r.yaw;
      car.wheels.forEach((w, wi) => {
        if (wi < 2) w.pivot.rotation.y = steer;
        w.spin.rotation.x = r.spin;
      });
      car.setBrake?.(c[7] || 0);
      r.tag.set(labelFor(peer, i), this.colorFor(i + 1));
    });
    // 나간 사람의 차는 치워요
    for (const [peer, r] of this.cars) {
      if (seen.has(peer)) continue;
      this.scene.remove(r.car.root);
      r.car.root.traverse((o) => {
        if (o.isMesh || o.isSprite) {
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
        }
      });
      this.cars.delete(peer);
    }
  }
}

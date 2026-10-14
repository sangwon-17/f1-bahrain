import * as THREE from 'three';
import { CAMERA } from './config.js';

// 카메라 3종: 'chase'(차 뒤 3인칭), 'cockpit'(운전석 1인칭), 'pit'(피트스탑 연출, 자동)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.override = null; // 'pit' 일 때 연출 카메라
    this.camYaw = 0;
    this.shake = 0;
    this.pitAngle = 0;
    this.eye = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
  }

  get active() { return this.override || this.mode; }

  snap(phys) {
    this.camYaw = phys.yaw;
  }

  addShake(v) { this.shake = Math.min(1.5, this.shake + v); }

  /**
   * phys: CarPhysics, car: 차 모델, fx: { kerb, sand, speed }
   */
  update(dt, phys, car, fx) {
    const cam = this.camera;
    const speed = phys.speed;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    // 가속감: 액셀을 밟으면 카메라가 뒤로 밀리고 화면이 넓어져요
    this.kick = (this.kick || 0) + (clamp(phys.ax / 12, -1, 1) - (this.kick || 0)) * Math.min(1, dt * 5);
    const kmh = speed * 3.6;
    const jitter = (amt) => (Math.random() - 0.5) * amt;
    const rumble = fx.kerb * clamp(speed / 30, 0.3, 1) + fx.sand * clamp(speed / 20, 0.2, 1) * 1.5;

    car.driverParts.forEach((p) => { p.visible = this.active !== 'cockpit'; });

    if (this.active === 'cockpit') {
      cam.near = 0.03;
      cam.fov = CAMERA.cockpitFov; // 속도와 상관없이 같은 시야
      car.root.updateMatrixWorld(true); // 이번 프레임 차 위치로 (안 하면 빠를 때 눈이 차 안쪽 뒤로 밀려 앞이 가려져요)
      this.eye.copy(car.eye).applyMatrix4(car.body.matrixWorld);
      // 머리가 G-force에 따라 살짝 쏠리고, 연석에서 덜컹거려요
      // 머리 기울기는 아주 살짝만 (가속하면 살짝 위, 브레이크 땐 살짝 아래)
      const headRoll = clamp(-phys.ay * 0.0015, -0.03, 0.03);
      this.headPitch = (this.headPitch || 0) + (clamp(phys.ax * 0.0006, -0.015, 0.012) - (this.headPitch || 0)) * Math.min(1, dt * 4);
      const headPitch = this.headPitch;
      const shake = rumble * 0.01 + this.shake * 0.02 + Math.max(0, speed - 40) * 0.00004;
      this.eye.x += jitter(shake);
      this.eye.y += jitter(shake) + Math.sin(performance.now() * 0.05) * rumble * 0.004;
      cam.position.copy(this.eye);
      this.euler.set(-0.075 + headPitch + jitter(shake * 0.6), phys.yaw + Math.PI + car.body.rotation.y, headRoll + car.body.rotation.z * 0.6 + jitter(shake * 0.5));
      cam.quaternion.setFromEuler(this.euler);
    } else if (this.active === 'show') {
      // 개발용 정지 카메라 (차 주변 고정 각도)
      cam.near = 0.05;
      cam.fov = 40;
      const a = phys.yaw + this.showAngle;
      cam.position.set(phys.x + Math.sin(a) * this.showDist, this.showHeight, phys.z + Math.cos(a) * this.showDist);
      this.look.set(phys.x, 0.45, phys.z);
      cam.lookAt(this.look);
    } else if (this.active === 'pit') {
      cam.near = 0.1;
      cam.fov = 50;
      this.pitAngle += dt * 0.16;
      const r = 8.5;
      const a = phys.yaw + 0.9 + this.pitAngle;
      cam.position.set(phys.x + Math.sin(a) * r, 2.4, phys.z + Math.cos(a) * r);
      this.look.set(phys.x, 0.55, phys.z);
      cam.lookAt(this.look);
    } else {
      cam.near = 0.1;
      // 카메라 방향은 차 방향을 살짝 늦게 따라가요 (코너에서 차 옆모습이 보이게)
      this.camYaw = phys.yaw; // 카메라가 차 바로 뒤에 고정돼요 (차가 항상 같은 모습으로 보여요)
      const ch = car.chase || { dist: 6.4, height: 1.85, look: 0.75 };
      const dist = ch.dist;
      const height = ch.height;
      const fwdX = Math.sin(this.camYaw), fwdZ = Math.cos(this.camYaw);
      cam.position.set(phys.x - fwdX * dist, height, phys.z - fwdZ * dist);
      const sh = this.shake * 0.08 + rumble * 0.02;
      cam.position.x += jitter(sh);
      cam.position.y += jitter(sh);
      this.look.set(phys.x + Math.sin(phys.yaw) * 5, ch.look, phys.z + Math.cos(phys.yaw) * 5);
      cam.lookAt(this.look);
      cam.fov = CAMERA.chaseFov; // 속도와 상관없이 같은 시야 (차 크기가 그대로)
    }
    cam.updateProjectionMatrix();
  }
}

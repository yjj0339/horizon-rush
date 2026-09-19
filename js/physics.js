import * as THREE from 'three';
import { CFG, clamp } from './config.js';

// ============ 街机车辆物理 ============
export class CarPhysics {
  constructor() {
    this.pos = new THREE.Vector3(CFG.fest.x, 0, CFG.fest.z);
    this.heading = -Math.PI / 2;          // 面向 -x（朝城市）
    this.vel = new THREE.Vector2(0, 0);   // x,z 平面速度
    this.vy = 0;
    this.airborne = false;
    this.nitro = 100;                     // 氮气量 0..100
    this.steerVis = 0;
    this.drifting = false;
    this.driftAmt = 0;                    // 0..1 漂移强度
    this.speed = 0; this.vF = 0;
    this.slopePitch = 0; this.slopeRoll = 0;
    this.lastGroundH = 0; this.groundSlope = 0;
    this.crashImpulse = 0;                // 碰撞抖动用
    this.lastOnRoad = true;
  }

  forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  update(dt, input, ground) {
    const C = CFG.car;
    const f = this.forward();
    // 分解速度
    let vF = this.vel.x * f.x + this.vel.y * f.z;
    let vLx = this.vel.x - f.x * vF, vLz = this.vel.y - f.z * vF;

    const speed = Math.hypot(this.vel.x, this.vel.y);
    const hand = input.handbrake && speed > 6;
    this.drifting = hand && Math.abs(this.steerVis) > 0.12;

    // ---- 纵向动力 ----
    const nitroOn = input.nitro && this.nitro > 0 && input.throttle > 0 && !this.airborne;
    const vmax = nitroOn ? C.nitroMax : C.maxSpeed;
    let a = 0;
    const offRoad = this.lastOnRoad ? 1 : 0.82;   // 越野动力衰减
    if (input.throttle > 0) a += (C.accel + (nitroOn ? C.nitroAccel : 0)) * input.throttle * offRoad * Math.max(0, 1 - vF / vmax);
    if (input.brake > 0) {
      if (vF > 1) a -= C.brake * input.brake;
      else a -= C.accel * 0.5 * input.brake * Math.max(0, 1 + vF / 14); // 倒车
    }
    a -= 0.0004 * vF * Math.abs(vF);                       // 风阻
    a -= Math.sign(vF) * Math.min(Math.abs(vF), this.lastOnRoad ? 0.25 : 1.6); // 滚阻（越野更大）
    if (!this.airborne) {
      // 坡度阻力
      a -= 9.8 * this.groundSlope * 0.55;
    }
    vF += a * dt;

    // ---- 侧向抓地 ----
    const grip = (hand ? C.driftGrip : C.grip) * (this.airborne ? 0.05 : 1);
    const latDecay = Math.exp(-grip * dt);
    vLx *= latDecay; vLz *= latDecay;

    // ---- 转向 ----
    const steerRange = C.steerMax / (1 + speed * 0.045);
    const steer = input.steer * steerRange;
    if (!this.airborne) {
      let yawRate = (vF / 2.9) * Math.tan(steer);
      if (hand) yawRate *= 1.5;
      const maxYaw = 2.6;
      this.heading += clamp(yawRate, -maxYaw, maxYaw) * dt;
    }
    this.steerVis += (input.steer * 0.5 - this.steerVis) * Math.min(1, 10 * dt);

    // 合成速度
    const nf = this.forward();
    this.vel.x = nf.x * vF + vLx;
    this.vel.y = nf.z * vF + vLz;
    this.speed = Math.hypot(this.vel.x, this.vel.y);
    this.vF = vF;

    // ---- 位置积分 ----
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // ---- 地面 / 空中 ----
    const g = ground(this.pos.x, this.pos.z);
    if (this.airborne) {
      this.vy -= 19 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= g.h) {
        this.pos.y = g.h;
        const impact = -this.vy;
        this.airborne = false; this.vy = 0;
        if (impact > 4) this.crashImpulse = Math.min(1, impact / 14);
        this.landedImpact = impact;
      }
    } else {
      // 坡道起跳：地面骤降且当前高度高于地面 → 离地
      const dy = this.pos.y - g.h;
      if (dy > 0.35) {
        this.airborne = true;
        this.vy = vF * this.groundSlope;  // 保留坡道末端向上的速度
      } else {
        this.pos.y = g.h;
        this.groundSlope = g.slopeAlong(nf.x, nf.z);
        this.lastOnRoad = g.onRoad !== false;
      }
    }
    // 车身姿态（贴坡）
    if (!this.airborne) {
      this.slopePitch = g.slopeAlong(nf.x, nf.z);
      const rx = -nf.z, rz = nf.x; // 右方向
      this.slopeRoll = g.slopeAlong(rx, rz);
    } else {
      this.slopePitch *= Math.exp(-2 * dt);
      this.slopeRoll *= Math.exp(-2 * dt);
    }

    // ---- 氮气 ----
    if (nitroOn) this.nitro = Math.max(0, this.nitro - 30 * dt);
    else {
      let regen = 3.5;
      if (this.drifting) regen += 14;
      if (this.airborne) regen += 8;
      this.nitro = Math.min(100, this.nitro + regen * dt);
    }

    // 漂移强度（视觉/音效用）
    const latSpeed = Math.hypot(vLx, vLz);
    const target = (this.drifting || (hand && speed > 8)) ? clamp(latSpeed / 12 + 0.35, 0, 1) : 0;
    this.driftAmt += (target - this.driftAmt) * Math.min(1, 6 * dt);
    this.nitroOn = nitroOn;
    this.latSpeed = latSpeed;
    this.crashImpulse *= Math.exp(-5 * dt);
  }
}

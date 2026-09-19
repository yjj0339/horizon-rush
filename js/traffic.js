import * as THREE from 'three';
import { CFG } from './config.js';
import { RNG } from './utils.js';

// ============ 交通流 ============
// 三类路径：环线高速（双向）、海岸公路（双向往返循环）、城市外环街区巡游
const COLORS = [0xd8dde2, 0x2a4a6a, 0xc23a2a, 0x3a3f45, 0x6a8a3a, 0xd8b02a, 0x7a4a8a, 0x9ab5c8];

export class Traffic {
  constructor(scene, sedanScene) {
    this.scene = scene;
    this.cars = [];
    const rng = RNG(555);
    const R = CFG.ring.r;

    // 高速：内道逆时针(θ增) r=612,615，外道顺时针 r=625,629
    const lanes = [
      { r: R - 8, dir: 1 }, { r: R - 13, dir: 1 },
      { r: R + 8, dir: -1 }, { r: R + 13, dir: -1 },
    ];
    for (let i = 0; i < 14; i++) {
      const lane = lanes[i % 4];
      this.spawn(sedanScene, rng, {
        type: 'ring', lane, theta: rng() * Math.PI * 2,
        speed: 21 + rng() * 14,
      });
    }
    // 海岸路：x=651 南行，x=659 北行
    for (let i = 0; i < 6; i++) {
      this.spawn(sedanScene, rng, {
        type: 'coast', x: i % 2 ? 651 : 659, dir: i % 2 ? 1 : -1,
        z: -800 + rng() * 1600, speed: 15 + rng() * 8,
      });
    }
    // 城市外环巡游（沿最外圈街道）
    const E = 330, CX = CFG.city.cx;
    const loop = [
      [CX - E, -E], [CX + E, -E], [CX + E, E], [CX - E, E],
    ];
    for (let i = 0; i < 8; i++) {
      this.spawn(sedanScene, rng, {
        type: 'city', loop, seg: (rng() * 4) | 0, t: rng(),
        speed: 9 + rng() * 5,
      });
    }
  }

  spawn(sedanScene, rng, p) {
    const grp = sedanScene.clone(true);
    const color = COLORS[(rng() * COLORS.length) | 0];
    grp.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        if (o.material && o.material.name === 'SedanPaint') {
          o.material = o.material.clone();
          o.material.color.setHex(color);
        }
      }
    });
    this.scene.add(grp);
    const wheels = [];
    grp.traverse(o => { if (/^SWheel/.test(o.name)) wheels.push(o); });
    this.cars.push({ grp, wheels, ...p, coolN: 0 });
  }

  update(dt, playerPos, onNearMiss) {
    const R = CFG.ring.r;
    for (const c of this.cars) {
      let x, z, heading;
      if (c.type === 'ring') {
        c.theta += (c.speed / c.lane.r) * dt * c.lane.dir;
        x = Math.cos(c.theta) * c.lane.r;
        z = Math.sin(c.theta) * c.lane.r;
        // 切线方向
        const tx = -Math.sin(c.theta) * c.lane.dir, tz = Math.cos(c.theta) * c.lane.dir;
        heading = Math.atan2(tx, tz);
      } else if (c.type === 'coast') {
        c.z += c.speed * dt * c.dir;
        if (c.z > 810) c.z = -810;
        if (c.z < -810) c.z = 810;
        x = c.x; z = c.z;
        heading = c.dir > 0 ? 0 : Math.PI;
      } else {
        // 城市矩形环
        const L = c.loop;
        let p0 = L[c.seg], p1 = L[(c.seg + 1) % 4];
        let segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        c.t += c.speed * dt / segLen;
        if (c.t >= 1) { c.t = 0; c.seg = (c.seg + 1) % 4; p0 = L[c.seg]; p1 = L[(c.seg + 1) % 4]; }
        x = p0[0] + (p1[0] - p0[0]) * c.t;
        z = p0[1] + (p1[1] - p0[1]) * c.t;
        heading = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
      }
      const gy = 0;
      c.grp.position.set(x, gy, z);
      c.grp.rotation.y = heading;
      c.x = x; c.z = z; c.heading = heading;
      for (const w of c.wheels) w.rotation.x += c.speed * dt / 0.32;
      // 擦身而过判定
      if (c.coolN > 0) c.coolN -= dt;
      if (playerPos && c.coolN <= 0) {
        const d = Math.hypot(playerPos.x - x, playerPos.z - z);
        if (d < 6.5 && d > 3.4) {
          const rel = Math.abs(c.speed) + 15;
          if (onNearMiss(d, rel)) c.coolN = 4;
        }
      }
    }
  }
}

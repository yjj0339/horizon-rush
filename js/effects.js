import * as THREE from 'three';
import { softDotTex } from './utils.js';

// ============ 胎痕（实例化黑色条带，环形缓冲） ============
export class SkidMarks {
  constructor(scene, max = 900) {
    this.max = max;
    this.idx = 0;
    const geo = new THREE.PlaneGeometry(0.26, 0.62);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x14161a, transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const M = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, M);
    scene.add(this.mesh);
    this.M = new THREE.Matrix4();
    this.Q = new THREE.Quaternion();
    this.S = new THREE.Vector3(1, 1, 1);
    this.V = new THREE.Vector3();
    this.lastL = null; this.lastR = null;
  }
  // 每帧尝试在左右后轮位置留痕
  lay(lx, lz, rx, rz, y, heading, strength) {
    if (strength < 0.25) { this.lastL = this.lastR = null; return; }
    for (const [x, z, key] of [[lx, lz, 'lastL'], [rx, rz, 'lastR']]) {
      const last = this[key];
      if (last && Math.hypot(x - last[0], z - last[1]) > 0.7) {
        const mx = (x + last[0]) / 2, mz = (z + last[1]) / 2;
        const ang = Math.atan2(x - last[0], z - last[1]);
        const len = Math.hypot(x - last[0], z - last[1]);
        this.Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        this.V.set(mx, y + 0.02, mz);
        this.S.set(1, 1, len / 0.62 + 0.3);
        this.M.compose(this.V, this.Q, this.S);
        this.mesh.setMatrixAt(this.idx, this.M);
        this.mesh.instanceMatrix.needsUpdate = true;
        this.idx = (this.idx + 1) % this.max;
      }
      this[key] = [x, z];
    }
  }
}

// ============ 烟雾粒子（自定义 shader，支持逐点透明度） ============
export class Smoke {
  constructor(scene, max = 320) {
    this.max = max;
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.attr = new Float32Array(max * 4);   // size, alpha, seed, 0
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(this.attr, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDotTex() } },
      transparent: true, depthWrite: false,
      vertexShader: `
        attribute vec4 aData;
        varying float vA;
        void main() {
          vA = aData.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aData.x * 320.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying float vA;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.92), t.a * vA);
          if (gl_FragColor.a < 0.01) discard;
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];   // {i, life, vx,vy,vz}
    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
  }
  emit(x, y, z, spread = 0.6, size = 1.4, life = 1.1) {
    if (!this.free.length) return;
    const i = this.free.pop();
    this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
    this.pos[i * 3 + 1] = y + 0.15;
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    this.parts.push({
      i, life, age: 0, size,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 1.2 + Math.random() * 1.4,
      vz: (Math.random() - 0.5) * 1.6,
    });
  }
  update(dt) {
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k];
      p.age += dt;
      const t = p.age / p.life;
      const i3 = p.i * 3, i4 = p.i * 4;
      if (t >= 1) {
        this.attr[i4 + 1] = 0;
        this.free.push(p.i);
        this.parts.splice(k, 1);
        continue;
      }
      this.pos[i3] += p.vx * dt;
      this.pos[i3 + 1] += p.vy * dt;
      this.pos[i3 + 2] += p.vz * dt;
      this.attr[i4] = p.size * (0.5 + t * 1.8);      // 扩散
      this.attr[i4 + 1] = 0.5 * (1 - t) * (1 - t);   // 淡出
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aData.needsUpdate = true;
  }
}

// ============ 氮气火焰 ============
export class NitroFlames {
  constructor(carGroup) {
    this.flames = [];
    const tex = softDotTex();
    for (const sx of [0.30, -0.30]) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0x55baff, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false,
      }));
      m.position.set(sx, 0.30, -2.34);
      m.scale.set(0.001, 0.001, 0.001);
      carGroup.add(m);
      this.flames.push(m);
    }
    this.on = false;
  }
  update(dt, on, speedN) {
    for (const f of this.flames) {
      if (on) {
        const s = 0.5 + Math.random() * 0.5 + speedN * 0.5;
        f.scale.set(s, s, s);
        f.material.opacity = 0.75 + Math.random() * 0.25;
      } else {
        f.scale.multiplyScalar(Math.max(0, 1 - 14 * dt));
      }
    }
  }
}

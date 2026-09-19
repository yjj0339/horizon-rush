import * as THREE from 'three';
import { CFG, clamp, lerp, smoothstep } from './config.js';
import { RNG, fbm, vnoise, canvasTex, softDotTex } from './utils.js';
import { CITY_STREETS, CITY_EXT, AVENUES, FEST_ROAD, COAST_ROAD, RING_GAPS, roadDist } from './roads.js';
import { Sky } from 'three/addons/objects/Sky.js';

// ================= 地形高度 =================
const RAMP_DEFS = [
  { x: -260, z: -430, dir: Math.PI,      w: 7, len: 13, h: 2.7 },  // 北大道
  { x: -260, z: 430,  dir: 0,            w: 7, len: 13, h: 2.7 },  // 南大道
  { x: 260,  z: 0,    dir: Math.PI / 2,  w: 7, len: 13, h: 2.7 },  // 东大道
  { x: 655,  z: 320,  dir: Math.PI,      w: 6, len: 12, h: 2.5 },  // 海岸北
  { x: 655,  z: -320, dir: 0,            w: 6, len: 12, h: 2.5 },  // 海岸南
  { x: 30,   z: 470,  dir: Math.PI / 2,  w: 8, len: 14, h: 3.0 },  // 嘉年华大跳台
];
// dir: 坡道上升方向（游戏坐标方位角，x=sin, z=cos）

// 整数网格哈希（农田色块用）
function hash2i(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 0;
  // 中心平坦，外围丘陵
  const amp = 0.25 + 0.75 * smoothstep(680, 1080, r);
  if (amp > 0.01) {
    const n = (fbm(x * 0.0016 + 3.7, z * 0.0016) - 0.5) * 16
            + (fbm(x * 0.005 + 7.3, z * 0.005 + 2.1) - 0.5) * 5;
    const rd = roadDist(x, z);
    const roadMask = smoothstep(22, 58, rd);
    h = n * amp * roadMask;
  }
  // 海滩下坡入海
  const bx = smoothstep(CFG.coast.beachX, CFG.coast.seaX, x);
  if (bx > 0) h = lerp(h, -2.4, bx);
  return h;
}

function rampHeight(x, z) {
  for (const rp of RAMP_DEFS) {
    const dx = x - rp.x, dz = z - rp.z;
    const fx = Math.sin(rp.dir), fz = Math.cos(rp.dir);
    const u = dx * fx + dz * fz;             // 沿坡方向
    const v = -dx * fz + dz * fx;            // 横向
    if (u >= 0 && u <= rp.len && Math.abs(v) <= rp.w / 2) {
      return rp.h * (u / rp.len);            // 线性坡：坡顶速度方向才能正确起跳
    }
  }
  return 0;
}

export function groundH(x, z) {
  const b = baseHeight(x, z);
  const rp = rampHeight(x, z);
  return rp > b ? rp : b;
}

export function groundInfo(x, z) {
  const h = groundH(x, z);
  const e = 1.2;
  return {
    h,
    onRoad: roadDist(x, z) < 3 && h < 0.4,
    slopeAlong(dx, dz) {
      return (groundH(x + dx * e, z + dz * e) - groundH(x - dx * e, z - dz * e)) / (2 * e);
    },
  };
}

// ================= 碰撞空间哈希 =================
export class SpatialHash {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); }
  key(x, z) { return ((x / this.cell) | 0) * 100000 + ((z / this.cell) | 0); }
  add(x, z, r, tag) {
    const k = this.key(x + 50000, z + 50000);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push({ x, z, r, tag });
  }
  query(x, z, out) {
    out.length = 0;
    const cx = ((x + 50000) / this.cell) | 0, cz = ((z + 50000) / this.cell) | 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.map.get((cx + i) * 100000 + (cz + j));
      if (arr) for (const o of arr) out.push(o);
    }
    return out;
  }
}

// ================= 世界 =================
export class World {
  constructor(scene, renderer, progress) {
    this.scene = scene;
    this.rng = RNG(20260908);
    this.poles = new SpatialHash();        // 树/路灯/广告牌柱
    this.buildings = [];                   // AABB {x1,z1,x2,z2,h}
    this.anim = [];                        // 每帧动画回调
    this.softTex = softDotTex();
    progress(0.05, '铺设大地…');
    this.buildSky(renderer);
    this.buildTerrain();
    progress(0.2, '修建道路…');
    this.buildRoads();
    progress(0.35, '建造城市…');
    this.buildCity();
    progress(0.5, '种植植被…');
    this.buildVegetation();
    this.buildLamps();
    progress(0.62, '搭建嘉年华…');
    this.buildFestival();
    this.buildRamps();
    this.buildBoardsAndTraps();
    this.buildBillboards();
    progress(0.72, '注入海水…');
    this.buildWaterAndMountains();
    this.buildMinimap();
  }

  // ---------- 天空 / 光照 / 环境 ----------
  buildSky(renderer) {
    const sky = new Sky();
    sky.scale.setScalar(9000);
    const sun = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(90 - 52);   // 太阳仰角 52°
    const theta = THREE.MathUtils.degToRad(135);
    sun.setFromSphericalCoords(1, phi, theta);
    Object.assign(sky.material.uniforms, {});
    sky.material.uniforms.sunPosition.value.copy(sun);
    sky.material.uniforms.turbidity.value = 5.5;
    sky.material.uniforms.rayleigh.value = 1.4;
    sky.material.uniforms.mieCoefficient.value = 0.0018;
    sky.material.uniforms.mieDirectionalG.value = 0.85;
    this.scene.add(sky);

    // 环境反射（车漆关键）
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.scene.environment = pm.fromScene(envScene, 0.04).texture;
    pm.dispose();

    // 太阳平行光
    const dl = this.sunLight = new THREE.DirectionalLight(0xfff2e0, 1.9);
    dl.position.copy(sun).multiplyScalar(300);
    dl.castShadow = true;
    dl.shadow.mapSize.set(2048, 2048);
    const S = 110;
    dl.shadow.camera.left = -S; dl.shadow.camera.right = S;
    dl.shadow.camera.top = S; dl.shadow.camera.bottom = -S;
    dl.shadow.camera.near = 10; dl.shadow.camera.far = 700;
    dl.shadow.bias = -0.0004; dl.shadow.normalBias = 0.6;
    this.scene.add(dl); this.scene.add(dl.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd9ee, 0x9aa583, 0.4));

    this.scene.fog = new THREE.Fog(0xcfe0ee, 380, 1500);

    // 云
    const cloudTex = canvasTex(256, 128, (g) => {
      g.clearRect(0, 0, 256, 128);
      for (let i = 0; i < 14; i++) {
        const x = 30 + Math.random() * 196, y = 40 + Math.random() * 48, r = 16 + Math.random() * 26;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,.85)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    });
    const cmat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    for (let i = 0; i < 14; i++) {
      const s = 180 + this.rng() * 260;
      const c = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.45), cmat);
      const a = this.rng() * Math.PI * 2, r = 500 + this.rng() * 1100;
      c.position.set(Math.cos(a) * r, 170 + this.rng() * 160, Math.sin(a) * r);
      c.rotation.y = this.rng() * Math.PI;
      this.scene.add(c);
      const spd = 2 + this.rng() * 3;
      this.anim.push((dt) => { c.position.x += spd * dt; if (c.position.x > 1800) c.position.x = -1800; });
    }
  }

  // ---------- 地形 ----------
  buildTerrain() {
    const SIZE = 3500, SEG = 230;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0xffffff);          // 乘草地纹理
    const sand = new THREE.Color(1.35, 1.18, 0.82);
    const seabed = new THREE.Color(0.75, 0.72, 0.55);
    const cityTint = new THREE.Color(0.92, 0.92, 0.94);
    const wheat = new THREE.Color(1.38, 1.14, 0.55);  // 麦田
    const deep = new THREE.Color(0.72, 0.95, 0.72);   // 深绿作物
    const dry = new THREE.Color(1.22, 1.02, 0.82);    // 干草
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = baseHeight(x, z);
      pos.setY(i, h);
      let c = grass;
      const bx = smoothstep(CFG.coast.beachX - 14, CFG.coast.seaX - 30, x);
      if (bx > 0) c = h < -0.7 ? seabed : sand;
      else if (x > CITY_EXT.x1 - 30 && x < CITY_EXT.x2 + 30 && z > CITY_EXT.z1 - 30 && z < CITY_EXT.z2 + 30) c = cityTint;
      else {
        // 郊野农田：140m 网格 plots，麦色/深绿/干草色块（地平线式田园观感）
        const r = Math.hypot(x, z);
        if (r > 740 && roadDist(x, z) > 26) {
          const fx = Math.floor(x / 140), fz = Math.floor(z / 140);
          const v = hash2i(fx, fz);
          if (v < 0.3) c = wheat;
          else if (v < 0.55) c = deep;
          else if (v < 0.75) c = dry;
        }
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const grassTex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#7fae56'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5200; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? '#76a24e' : (v < 0.8 ? '#8abb60' : '#6d9a49');
        g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
    }, { repeat: [240, 240] });
    const mat = new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 0.95, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // ---------- 道路 ----------
  asphaltTex(w = 256) {
    return canvasTex(w, w, (g) => {
      g.fillStyle = '#3c4045'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? '#43474d' : '#363a3f';
        g.fillRect(Math.random() * w, Math.random() * w, 2, 2);
      }
    }, { repeat: [1, 1] });
  }

  roadStrip(s, y = 0.06) {
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    const tex = this.asphaltTex();
    tex.repeat.set(s.w / 8, len / 8);
    const geo = new THREE.PlaneGeometry(s.w, len);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93 }));
    m.position.set((s.x1 + s.x2) / 2, y, (s.z1 + s.z2) / 2);
    m.rotation.y = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  buildRoads() {
    // ---- 城市地块+街道一体化地面 ----
    const W = CITY_EXT.x2 - CITY_EXT.x1 + 16, H = CITY_EXT.z2 - CITY_EXT.z1 + 16;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2048;
    const g = cv.getContext('2d');
    const sx = 2048 / W, sz = 2048 / H;
    const X = x => (x - (CITY_EXT.x1 - 8)) * sx, Z = z => (z - (CITY_EXT.z1 - 8)) * sz;
    g.fillStyle = '#b9bcc2'; g.fillRect(0, 0, 2048, 2048);          // 人行道基色
    // 街区内填充
    const C = CFG.city, HALF = (C.n * C.pitch + C.roadW) / 2;
    const rngB = RNG(777);
    for (let i = 0; i < C.n; i++) for (let j = 0; j < C.n; j++) {
      const bx1 = CITY_EXT.x1 + C.roadW + i * C.pitch, bz1 = CITY_EXT.z1 + C.roadW + j * C.pitch;
      const bw = C.pitch - C.roadW;
      const v = rngB();
      g.fillStyle = v < 0.33 ? '#c5c8cd' : v < 0.66 ? '#bfc2c8' : '#cbcdd1';
      g.fillRect(X(bx1), Z(bz1), bw * sx, bw * sz);
      g.strokeStyle = '#a8abb2'; g.lineWidth = 3;
      g.strokeRect(X(bx1) + 4, Z(bz1) + 4, bw * sx - 8, bw * sz - 8);
    }
    // 街道沥青
    g.fillStyle = '#3c4045';
    for (const s of CITY_STREETS) {
      const x1 = Math.min(s.x1, s.x2) - s.w / 2, z1 = Math.min(s.z1, s.z2) - s.w / 2;
      const x2 = Math.max(s.x1, s.x2) + s.w / 2, z2 = Math.max(s.z1, s.z2) + s.w / 2;
      g.fillRect(X(x1), Z(z1), (x2 - x1) * sx, (z2 - z1) * sz);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94 }));
    slab.rotation.x = -Math.PI / 2;
    slab.rotation.z = 0;
    slab.position.set((CITY_EXT.x1 + CITY_EXT.x2) / 2, 0.045, (CITY_EXT.z1 + CITY_EXT.z2) / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);

    // ---- 车道线（实例化白/黄虚线） ----
    const dashGeo = new THREE.BoxGeometry(0.22, 0.02, 3.2);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.6 });
    const dashes = [];
    const addDashes = (x1, z1, x2, z2, step = 9) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ang = Math.atan2(x2 - x1, z2 - z1);
      for (let d = 6; d < len - 4; d += step) {
        const t = d / len;
        dashes.push([lerp(x1, x2, t), lerp(z1, z2, t), ang]);
      }
    };
    // 城市街道中心虚线（路口留空）
    const atIntersection = (x, z) => {
      let c = 0;
      for (let i = 0; i <= C.n; i++) {
        const off = -HALF + C.roadW / 2 + i * C.pitch;
        if (Math.abs(x - (C.cx + off)) < C.roadW * 0.8) c++;
        if (Math.abs(z - off) < C.roadW * 0.8) c++;
      }
      return c >= 2;
    };
    for (const s of CITY_STREETS) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      const ang = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
      for (let d = 6; d < len - 4; d += 9) {
        const t = d / len;
        const x = lerp(s.x1, s.x2, t), z = lerp(s.z1, s.z2, t);
        if (!atIntersection(x, z)) dashes.push([x, z, ang]);
      }
    }
    // 大道中线（双黄）
    for (const s of [...AVENUES, FEST_ROAD]) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      const ang = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
      const fx = Math.sin(ang), fz = Math.cos(ang);
      const rx = fz, rz = -fx;
      const yMat = new THREE.MeshStandardMaterial({ color: 0xf2c40d, roughness: 0.6 });
      for (const off of [-0.3, 0.3]) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, len), yMat);
        line.position.set((s.x1 + s.x2) / 2 + rx * off, 0.085, (s.z1 + s.z2) / 2 + rz * off);
        line.rotation.y = ang;
        this.scene.add(line);
      }
      // 车道白虚线（两侧车道）
      for (const off of [-5, 5]) {
        for (let d = 6; d < len - 4; d += 10) {
          const t = d / len;
          dashes.push([lerp(s.x1, s.x2, t) + rx * off, lerp(s.z1, s.z2, t) + rz * off, ang]);
        }
      }
    }
    // 海岸路中心虚线
    {
      const s = COAST_ROAD;
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      const ang = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
      for (let d = 8; d < len - 6; d += 10) {
        const t = d / len;
        dashes.push([lerp(s.x1, s.x2, t), lerp(s.z1, s.z2, t), ang]);
      }
    }

    // ---- 大道/海岸路/支路路面 ----
    for (const s of AVENUES) this.roadStrip(s);
    this.roadStrip(FEST_ROAD);
    this.roadStrip(COAST_ROAD);

    // ---- 环线高速 ----
    const R = CFG.ring.r, W2 = CFG.ring.w;
    const ringGeo = new THREE.RingGeometry(R - W2 / 2, R + W2 / 2, 220, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringTex = this.asphaltTex();
    ringTex.wrapS = ringTex.wrapT = THREE.RepeatWrapping;
    ringTex.repeat.set(160, 4);
    // RingGeometry UV 默认按单位圆——重映射：u=角度, v=半径
    const rp = ringGeo.attributes.position, uv = ringGeo.attributes.uv;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), z = rp.getZ(i);
      const a = Math.atan2(z, x);
      uv.setXY(i, a / Math.PI / 2 + 0.5, (Math.hypot(x, z) - (R - W2 / 2)) / W2);
    }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.93 }));
    ring.position.y = 0.055;
    ring.receiveShadow = true;
    this.scene.add(ring);
    // 中央隔离带
    const medGeo = new THREE.RingGeometry(R - 1.2, R + 1.2, 200, 1);
    medGeo.rotateX(-Math.PI / 2);
    const med = new THREE.Mesh(medGeo, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.9 }));
    med.position.y = 0.12;
    this.scene.add(med);
    // 高速车道虚线（r=612, 628），朝向沿切线
    for (const lr of [R - 8, R + 8]) {
      const n = Math.floor(Math.PI * 2 * lr / 11);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        dashes.push([Math.cos(a) * lr, Math.sin(a) * lr, -a]);
      }
    }
    const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, dashes.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1);
    dashes.forEach(([x, z, ang], i) => {
      // ang 对高速项存的是切线角 atan2 形式，统一按 rotation.y = ang
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      V.set(x, 0.085, z);
      M.compose(V, Q, SC);
      dashMesh.setMatrixAt(i, M);
    });
    dashMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(dashMesh);

    // ---- 护栏（内外圈，留缺口） ----
    const railGeo = new THREE.BoxGeometry(3.1, 0.55, 0.16);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xd5d9de, metalness: 0.75, roughness: 0.35 });
    const rails = [];
    for (const rr of [R - W2 / 2 + 0.6, R + W2 / 2 - 0.6]) {
      const n = Math.floor(Math.PI * 2 * rr / 3.3);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        let gap = false;
        for (const ga of RING_GAPS) {
          let d = Math.abs(a - (ga < 0 ? ga + Math.PI * 2 : ga));
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < 0.035) { gap = true; break; }
        }
        if (!gap) rails.push([Math.cos(a) * rr, Math.sin(a) * rr, a]);
      }
    }
    const railMesh = new THREE.InstancedMesh(railGeo, railMat, rails.length);
    rails.forEach(([x, z, a], i) => {
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      V.set(x, 0.5, z);
      M.compose(V, Q, SC);
      railMesh.setMatrixAt(i, M);
    });
    railMesh.instanceMatrix.needsUpdate = true;
    railMesh.castShadow = true;
    this.scene.add(railMesh);
  }

  // ---------- 城市建筑 ----------
  buildCity() {
    const C = CFG.city, HALF = (C.n * C.pitch + C.roadW) / 2;
    const rng = RNG(4242);
    // 三种立面
    const facades = [
      canvasTex(128, 256, (g) => {   // 玻璃幕墙
        g.fillStyle = '#7fa8c9'; g.fillRect(0, 0, 128, 256);
        for (let y = 6; y < 250; y += 16) for (let x = 6; x < 122; x += 14) {
          const v = Math.random();
          g.fillStyle = v < 0.55 ? '#a8c8e2' : v < 0.8 ? '#6d94b8' : '#cfe2f2';
          g.fillRect(x, y, 10, 11);
        }
      }),
      canvasTex(128, 256, (g) => {   // 暖色混凝土
        g.fillStyle = '#cbb9a0'; g.fillRect(0, 0, 128, 256);
        for (let y = 8; y < 248; y += 20) for (let x = 8; x < 120; x += 18) {
          g.fillStyle = Math.random() < 0.7 ? '#5a5348' : '#8a8172';
          g.fillRect(x, y, 12, 13);
        }
      }),
      canvasTex(128, 256, (g) => {   // 现代白
        g.fillStyle = '#dfe3e8'; g.fillRect(0, 0, 128, 256);
        for (let y = 5; y < 250; y += 13) for (let x = 5; x < 122; x += 11) {
          g.fillStyle = Math.random() < 0.6 ? '#3d4854' : '#93a5b5';
          g.fillRect(x, y, 7, 8);
        }
      }),
    ];
    const geoms = new THREE.BoxGeometry(1, 1, 1);
    geoms.translate(0, 0.5, 0);
    const lists = [[], [], []];
    const roofs = [];
    const plazaI = 2, plazaJ = 2;  // 中心广场街区
    for (let i = 0; i < C.n; i++) for (let j = 0; j < C.n; j++) {
      const bx = CITY_EXT.x1 + C.roadW + i * C.pitch + (C.pitch - C.roadW) / 2;
      const bz = CITY_EXT.z1 + C.roadW + j * C.pitch + (C.pitch - C.roadW) / 2;
      if (i === plazaI && j === plazaJ) continue;   // 广场不建楼
      const lot = C.pitch - C.roadW - 8;             // 可建范围
      const dCenter = Math.hypot(bx - C.cx, bz - C.cz);
      const downtown = dCenter < 190;
      const nB = downtown ? 1 + (rng() * 2 | 0) : 2 + (rng() * 3 | 0);
      for (let b = 0; b < nB; b++) {
        const w = downtown ? 26 + rng() * 18 : 16 + rng() * 22;
        const d = downtown ? 26 + rng() * 18 : 16 + rng() * 22;
        const h = downtown ? 45 + rng() * 85 : 10 + rng() * 30;
        const ox = (rng() - 0.5) * Math.max(0, lot - w), oz = (rng() - 0.5) * Math.max(0, lot - d);
        const x = bx + ox, z = bz + oz;
        lists[(rng() * 3) | 0].push([x, z, w, h, d]);
        this.buildings.push({ x1: x - w / 2, z1: z - d / 2, x2: x + w / 2, z2: z + d / 2, h });
        if (h > 40) roofs.push([x, z, w, h, d]);
      }
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
    const tint = new THREE.Color();
    const beacons = [];
    lists.forEach((list, k) => {
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({ map: facades[k], roughness: 0.78, metalness: 0.08, envMapIntensity: 0.5 });
      const im = new THREE.InstancedMesh(geoms, mat, list.length);
      list.forEach(([x, z, w, h, d], i) => {
        Q.identity(); V.set(x, 0.05, z); S.set(w, h, d);
        M.compose(V, Q, S);
        im.setMatrixAt(i, M);
        // 逐栋明暗/色温微差，打破复制感
        tint.setHSL(0.58 + (rng() - 0.5) * 0.06, 0.06 + rng() * 0.05, 0.72 + (rng() - 0.5) * 0.22);
        im.setColorAt(i, tint);
        if (h > 95) beacons.push([x, h + 0.05, z]);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      this.scene.add(im);
    });
    // 超高层楼顶航空警示灯（呼吸闪烁，泛光下很出效果）
    if (beacons.length) {
      const bm = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.7, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x30060a, emissive: 0xff2020, emissiveIntensity: 4 }),
        beacons.length);
      beacons.forEach(([x, y, z], i) => {
        V.set(x, y, z); S.set(1, 1, 1); Q.identity();
        M.compose(V, Q, S);
        bm.setMatrixAt(i, M);
      });
      bm.instanceMatrix.needsUpdate = true;
      this.scene.add(bm);
      this.beaconMat = bm.material;
      this.anim.push((dt, t) => { this.beaconMat.emissiveIntensity = 2.5 + Math.sin(t * 2.4) * 2.5; });
    }
    // 楼顶设备间
    if (roofs.length) {
      const rim = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 }), roofs.length * 2);
      let ri = 0;
      for (const [x, z, w, h, d] of roofs) {
        for (let k = 0; k < 2; k++) {
          V.set(x + (this.rng() - 0.5) * w * 0.4, h + 1.5, z + (this.rng() - 0.5) * d * 0.4);
          S.set(3 + this.rng() * 4, 3, 3 + this.rng() * 4);
          Q.identity(); M.compose(V, Q, S);
          rim.setMatrixAt(ri++, M);
        }
      }
      rim.count = ri; rim.instanceMatrix.needsUpdate = true;
      this.scene.add(rim);
    }

    // ---- 中心广场：喷泉 + 纪念塔 ----
    const px = CITY_EXT.x1 + C.roadW + plazaI * C.pitch + (C.pitch - C.roadW) / 2;
    const pz = CITY_EXT.z1 + C.roadW + plazaJ * C.pitch + (C.pitch - C.roadW) / 2;
    this.plaza = { x: px, z: pz };
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 13, 1.1, 28),
      new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.6 }));
    basin.position.set(px, 0.55, pz); basin.castShadow = true;
    this.scene.add(basin);
    const pool = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 11, 0.3, 28),
      new THREE.MeshStandardMaterial({ color: 0x4fb3d9, roughness: 0.15, metalness: 0.1 }));
    pool.position.set(px, 1.0, pz);
    this.scene.add(pool);
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.6, 26, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 0.6, roughness: 0.3 }));
    tower.position.set(px, 14, pz); tower.castShadow = true;
    this.scene.add(tower);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffc53c, emissive: 0xffa500, emissiveIntensity: 3.5 }));
    beacon.position.set(px, 27.5, pz);
    this.scene.add(beacon);
    this.anim.push((dt, t) => { beacon.position.y = 27.5 + Math.sin(t * 1.5) * 0.4; beacon.rotation.y += dt; });
  }

  // ---------- 树木 ----------
  buildVegetation() {
    const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7);
    trunkG.translate(0, 1.3, 0);
    const canG = new THREE.IcosahedronGeometry(2.1, 1);
    canG.translate(0, 3.6, 0);
    const spots = [];
    const rng = RNG(999);
    // 大道行道树
    for (const s of [...AVENUES, FEST_ROAD, COAST_ROAD]) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      const ang = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
      const rx = Math.cos(ang), rz = -Math.sin(ang);
      for (let d = 10; d < len - 8; d += 16) {
        const t = d / len;
        for (const off of [-s.w / 2 - 4, s.w / 2 + 4]) {
          const x = lerp(s.x1, s.x2, t) + rx * off, z = lerp(s.z1, s.z2, t) + rz * off;
          if (Math.abs(x) < CFG.ring.r + 26 && Math.abs(x) > 0 && Math.hypot(x, z) > CFG.ring.r - 26 && Math.hypot(x, z) < CFG.ring.r + 26) continue; // 避开高速
          spots.push([x, z, 0.8 + rng() * 0.7]);
        }
      }
    }
    // 郊野散布
    for (let i = 0; i < 700; i++) {
      const a = rng() * Math.PI * 2, r = 720 + rng() * 750;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > CFG.coast.beachX - 20) continue;                 // 海里不长
      if (roadDist(x, z) < 26) continue;
      spots.push([x, z, 0.9 + rng() * 1.3]);
    }
    // 城市公园点
    for (let i = 0; i < 60; i++) {
      const x = CITY_EXT.x1 + rng() * (CITY_EXT.x2 - CITY_EXT.x1);
      const z = CITY_EXT.z1 + rng() * (CITY_EXT.z2 - CITY_EXT.z1);
      if (roadDist(x, z) < 4) continue;
      spots.push([x, z, 0.7 + rng() * 0.5]);
    }
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x7a5b3a, roughness: 0.95 });
    const canM = new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.9 });
    const im1 = new THREE.InstancedMesh(trunkG, trunkM, spots.length);
    const im2 = new THREE.InstancedMesh(canG, canM, spots.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
    const cc = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      const y = baseHeight(x, z);
      V.set(x, y, z); S.set(s, s, s);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
      M.compose(V, Q, S);
      im1.setMatrixAt(i, M); im2.setMatrixAt(i, M);
      cc.setHSL(0.28 + rng() * 0.08, 0.5, 0.32 + rng() * 0.12);
      im2.setColorAt(i, cc);
      this.poles.add(x, z, 0.55 * s, 'tree');
    });
    im1.instanceMatrix.needsUpdate = true; im2.instanceMatrix.needsUpdate = true;
    im1.castShadow = true; im2.castShadow = true;
    this.scene.add(im1); this.scene.add(im2);
  }

  // ---------- 路灯 ----------
  buildLamps() {
    const poleG = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 6);
    poleG.translate(0, 3.75, 0);
    const headG = new THREE.BoxGeometry(0.5, 0.16, 1.4);
    headG.translate(0, 7.5, 0.8);
    const spots = [];
    // 城市街道
    for (const s of CITY_STREETS) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      const ang = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
      const rx = Math.cos(ang), rz = -Math.sin(ang);
      let side = 1;
      for (let d = 20; d < len - 10; d += 44) {
        const t = d / len;
        const off = side * (s.w / 2 + 1.6);
        side = -side;
        spots.push([lerp(s.x1, s.x2, t) + rx * off, lerp(s.z1, s.z2, t) + rz * off, ang + (side > 0 ? 0 : Math.PI)]);
      }
    }
    // 高速外圈
    const R = CFG.ring.r + CFG.ring.w / 2 + 2;
    for (let a = 0; a < Math.PI * 2; a += 0.075) {
      spots.push([Math.cos(a) * R, Math.sin(a) * R, -a]);
    }
    const poleM = new THREE.MeshStandardMaterial({ color: 0x5a616a, metalness: 0.7, roughness: 0.4 });
    const headM = new THREE.MeshStandardMaterial({ color: 0xf5f2e0, emissive: 0xfff6d8, emissiveIntensity: 0.6 });
    const ip = new THREE.InstancedMesh(poleG, poleM, spots.length);
    const ih = new THREE.InstancedMesh(headG, headM, spots.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, ang], i) => {
      V.set(x, 0, z); Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      M.compose(V, Q, S);
      ip.setMatrixAt(i, M); ih.setMatrixAt(i, M);
      this.poles.add(x, z, 0.3, 'lamp');
    });
    ip.instanceMatrix.needsUpdate = true; ih.instanceMatrix.needsUpdate = true;
    ip.castShadow = true;
    this.scene.add(ip); this.scene.add(ih);
  }

  // ---------- 嘉年华会场 ----------
  buildFestival() {
    const F = CFG.fest;
    // 铺装广场
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(F.r, 48),
      (() => {
        const t = canvasTex(512, 512, (g) => {
          g.fillStyle = '#b9ac95'; g.fillRect(0, 0, 512, 512);
          for (let i = 0; i < 1500; i++) {
            g.fillStyle = ['#e8572a', '#ffc53c', '#12b5a8', '#8a5be2'][i % 4] + '44';
            g.fillRect(Math.random() * 512, Math.random() * 512, 5, 5);
          }
        });
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 8);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
      })());
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(F.x, 0.07, F.z);
    pad.receiveShadow = true;
    this.scene.add(pad);

    // 摩天轮
    const wheel = new THREE.Group();
    wheel.position.set(F.x + 30, 0, F.z - 45);
    const steel = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, metalness: 0.8, roughness: 0.3 });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3, 12), steel);
    hub.rotation.z = Math.PI / 2; hub.position.y = 26;
    wheel.add(hub);
    for (const s of [-1, 1]) {   // A 字支架
      for (const s2 of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 30, 8), steel);
        leg.position.set(s2 * 1.4, 13, s * 7);
        leg.rotation.x = s * 0.24;
        leg.castShadow = true;
        wheel.add(leg);
      }
    }
    const rimGroup = new THREE.Group();
    rimGroup.position.y = 26;
    wheel.add(rimGroup);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(22, 0.5, 8, 40), steel);
    rim.rotation.y = Math.PI / 2;
    rim.castShadow = true;
    rimGroup.add(rim);
    // 轮辐
    for (let i = 0; i < 8; i++) {
      const arm = new THREE.Group();
      arm.rotation.x = i / 8 * Math.PI;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 43, 6), steel);
      rod.rotation.x = Math.PI / 2;
      arm.add(rod);
      rimGroup.add(arm);
    }
    // 座舱
    const cabins = [];
    const cabColors = [0xe8572a, 0xffc53c, 0x12b5a8, 0x8a5be2, 0xf2b705, 0x1a6fe0];
    for (let i = 0; i < 12; i++) {
      const arm = new THREE.Group();
      arm.rotation.x = i / 12 * Math.PI * 2;
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.4, 2.0),
        new THREE.MeshStandardMaterial({ color: cabColors[i % 6], roughness: 0.4, metalness: 0.2 }));
      cab.position.set(0, 22, 0);
      cab.castShadow = true;
      arm.add(cab);
      rimGroup.add(arm);
      cabins.push({ arm, cab });
    }
    this.scene.add(wheel);
    // 摩天轮整体转动：rimGroup 绕 X 转，座舱保持竖直
    this.anim.push((dt) => {
      rimGroup.rotation.x += dt * 0.12;
      for (const c of cabins) c.cab.rotation.x = -(c.arm.rotation.x + rimGroup.rotation.x);
    });
    this.poles.add(wheel.position.x, wheel.position.z, 9, 'wheel');

    // 彩色帐篷
    const tentC = [0xe8572a, 0x12b5a8, 0xffc53c, 0x8a5be2, 0x1a6fe0, 0xf25fa0];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.4;
      const x = F.x + Math.cos(a) * (F.r * 0.62), z = F.z + Math.sin(a) * (F.r * 0.62);
      const tent = new THREE.Mesh(
        new THREE.ConeGeometry(4.2, 4.6, 8),
        new THREE.MeshStandardMaterial({ color: tentC[i], roughness: 0.7 }));
      tent.position.set(x, 2.3, z);
      tent.castShadow = true;
      this.scene.add(tent);
      this.poles.add(x, z, 6.4, 'tent');
    }
    // 热气球
    for (let i = 0; i < 5; i++) {
      const bal = new THREE.Group();
      const env = new THREE.Mesh(
        new THREE.SphereGeometry(4, 18, 14),
        new THREE.MeshStandardMaterial({ color: tentC[i % 6], roughness: 0.5 }));
      const bask = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4),
        new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 }));
      bask.position.y = -5.2;
      bal.add(env); bal.add(bask);
      const bx = F.x + (this.rng() - 0.5) * 500, bz = F.z + (this.rng() - 0.5) * 500;
      bal.position.set(bx, 60 + this.rng() * 50, bz);
      this.scene.add(bal);
      const ph = this.rng() * 6.28;
      this.anim.push((dt, t) => { bal.position.y += Math.sin(t * 0.5 + ph) * dt * 1.2; bal.rotation.y += dt * 0.05; });
    }
  }

  // ---------- 坡道 ----------
  buildRamps() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.85 });
    const edgeM = new THREE.MeshStandardMaterial({ color: 0xe8572a, roughness: 0.6 });
    for (const rp of RAMP_DEFS) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(rp.len, 0); shape.lineTo(rp.len, rp.h); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: rp.w, bevelEnabled: false });
      geo.translate(0, 0, -rp.w / 2);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = rp.dir - Math.PI / 2;
      m.position.set(rp.x, baseHeight(rp.x, rp.z), rp.z);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      // 两侧橙色边条
      for (const s of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(rp.len, 0.1, 0.25), edgeM);
        const fx = Math.sin(rp.dir), fz = Math.cos(rp.dir);
        const rx = fz * s, rz = -fx * s;
        strip.position.set(
          rp.x + fx * rp.len / 2 + rx * (rp.w / 2 - 0.1),
          baseHeight(rp.x, rp.z) + rp.h / 2 + 0.1,
          rp.z + fz * rp.len / 2 + rz * (rp.w / 2 - 0.1));
        strip.rotation.y = rp.dir;
        strip.rotation.z = Math.atan2(rp.h, rp.len) * (rp.dir >= Math.PI ? 1 : 1);
        // 让边条贴坡面
        strip.rotation.set(0, rp.dir, 0);
        strip.rotateX(-Math.atan2(rp.h, rp.len));
        this.scene.add(strip);
      }
    }
  }

  // ---------- 奖励牌 & 测速点 ----------
  buildBoardsAndTraps() {
    const boardTex = canvasTex(256, 160, (g) => {
      g.fillStyle = '#f2571f'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#ffc53c';
      for (let i = 0; i < 12; i++) {
        g.save(); g.translate(128, 80); g.rotate(i * Math.PI / 6);
        g.fillRect(60, -8, 60, 16); g.restore();
      }
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(128, 80, 52, 0, 7); g.fill();
      g.fillStyle = '#e63329';
      g.font = '900 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('奖', 128, 84);
    });
    this.boards = [];
    const defs = [
      // 地面奖励牌
      [ -180, 250, 0 ], [ 100, -420, 0 ], [ 500, 200, 0 ], [ -520, -420, 0 ],
      [ 640, 560, 0 ], [ -700, 350, 0 ], [ 300, 640, 0 ], [ -60, 700, 0 ],
      // 坡道尽头空中奖励牌
      [ -260, -452, 2.6 ], [ -260, 452, 2.6 ], [ 282, 0, 2.6 ], [ 52, 470, 2.9 ],
    ];
    const postM = new THREE.MeshStandardMaterial({ color: 0x444a52, metalness: 0.6, roughness: 0.4 });
    for (const [x, z, y] of defs) {
      const grp = new THREE.Group();
      const gy = baseHeight(x, z);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7),
        new THREE.MeshStandardMaterial({ map: boardTex, side: THREE.DoubleSide, roughness: 0.5 }));
      p.position.y = y + 1.6;
      grp.add(p);
      if (y === 0) {
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), postM);
          post.position.set(s * 1.1, 1.2, 0);
          grp.add(post);
        }
      }
      grp.position.set(x, gy, z);
      this.scene.add(grp);
      this.boards.push({ x, z, y: gy + y + 1.6, r: 3.4, mesh: grp, hit: false });
    }

    // 测速点（门架）
    this.traps = [];
    const trapDefs = [
      { x: Math.cos(0.7) * CFG.ring.r, z: Math.sin(0.7) * CFG.ring.r, ang: -0.7 + Math.PI / 2, w: 20 },
      { x: Math.cos(2.4) * CFG.ring.r, z: Math.sin(2.4) * CFG.ring.r, ang: -2.4 + Math.PI / 2, w: 20 },
      { x: 300, z: 0, ang: Math.PI / 2, w: 18 },
      { x: 655, z: -80, ang: 0, w: 16 },
    ];
    const gantM = new THREE.MeshStandardMaterial({ color: 0x2f6fb2, metalness: 0.5, roughness: 0.4 });
    for (const t of trapDefs) {
      const grp = new THREE.Group();
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7, 8), gantM);
        pole.position.set(s * (t.w / 2 + 1), 3.5, 0);
        pole.castShadow = true;
        grp.add(pole);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(t.w + 3, 0.8, 0.6), gantM);
      bar.position.y = 7;
      grp.add(bar);
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff3020, emissiveIntensity: 1.5 }));
      cam.position.y = 6.4;
      grp.add(cam);
      grp.position.set(t.x, 0, t.z);
      grp.rotation.y = t.ang;
      this.scene.add(grp);
      this.traps.push({ x: t.x, z: t.z, r: t.w / 2 + 2, record: 0 });
    }
  }

  // ---------- 广告牌 ----------
  buildBillboards() {
    const ads = [
      ['极速轮胎', '#e8572a', '#fff'], ['海风水上乐园', '#12b5a8', '#fff'],
      ['都会咖啡', '#6a4a2a', '#ffe9c9'], ['疾驰改装厂', '#222831', '#ffc53c'],
      ['嘉年华音乐节', '#8a5be2', '#fff'], ['海岸度假酒店', '#1a6fe0', '#fff'],
      ['菠萝披萨店', '#f2b705', '#5a3a00'], ['星光加油站', '#d42a6a', '#fff'],
    ];
    const postM = new THREE.MeshStandardMaterial({ color: 0x555b63, metalness: 0.6, roughness: 0.5 });
    ads.forEach(([txt, bg, fg], i) => {
      const a = i / ads.length * Math.PI * 2 + 0.35;
      const r = CFG.ring.r + CFG.ring.w / 2 + 14;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const tex = canvasTex(512, 224, (g) => {
        g.fillStyle = bg; g.fillRect(0, 0, 512, 224);
        g.fillStyle = '#ffffff30';
        g.fillRect(0, 0, 512, 26); g.fillRect(0, 198, 512, 26);
        g.fillStyle = fg;
        g.font = '900 84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, 256, 116);
      });
      const grp = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.9),
        new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.55 }));
      panel.position.y = 5.6;
      panel.castShadow = true;
      grp.add(panel);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.2, 8), postM);
        post.position.set(s * 3, 2.1, 0);
        grp.add(post);
      }
      grp.position.set(x, baseHeight(x, z), z);
      grp.rotation.y = -a - Math.PI / 2;
      this.scene.add(grp);
      this.poles.add(x, z, 1.2, 'billboard');
    });
  }

  // ---------- 海水 & 远山 ----------
  buildWaterAndMountains() {
    // 程序生成可平铺的水面法线图（周期噪声，接缝不可见）
    const N = 256, CELLS = 20;
    const hgt = new Float32Array(N * N);
    const cell = (v, m) => ((v % m) + m) % m;
    const pfade = t => t * t * (3 - 2 * t);
    const pnoise = (fx, fy, cells) => {
      const xi = Math.floor(fx), yi = Math.floor(fy);
      const xf = fx - xi, yf = fy - yi;
      const w = (dx, dy) => {
        const gx = cell(xi + dx, cells), gy = cell(yi + dy, cells);
        return hash2i(gx * 7349 + 11, gy * 9241 + 7);
      };
      const u = pfade(xf), v = pfade(yf);
      return (w(0, 0) * (1 - u) + w(1, 0) * u) * (1 - v) + (w(0, 1) * (1 - u) + w(1, 1) * u) * v;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * CELLS, fy = y / N * CELLS;
      hgt[y * N + x] = pnoise(fx, fy, CELLS) + 0.5 * pnoise(fx * 2.5, fy * 2.5, CELLS * 2.5);
    }
    const nv = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const l = hgt[y * N + ((x - 1 + N) % N)], r = hgt[y * N + ((x + 1) % N)];
      const u = hgt[((y - 1 + N) % N) * N + x], d = hgt[((y + 1) % N) * N + x];
      const nx = (l - r) * 1.6, ny = (u - d) * 1.6;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * N + x) * 4;
      nv[o] = (nx * inv * 0.5 + 0.5) * 255;
      nv[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nv[o + 2] = (inv * 0.5 + 0.5) * 255;
      nv[o + 3] = 255;
    }
    const ntex = new THREE.DataTexture(nv, N, N);
    ntex.wrapS = ntex.wrapT = THREE.RepeatWrapping;
    ntex.repeat.set(46, 46);
    ntex.needsUpdate = true;

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(3600, 3600),
      new THREE.MeshStandardMaterial({
        color: 0x3f96c8, roughness: 0.12, metalness: 0.05,
        transparent: true, opacity: 0.94, envMapIntensity: 1.2,
        normalMap: ntex, normalScale: new THREE.Vector2(0.55, 0.55),
      }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = CFG.coast.seaY;
    this.scene.add(water);
    this.anim.push((dt, t) => {
      water.position.y = CFG.coast.seaY + Math.sin(t * 0.6) * 0.05;
      ntex.offset.set(t * 0.006, t * 0.004);
    });

    // 远山环
    const rng = RNG(31337);
    const mtnM = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 1, flatShading: true });
    const snowM = new THREE.MeshStandardMaterial({ color: 0xeef4f8, roughness: 1, flatShading: true });
    const grp = new THREE.Group();
    for (let i = 0; i < 34; i++) {
      const a = i / 34 * Math.PI * 2 + rng() * 0.15;
      // 东侧是海，少放山
      if (Math.abs(a) < 0.5 || Math.abs(a - Math.PI * 2) < 0.5) continue;
      const r = 1420 + rng() * 260;
      const h = 130 + rng() * 220;
      const m = new THREE.Mesh(new THREE.ConeGeometry(160 + rng() * 160, h, 6), mtnM);
      m.position.set(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r);
      grp.add(m);
      if (h > 240) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(60, h * 0.3, 6), snowM);
        s.position.set(m.position.x, h - h * 0.15 - 8, m.position.z);
        grp.add(s);
      }
    }
    this.scene.add(grp);

    // ---- 郊野风力发电机 ----
    const wtM = new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.5, metalness: 0.2 });
    for (const [wx, wz] of [[830, -430], [975, -140], [-820, -760], [-1010, -420], [-880, 620]]) {
      const gy = baseHeight(wx, wz);
      const tur = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.0, 46, 10), wtM);
      pole.position.y = 23;
      pole.castShadow = true;
      tur.add(pole);
      const nac = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 5.5), wtM);
      nac.position.y = 46;
      tur.add(nac);
      const rotor = new THREE.Group();
      rotor.position.set(0, 46, 3.1);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 19, 0.4), wtM);
        blade.position.y = 9.5;
        const arm = new THREE.Group();
        arm.rotation.z = b / 3 * Math.PI * 2;
        arm.add(blade);
        rotor.add(arm);
      }
      tur.add(rotor);
      tur.position.set(wx, gy, wz);
      tur.rotation.y = this.rng() * Math.PI * 2;
      this.scene.add(tur);
      const spd = 0.5 + this.rng() * 0.5;
      this.anim.push((dt) => { rotor.rotation.z += dt * spd; });
      this.poles.add(wx, wz, 2.4, 'turbine');
    }
  }

  // ---------- 小地图底图 ----------
  buildMinimap() {
    const cv = this.mapCanvas = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const g = cv.getContext('2d');
    const S = 1024 / 3400;                       // 米→像素
    const X = x => (x + 1700) * S, Z = z => (z + 1700) * S;
    g.fillStyle = '#a8c78a'; g.fillRect(0, 0, 1024, 1024);          // 草地
    g.fillStyle = '#7cc0de';                                        // 海
    g.fillRect(X(CFG.coast.seaX), 0, 1024 - X(CFG.coast.seaX), 1024);
    g.fillStyle = '#e8d9a8';                                        // 沙滩
    g.fillRect(X(CFG.coast.beachX), 0, X(CFG.coast.seaX) - X(CFG.coast.beachX), 1024);
    g.fillStyle = '#c3c6cc';                                        // 城市
    g.fillRect(X(CITY_EXT.x1), Z(CITY_EXT.z1), (CITY_EXT.x2 - CITY_EXT.x1) * S, (CITY_EXT.z2 - CITY_EXT.z1) * S);
    g.strokeStyle = '#565b62'; g.lineCap = 'round';
    const drawRoad = (s) => {
      g.lineWidth = Math.max(2, s.w * S);
      g.beginPath(); g.moveTo(X(s.x1), Z(s.z1)); g.lineTo(X(s.x2), Z(s.z2)); g.stroke();
    };
    for (const s of CITY_STREETS) drawRoad(s);
    for (const s of AVENUES) drawRoad(s);
    drawRoad(FEST_ROAD); drawRoad(COAST_ROAD);
    g.lineWidth = Math.max(2, CFG.ring.w * S);
    g.beginPath(); g.arc(X(0), Z(0), CFG.ring.r * S, 0, 7); g.stroke();
    g.fillStyle = '#f2571f';
    g.beginPath(); g.arc(X(CFG.fest.x), Z(CFG.fest.z), 8, 0, 7); g.fill();
    this.mapScale = { S, X, Z };
  }

  // 高速护栏碰撞：返回是否碰撞
  checkRails(pos, cr) {
    const R = CFG.ring.r, W2 = CFG.ring.w;
    const r = Math.hypot(pos.x, pos.z);
    if (r < R - W2 / 2 - 1 || r > R + W2 / 2 + 1) return null;
    const inner = R - W2 / 2 + 0.9, outer = R + W2 / 2 - 0.9;
    const a = Math.atan2(pos.z, pos.x);
    for (const ga of RING_GAPS) {
      let d = Math.abs(a - ga);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 0.045) return null;              // 缺口
    }
    if (r - cr < inner && r > inner - 3) return { side: 'inner', rail: inner };
    if (r + cr > outer && r < outer + 3) return { side: 'outer', rail: outer };
    return null;
  }

  update(dt, t) {
    for (const f of this.anim) f(dt, t);
  }
}

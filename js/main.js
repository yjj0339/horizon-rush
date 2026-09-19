import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CFG, clamp, lerp } from './config.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { loadVehicles, setPaint } from './car.js';
import { CarPhysics } from './physics.js';
import { World, groundInfo, groundH } from './world.js';
import { Traffic } from './traffic.js';
import { SkidMarks, Smoke, NitroFlames } from './effects.js';
import { HUD } from './hud.js';
import { CITY_STREETS, AVENUES, COAST_ROAD, roadDist } from './roads.js';

const params = new URLSearchParams(location.search);
const AUTO = params.get('auto') === '1';
const NOUI = params.get('noui') === '1';

const loadFill = document.getElementById('load-fill');
const loadText = document.getElementById('load-text');
const progress = (p, t) => { loadFill.style.width = (p * 100) + '%'; if (t) loadText.textContent = t; };

// ---------- 渲染器 ----------
const IS_TOUCH = ('ontouchstart' in window) && matchMedia('(pointer:coarse)').matches;
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CFG.cam.fov, innerWidth / innerHeight, 0.3, 4200);

// ---------- 世界 ----------
progress(0.02, '点燃引擎…');
const world = new World(scene, renderer, progress);

// ---------- 历史纪录（localStorage 存档） ----------
const save = (() => {
  let data = { best: 0, top: 0, boards: 0 };
  try { Object.assign(data, JSON.parse(localStorage.getItem('horizon-rush-save') || '{}')); } catch (e) {}
  let dirty = 0;
  return {
    get: () => data,
    flush() {
      if (skillScore > data.best) data.best = skillScore | 0;
      if (topSpeed > data.top) data.top = topSpeed | 0;
      if (boardsHit > data.boards) data.boards = boardsHit;
      clearTimeout(dirty);
      dirty = setTimeout(() => { try { localStorage.setItem('horizon-rush-save', JSON.stringify(data)); } catch (e) {} }, 1500);
    },
  };
})();

// ---------- 主流程 ----------
let car, phys, traffic, skids, smoke, flames, hud;
const input = new Input();
const audio = new GameAudio();
let state = AUTO ? 'play' : 'menu';
let camMode = 0;
let paused = false;
let skillScore = 0, topSpeed = 0, boardsHit = 0;
let driftChain = 0, airTime = 0;
let menuAngle = 0;

progress(0.8, '拼装车辆…');
loadVehicles().then(({ car: c, sedan }) => {
  car = c;
  scene.add(car.group);
  progress(0.9, '生成车流…');
  phys = new CarPhysics();
  window.__game = {                           // 测试钩子
    get speed() { return phys.speed * 3.6; },
    get pos() { return { x: phys.pos.x, y: phys.pos.y, z: phys.pos.z }; },
    get drifting() { return phys.drifting; },
    reset(v) { phys.vel.set(0, 0); },
    teleport(x, z, h) { phys.pos.set(x, groundH(x, z), z); if (h !== undefined) phys.heading = h; phys.vel.set(0, 0); },
    debugInfo() {
      const wp = car.group.position;
      return {
        car: { x: +wp.x.toFixed(1), y: +wp.y.toFixed(2), z: +wp.z.toFixed(1), inScene: car.group.parent === scene },
        cam: camera.position.toArray().map(v => +v.toFixed(1)),
        fov: +camera.fov.toFixed(1),
        state,
      };
    },
  };
  traffic = new Traffic(scene, sedan);
  skids = new SkidMarks(scene);
  smoke = new Smoke(scene);
  flames = new NitroFlames(car.group);
  hud = new HUD(world);
  if (NOUI) document.getElementById('hud').style.display = 'none';
  applySpawn();
  progress(1, '完成！');
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
    if (state === 'menu') document.getElementById('menu').classList.remove('hidden');
    else { document.getElementById('hud').classList.remove('hidden'); }
  }, 300);
}).catch(err => {
  loadText.textContent = '加载失败：' + err.message;
  console.error(err);
});

// 出生点（支持 URL 参数取景）
function applySpawn() {
  const pos = params.get('pos');
  const spots = {
    fest: [CFG.fest.x, CFG.fest.z, -2.55],
    city: [-260, -300, 0],
    plaza: [world.plaza.x + 60, world.plaza.z + 60, Math.PI * 0.75],
    highway: [Math.cos(0.7) * 612, Math.sin(0.7) * 612, 0.7 + Math.PI / 2],
    coast: [655, 300, Math.PI],
    beach: [640, 100, Math.PI / 2],
    wheel: [-20, 540, 1.75],
    ramp: [260, 30, Math.PI / 2],
  };
  const [x, z, h] = spots[pos] || spots.fest;
  phys.pos.set(x, groundH(x, z), z);
  phys.heading = h;
  // 相机直接吸附到车后，避免开场飘移
  camPos.set(x - Math.sin(h) * CFG.cam.chaseBack, groundH(x, z) + CFG.cam.chaseUp, z - Math.cos(h) * CFG.cam.chaseBack);
}

// ---------- 后期处理 ----------
const rtOpts = { samples: 4, type: THREE.HalfFloatType };
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, rtOpts));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.55, 1.0);
composer.addPass(bloom);
const fxPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmt;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float ca = uAmt * 0.0045;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d * ca).b;
      float vig = 1.0 - dot(d, d) * (0.5 + uAmt * 0.35);
      col *= vig;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(fxPass);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- 菜单 ----------
const paintRow = document.getElementById('paint-row');
let paintIdx = 0;
CFG.paints.forEach((p, i) => {
  const el = document.createElement('div');
  el.className = 'paint' + (i === 0 ? ' sel' : '');
  el.style.background = '#' + p.c.toString(16).padStart(6, '0');
  el.title = p.name;
  el.onclick = () => {
    paintIdx = i;
    document.querySelectorAll('.paint').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    if (car) setPaint(car, p.c);
  };
  paintRow.appendChild(el);
});
let glowOn = false;
document.getElementById('btn-glow').onclick = () => {
  glowOn = !glowOn;
  document.getElementById('btn-glow').textContent = `霓虹底盘灯：${glowOn ? '开' : '关'}`;
  if (car) car.glow.visible = glowOn;
};
// 菜单里展示历史纪录
{
  const r = save.get();
  const el = document.getElementById('records');
  if (el) el.textContent = r.best || r.top
    ? `历史纪录：技巧分 ${r.best | 0} · 极速 ${r.top | 0} km/h · 单局奖励牌 ${r.boards | 0}/12`
    : '首次出赛，去创造你的纪录吧！';
}
document.getElementById('btn-start').onclick = startGame;
function startGame() {
  audio.ensure();
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  state = 'play';
  hud.msg('自由狂飙开始！');
}

// ---------- 按键 ----------
function cycleCam() { camMode = (camMode + 1) % 3; }
function togglePause() {
  if (state !== 'play') return;
  paused = !paused;
  document.getElementById('pause').classList.toggle('hidden', !paused);
}
addEventListener('keydown', e => {
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyG') { glowOn = !glowOn; if (car) car.glow.visible = glowOn; }
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'Escape') togglePause();
  if (state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) startGame();
});
addEventListener('pointerdown', () => audio.ensure(), { once: true });
// 触屏顶部小按钮（暂停 / 视角 / 静音）
document.getElementById('tb-pause').onclick = togglePause;
document.getElementById('tb-cam').onclick = cycleCam;
document.getElementById('tb-mute').onclick = () => {
  const m = audio.toggleMute();
  document.getElementById('tb-mute').textContent = m ? '🔇' : '🔊';
};
document.getElementById('pause').onclick = togglePause;

function resetCar() {
  // 找最近的道路点复位
  const all = [...CITY_STREETS, ...AVENUES, COAST_ROAD];
  let best = null, bd = 1e9;
  for (const s of all) {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
    const L2 = dx * dx + dz * dz;
    let t = ((phys.pos.x - s.x1) * dx + (phys.pos.z - s.z1) * dz) / L2;
    t = clamp(t, 0.05, 0.95);
    const x = s.x1 + dx * t, z = s.z1 + dz * t;
    const d = Math.hypot(phys.pos.x - x, phys.pos.z - z);
    if (d < bd) { bd = d; best = { x, z, h: Math.atan2(dx, dz) }; }
  }
  phys.pos.set(best.x, groundH(best.x, best.z) + 0.1, best.z);
  phys.heading = best.h;
  phys.vel.set(0, 0); phys.vy = 0; phys.airborne = false;
  hud.msg('已回到赛道');
}

// ---------- 碰撞 ----------
const poleBuf = [];
function collide(dt) {
  const p = phys.pos, cr = CFG.car.radius;
  let hitHard = false;
  // 建筑 AABB
  for (const b of world.buildings) {
    if (p.x > b.x1 - cr && p.x < b.x2 + cr && p.z > b.z1 - cr && p.z < b.z2 + cr && p.y < b.h) {
      const dxl = p.x - (b.x1 - cr), dxr = (b.x2 + cr) - p.x;
      const dzl = p.z - (b.z1 - cr), dzr = (b.z2 + cr) - p.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) { p.x = b.x1 - cr; phys.vel.x = -Math.abs(phys.vel.x) * 0.25; }
      else if (m === dxr) { p.x = b.x2 + cr; phys.vel.x = Math.abs(phys.vel.x) * 0.25; }
      else if (m === dzl) { p.z = b.z1 - cr; phys.vel.y = -Math.abs(phys.vel.y) * 0.25; }
      else { p.z = b.z2 + cr; phys.vel.y = Math.abs(phys.vel.y) * 0.25; }
      hitHard = true;
    }
  }
  // 树/灯柱
  world.poles.query(p.x, p.z, poleBuf);
  for (const o of poleBuf) {
    const d = Math.hypot(p.x - o.x, p.z - o.z), rr = cr + o.r;
    if (d < rr && d > 0.001) {
      const nx = (p.x - o.x) / d, nz = (p.z - o.z) / d;
      p.x = o.x + nx * rr; p.z = o.z + nz * rr;
      const vn = phys.vel.x * nx + phys.vel.y * nz;
      if (vn < 0) { phys.vel.x -= vn * nx * 1.4; phys.vel.y -= vn * nz * 1.4; }
      hitHard = true;
    }
  }
  // 高速护栏
  const rail = world.checkRails(p, cr);
  if (rail) {
    const r = Math.hypot(p.x, p.z);
    const nx = p.x / r, nz = p.z / r;             // 径向向外
    const target = rail.side === 'inner' ? rail.rail + cr : rail.rail - cr;
    p.x = nx * target; p.z = nz * target;
    const vn = phys.vel.x * nx + phys.vel.y * nz;
    phys.vel.x -= vn * nx * 1.3; phys.vel.y -= vn * nz * 1.3;
  }
  // 海水：禁止下海——硬边界 + 推回 + 水花
  if (p.x > 742 && groundH(p.x, p.z) < -0.5) {
    p.x = Math.min(p.x, 742);
    if (phys.vel.x > 0) phys.vel.x = 0;
    phys.vel.multiplyScalar(Math.exp(-4 * dt));
    if (Math.random() < 0.5) smoke.emit(p.x - 1, p.y + 0.2, p.z, 1.6, 2.2, 0.8);
    const now = Date.now();
    if (!collide._seaMsg || now - collide._seaMsg > 3000) {
      collide._seaMsg = now;
      hud.msg('前浪滔天，回到岸上！', 1500);
    }
  }
  // 世界边界
  const rr = Math.hypot(p.x, p.z);
  if (rr > 1500) {
    const nx = p.x / rr, nz = p.z / rr;
    phys.vel.x -= nx * 30 * dt; phys.vel.y -= nz * 30 * dt;
  }
  // 交通车
  for (const c of traffic.cars) {
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d < 4.3 && d > 0.01) {
      const nx = (p.x - c.x) / d, nz = (p.z - c.z) / d;
      p.x = c.x + nx * 4.3; p.z = c.z + nz * 4.3;
      const vn = phys.vel.x * nx + phys.vel.y * nz;
      if (vn < 0) { phys.vel.x -= vn * nx * 1.5; phys.vel.y -= vn * nz * 1.5; }
      hitHard = true;
    }
  }
  if (hitHard && phys.speed > 8) {
    phys.crashImpulse = Math.min(1, phys.speed / 40);
    audio.thud();
    phys.vel.multiplyScalar(0.82);
  }
}

// ---------- 技巧分 ----------
function skills(dt) {
  const kmh = phys.speed * 3.6;
  if (kmh > topSpeed) topSpeed = kmh;
  // 漂移
  if (phys.drifting && kmh > 35) {
    driftChain += 40 * dt * (kmh / 100 + 0.4);
  } else if (driftChain > 30) {
    const pts = driftChain | 0;
    skillScore += pts;
    hud.msg(`漂移 +${pts}`);
    driftChain = 0;
  } else driftChain = 0;
  // 飞跃
  if (phys.airborne) airTime += dt;
  else if (airTime > 0.35) {
    const pts = (airTime * 160) | 0;
    skillScore += pts;
    hud.msg(`飞跃 +${pts}`);
    airTime = 0;
  } else airTime = 0;
  // 奖励牌
  for (const b of world.boards) {
    if (b.hit) continue;
    const dy = (phys.pos.y + 0.6) - b.y;
    if (Math.hypot(phys.pos.x - b.x, phys.pos.z - b.z) < b.r && Math.abs(dy) < 3) {
      b.hit = true;
      b.mesh.visible = false;
      boardsHit++;
      skillScore += 500;
      hud.msg(`奖励牌 +500（${boardsHit}/12）`, 2200);
      audio.blip(980);
      for (let i = 0; i < 10; i++) smoke.emit(b.x, b.y - 1, b.z, 2, 1.2, 0.9);
      save.flush();
    }
  }
  // 测速点
  for (const t of world.traps) {
    if (Math.hypot(phys.pos.x - t.x, phys.pos.z - t.z) < t.r) {
      if (kmh > t.record && kmh > 60) {
        t.record = kmh;
        const pts = (kmh * 2) | 0;
        skillScore += pts;
        hud.msg(`测速 ${kmh | 0} km/h  +${pts}`);
        audio.blip(660);
        save.flush();
      }
    }
  }
  save.flush();
  hud.setScore(skillScore, topSpeed, boardsHit);
}

// ---------- 相机 ----------
const camPos = new THREE.Vector3(0, 3, -8);
const camLook = new THREE.Vector3();
let fovCur = CFG.cam.fov;
function updateCamera(dt) {
  const f = phys.forward();
  const p = phys.pos;
  const speedN = clamp(phys.speed / CFG.car.nitroMax, 0, 1);
  let dist, up, lookAhead, lookUp;
  const portrait = camera.aspect < 0.8 ? 1.45 : 1;   // 竖屏拉远
  if (camMode === 0) { dist = 7.4 * portrait; up = 2.7 * portrait; lookAhead = 5; lookUp = 1.1; }
  else if (camMode === 2) { dist = 12 * portrait; up = 4.6 * portrait; lookAhead = 6; lookUp = 1; }
  if (camMode === 1) {
    // 引擎盖视角
    camPos.set(p.x + f.x * 0.55, p.y + 1.12, p.z + f.z * 0.55);
    camera.position.copy(camPos);
    camLook.set(p.x + f.x * 40, p.y + 0.8, p.z + f.z * 40);
    camera.lookAt(camLook);
  } else {
    const tx = p.x - f.x * dist, tz = p.z - f.z * dist;
    const ty = Math.max(p.y + up, groundH(tx, tz) + 1.2);
    const k = 1 - Math.exp(-5.5 * dt);
    camPos.x += (tx - camPos.x) * k;
    camPos.y += (ty - camPos.y) * k;
    camPos.z += (tz - camPos.z) * k;
    camera.position.copy(camPos);
    camLook.set(p.x + f.x * lookAhead, p.y + lookUp, p.z + f.z * lookAhead);
    camera.lookAt(camLook);
  }
  // 抖动
  const shake = phys.crashImpulse * 0.5 + (phys.nitroOn ? 0.06 : 0);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
  }
  // FOV
  const fovT = CFG.cam.fov + speedN * 15 + (phys.nitroOn ? 9 : 0);
  fovCur += (fovT - fovCur) * Math.min(1, 5 * dt);
  camera.fov = fovCur;
  camera.updateProjectionMatrix();
  fxPass.uniforms.uAmt.value = speedN * speedN + (phys.nitroOn ? 0.5 : 0);
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (!car) return;

  if (state === 'menu') {
    // 菜单：环绕展示车辆
    menuAngle += dt * 0.4;
    const p = phys.pos;
    camera.position.set(p.x + Math.cos(menuAngle) * 8.5, p.y + 2.4, p.z + Math.sin(menuAngle) * 8.5);
    camera.lookAt(p.x, p.y + 0.8, p.z);
  } else if (!paused) {
    input.update(dt);
    if (input.camPressed) { input.camPressed = false; cycleCam(); }
    phys.update(dt, input, groundInfo);
    collide(dt);
    skills(dt);

    // 车辆姿态
    car.group.position.copy(phys.pos);
    car.group.rotation.order = 'YXZ';
    car.group.rotation.y = phys.heading;
    car.group.rotation.x = -Math.atan(phys.slopePitch) * (phys.airborne ? 0 : 1);
    // 侧倾 = 坡度 + 转向离心（随速度） + 漂移额外倾角
    const spdN = clamp(phys.speed / CFG.car.maxSpeed, 0, 1);
    car.group.rotation.z = (phys.airborne ? 0 : Math.atan(phys.slopeRoll))
      - phys.steerVis * spdN * 0.045
      + phys.driftAmt * phys.steerVis * 0.07;
    // 刹车灯：踩刹车或手刹时点亮
    if (car.tail) car.tail.emissiveIntensity = (input.brake > 0 || input.handbrake) ? 9 : 2.2;
    // 车轮
    const spin = phys.vF * dt / 0.335;
    for (const k in car.wheels) {
      const w = car.wheels[k];
      if (!w.pivot || !w.spin) continue;
      if (k[0] === 'F') w.pivot.rotation.y = phys.steerVis;
      w.spin.rotation.x += spin;
    }
    // 胎痕 & 烟雾（后轮）
    const f = phys.forward();
    const rx = f.z, rz = -f.x;
    const rw = 0.8, back = -1.45;
    const y = phys.pos.y + (roadDist(phys.pos.x, phys.pos.z) < 0 ? 0.075 : 0.02);
    skids.lay(
      phys.pos.x + rx * rw + f.x * back, phys.pos.z + rz * rw + f.z * back,
      phys.pos.x - rx * rw + f.x * back, phys.pos.z - rz * rw + f.z * back,
      y, phys.heading, phys.driftAmt + (input.throttle && phys.speed < 8 ? 0.6 : 0));
    if (phys.driftAmt > 0.3) {
      smoke.emit(phys.pos.x + rx * rw + f.x * back, y, phys.pos.z + rz * rw + f.z * back, 0.5, 1.6, 1.2);
      smoke.emit(phys.pos.x - rx * rw + f.x * back, y, phys.pos.z - rz * rw + f.z * back, 0.5, 1.6, 1.2);
    }
    if (phys.landedImpact > 3) {
      for (let i = 0; i < 8; i++) smoke.emit(phys.pos.x, phys.pos.y, phys.pos.z, 2.4, 1.8, 1);
      phys.landedImpact = 0;
    }
    smoke.update(dt);
    flames.update(dt, phys.nitroOn, clamp(phys.speed / CFG.car.nitroMax, 0, 1));

    // 交通 & 擦身
    traffic.update(dt, phys.pos, () => {
      if (phys.speed * 3.6 > 80) {
        skillScore += 150;
        hud.msg('擦身而过 +150', 900);
        audio.blip(1200);
        return true;
      }
      return false;
    });

    // 太阳阴影跟随车辆
    const sun = world.sunLight;
    const sd = sun.position.clone().normalize();
    sun.target.position.set(Math.round(phys.pos.x / 4) * 4, 0, Math.round(phys.pos.z / 4) * 4);
    sun.position.copy(sun.target.position).addScaledVector(sd, 320);

    updateCamera(dt);
    // 音效：7 段变速箱转速曲线，升挡转速回落
    const vAbs = Math.abs(phys.vF);
    const GEARS = [0, 13, 24, 37, 52, 70, 92];
    let rpm;
    let gi = 1;
    if (phys.speed < 0.5) rpm = 0.18 + (input.throttle > 0 ? 0.15 : 0);
    else {
      while (gi < 6 && vAbs > GEARS[gi]) gi++;
      rpm = 0.3 + 0.7 * (vAbs - GEARS[gi - 1]) / (GEARS[gi] - GEARS[gi - 1]);
    }
    audio.update(
      clamp(rpm + (input.throttle > 0 ? 0.06 : 0), 0, 1),
      phys.driftAmt, clamp(phys.speed / CFG.car.nitroMax, 0, 1), phys.nitroOn);
    // HUD
    if (!NOUI) {
      const gearN = phys.vF < -0.5 ? 'R' : (phys.speed < 0.5 ? 'N' : String(gi));
      hud.drawSpeedo(phys.speed * 3.6, phys.nitro, phys.nitroOn, gearN, phys.drifting);
      hud.drawMinimap(phys.pos.x, phys.pos.z, phys.heading, world.boards);
    }
  }

  world.update(dt, t);
  composer.render();
  if (++frames === 3) window.__ready = true;
}
loop();

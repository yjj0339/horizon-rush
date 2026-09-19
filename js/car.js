import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============ 载具加载（Blender 生成的 GLB） ============
// 返回 { car: 玩家超跑, sedan: 交通车模板 }
export function loadVehicles() {
  const loader = new GLTFLoader();
  const load = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  return Promise.all([load('assets/car.glb'), load('assets/sedan.glb')]).then(([carG, sedanG]) => {
    const car = prepareCar(carG.scene);
    const sedan = sedanG.scene;
    sedan.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { car, sedan };
  });
}

function prepareCar(scene) {
  const wheels = {};
  const mats = {};
  scene.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      if (o.material && o.material.name) mats[o.material.name] = o.material;
    }
    const m = /^Wheel(FL|FR|RL|RR)$/.exec(o.name);
    if (m) (wheels[m[1]] = wheels[m[1]] || {}).pivot = o;
    const s = /^Spin(FL|FR|RL|RR)$/.exec(o.name);
    if (s) (wheels[s[1]] = wheels[s[1]] || {}).spin = o;
  });
  const paint = mats.Paint, glass = mats.Glass, tail = mats.Tail;
  // 提升车漆/玻璃质感（GLB PBR 之上微调）
  if (paint) {
    paint.clearcoat = 0.8; paint.clearcoatRoughness = 0.08;
    paint.metalness = 0.15; paint.roughness = 0.3;
    paint.envMapIntensity = 0.7;
  }
  if (glass) { glass.envMapIntensity = 1.6; glass.roughness = 0.06; }
  if (tail) { tail.emissiveIntensity = 2.2; }   // 刹车时由 main 调亮

  // 霓虹底盘灯
  const glowCv = document.createElement('canvas');
  glowCv.width = glowCv.height = 128;
  const gg = glowCv.getContext('2d');
  const grd = gg.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(glowCv);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 5.8),
    new THREE.MeshBasicMaterial({
      map: glowTex, color: 0x22ccff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  glow.visible = false;
  scene.add(glow);

  return { group: scene, wheels, paint, tail, glow };
}

export function setPaint(car, hex) {
  if (car.paint) car.paint.color.setHex(hex);
}

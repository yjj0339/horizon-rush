import * as THREE from 'three';

// 确定性随机数（世界生成可复现）
export function RNG(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 2D 值噪声（平滑插值）
const hash2 = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0; h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};
const fade = t => t * t * (3 - 2 * t);
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v; // 0..1
}
export function fbm(x, y, oct = 3) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); amp *= 0.5; f *= 2.03; }
  return s; // ~0..1
}

// 创建 canvas 纹理
export function canvasTex(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(opts.repeat[0], opts.repeat[1]); }
  tex.anisotropy = opts.aniso || 4;
  return tex;
}

// 柔和圆点纹理（粒子用）
export function softDotTex(size = 64) {
  return canvasTex(size, size, (g) => {
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
  });
}

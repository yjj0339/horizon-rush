// ============ 道路/地图布局（世界生成的单一数据源） ============
import { CFG } from './config.js';

const C = CFG.city;                       // 城市 {cx, cz, pitch, roadW, n}
const HALF = (C.n * C.pitch + C.roadW) / 2;   // 城市外缘 343

// 城市街道（轴对齐线段，宽度 roadW）
export const CITY_STREETS = [];
for (let i = 0; i <= C.n; i++) {
  const off = -HALF + C.roadW / 2 + i * C.pitch;
  CITY_STREETS.push({ x1: C.cx + off, z1: -HALF, x2: C.cx + off, z2: HALF, w: C.roadW }); // 纵街
  CITY_STREETS.push({ x1: C.cx - HALF, z1: off, x2: C.cx + HALF, z2: off, w: C.roadW });   // 横街
}
export const CITY_EXT = { x1: C.cx - HALF, z1: -HALF, x2: C.cx + HALF, z2: HALF };

const RING = CFG.ring; // {r, w}
// 放射大道
export const AVENUES = [
  { x1: C.cx + HALF, z1: 0, x2: CFG.coast.roadX, z2: 0, w: 20 },        // 东：城市→海岸路
  { x1: C.cx - HALF, z1: 0, x2: -(RING.r + RING.w / 2 + 4), z2: 0, w: 20 }, // 西
  { x1: C.cx, z1: -HALF, x2: C.cx, z2: -588, w: 20 },                   // 北
  { x1: C.cx, z1: HALF, x2: C.cx, z2: 588, w: 20 },                     // 南
];
// 嘉年华支路
export const FEST_ROAD = { x1: C.cx, z1: 470, x2: CFG.fest.x, z2: 470, w: 16 };
// 海岸公路
export const COAST_ROAD = { x1: CFG.coast.roadX, z1: -800, x2: CFG.coast.roadX, z2: 800, w: CFG.coast.roadW };

// 环线高速出入缺口（弧度，圆心为世界原点）
export const RING_GAPS = [0, Math.PI, Math.atan2(566, C.cx), Math.atan2(-566, C.cx)];

// 点到线段距离
function segDist(x, z, s) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((x - s.x1) * dx + (z - s.z1) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = s.x1 + dx * t, pz = s.z1 + dz * t;
  return Math.hypot(x - px, z - pz);
}

// 到最近道路表面的距离（<0 表示在路上）
export function roadDist(x, z) {
  let d = Infinity;
  for (const s of CITY_STREETS) d = Math.min(d, segDist(x, z, s) - s.w / 2);
  for (const s of AVENUES) d = Math.min(d, segDist(x, z, s) - s.w / 2);
  d = Math.min(d, segDist(x, z, FEST_ROAD) - FEST_ROAD.w / 2);
  d = Math.min(d, segDist(x, z, COAST_ROAD) - COAST_ROAD.w / 2);
  const r = Math.hypot(x, z);
  d = Math.min(d, Math.abs(r - RING.r) - RING.w / 2);
  // 嘉年华会场（铺装广场）
  d = Math.min(d, Math.hypot(x - CFG.fest.x, z - CFG.fest.z) - CFG.fest.r);
  return d;
}

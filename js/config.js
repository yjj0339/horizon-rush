// ============ 全局配置 ============
export const CFG = {
  // 世界尺寸（米）
  worldR: 1650,          // 可玩半径
  groundR: 1750,         // 地形圆盘半径
  flatR: 700,            // 中心平坦区

  // 城市网格
  city: { cx: -260, cz: 0, pitch: 110, roadW: 26, n: 6 }, // n×n 街区
  get cityHalf() { return (this.city.n * this.city.pitch + this.city.roadW) / 2; },

  // 环线高速
  ring: { r: 620, w: 36 },

  // 海岸
  coast: { roadX: 655, roadW: 18, beachX: 692, seaX: 760, seaY: -0.65 },

  // 嘉年华会场
  fest: { x: 60, z: 560, r: 120 },

  // 车辆
  car: {
    accel: 26,           // 引擎加速度 m/s²
    nitroAccel: 16,      // 氮气附加
    brake: 34,
    maxSpeed: 78,        // ~280 km/h
    nitroMax: 92,        // ~330 km/h
    grip: 7.5,           // 侧向抓地
    driftGrip: 2.0,      // 手刹漂移抓地
    steerMax: 0.62,      // 最大前轮角 rad
    radius: 2.3,         // 碰撞半径
  },

  // 相机
  cam: { fov: 62, chaseBack: 7.4, chaseUp: 2.7 },

  paints: [
    { name: '烈焰红', c: 0xd42a1e }, { name: '电光蓝', c: 0x1a6fe0 },
    { name: '竞速黄', c: 0xf2b705 }, { name: '珍珠白', c: 0xeef0f2 },
    { name: '霓虹紫', c: 0x8a2be2 }, { name: '海湾青', c: 0x12b5a8 },
  ],
};
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

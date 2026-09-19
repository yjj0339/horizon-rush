// ============ HUD：速度表 / 小地图 / 提示 ============
export class HUD {
  constructor(world) {
    this.world = world;
    this.cv = document.getElementById('speedo-cv');
    this.g = this.cv.getContext('2d');
    this.mm = document.getElementById('minimap').getContext('2d');
    this.msgEl = document.getElementById('msg');
    this.msgTimer = null;
    this.$ = id => document.getElementById(id);
  }

  msg(text, ms = 1800) {
    this.msgEl.textContent = text;
    this.msgEl.classList.add('show');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.msgEl.classList.remove('show'), ms);
  }

  setScore(skill, top, boards) {
    this.$('skill-score').textContent = skill | 0;
    this.$('top-speed').textContent = top | 0;
    this.$('boards').textContent = boards;
  }

  // 速度表：浅色圆盘 + 指针 + 数字 + 氮气弧
  drawSpeedo(speedKmh, nitro, nitroOn, gear, drifting) {
    const g = this.g, W = 240, cx = 120, cy = 128, R = 96;
    g.clearRect(0, 0, W, W);
    // 底盘
    g.beginPath(); g.arc(cx, cy, R + 14, 0, 7);
    g.fillStyle = 'rgba(248,250,252,0.88)'; g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
    // 刻度
    const a0 = Math.PI * 0.82, a1 = Math.PI * 2.18;
    const maxV = 320;
    g.font = '700 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= maxV; v += 20) {
      const a = a0 + (a1 - a0) * v / maxV;
      const big = v % 40 === 0;
      const r1 = R - (big ? 14 : 8), r2 = R - 3;
      g.strokeStyle = big ? '#33465e' : '#8fa0b0';
      g.lineWidth = big ? 3 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.stroke();
      if (big) {
        g.fillStyle = '#33465e';
        g.fillText(v, cx + Math.cos(a) * (R - 27), cy + Math.sin(a) * (R - 27));
      }
    }
    // 氮气弧（外圈）
    g.beginPath();
    g.arc(cx, cy, R + 7, a0, a0 + (a1 - a0) * nitro / 100);
    g.strokeStyle = nitroOn ? '#38c8ff' : '#7fb8d8';
    g.lineWidth = 5; g.stroke();
    // 速度红区指针
    const a = a0 + (a1 - a0) * Math.min(speedKmh, maxV) / maxV;
    g.beginPath();
    g.moveTo(cx + Math.cos(a + Math.PI / 2) * 5, cy + Math.sin(a + Math.PI / 2) * 5);
    g.lineTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18));
    g.lineTo(cx + Math.cos(a - Math.PI / 2) * 5, cy + Math.sin(a - Math.PI / 2) * 5);
    g.fillStyle = drifting ? '#f2571f' : '#e63329';
    g.fill();
    g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fillStyle = '#33465e'; g.fill();
    // 数字
    g.fillStyle = '#17304a';
    g.font = '900 40px sans-serif';
    g.fillText(speedKmh | 0, cx, cy + 46);
    g.font = '700 12px sans-serif';
    g.fillStyle = '#7c8a99';
    g.fillText('km/h', cx, cy + 68);
    // 档位
    g.font = '900 20px sans-serif';
    g.fillStyle = nitroOn ? '#1899d8' : '#f2571f';
    g.fillText(nitroOn ? 'N2O' : gear, cx, cy - 34);
  }

  // 小地图：以北为上，跟随车辆
  drawMinimap(px, pz, heading, boards) {
    const g = this.mm, W = 196;
    const { mapCanvas, mapScale } = { mapCanvas: this.world.mapCanvas, mapScale: this.world.mapScale };
    g.clearRect(0, 0, W, W);
    const viewM = 640;                          // 视野范围（米）
    const s = mapScale.S;                       // 底图 米→px
    const sx = (px + 1700) * s - viewM * s / 2, sz = (pz + 1700) * s - viewM * s / 2;
    g.imageSmoothingEnabled = true;
    g.drawImage(mapCanvas, sx, sz, viewM * s, viewM * s, 0, 0, W, W);
    // 奖励牌
    g.fillStyle = '#f2a50d';
    for (const b of boards) {
      if (b.hit) continue;
      const bx = (b.x - px) / viewM * W + W / 2, bz = (b.z - pz) / viewM * W + W / 2;
      if (bx < 4 || bx > W - 4 || bz < 4 || bz > W - 4) continue;
      g.beginPath(); g.arc(bx, bz, 3.4, 0, 7); g.fill();
    }
    // 车辆箭头
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(Math.PI - heading); // 底图z向下，车头朝实际行驶方向
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6);
    g.closePath();
    g.fillStyle = '#e63329'; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
  }
}

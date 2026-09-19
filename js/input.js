// ============ 输入：键盘 + 触屏 + 手柄（线性油门/刹车） ============
export class Input {
  constructor() {
    this.keys = {};
    this.touch = { l: false, r: false, g: false, b: false, n: false };
    this.steer = 0;                       // 平滑后的转向 -1..1
    this.camPressed = false;              // 手柄视角键边沿
    this.isTouch = (('ontouchstart' in window) && matchMedia('(pointer:coarse)').matches)
      || new URLSearchParams(location.search).get('touch') === '1';
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    if (this.isTouch) {
      document.body.classList.add('touch');
      this.bindTouch();
    }
  }
  bindTouch() {
    document.getElementById('touch').classList.remove('hidden');
    const bind = (id, key) => {
      const el = document.getElementById(id);
      const on = e => { e.preventDefault(); this.touch[key] = true; el.classList.add('on'); };
      const off = e => { e.preventDefault(); this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
    };
    bind('t-l', 'l'); bind('t-r', 'r'); bind('t-g', 'g'); bind('t-b', 'b'); bind('t-n', 'n');
  }
  // ---- 手柄（Xbox 布局：RT=7 油门 LT=6 刹车 左摇杆转向 A=0 手刹 X=2 氮气 Y=3 视角） ----
  pollGamepad() {
    this.gp = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) { this.gp = p; break; }
    if (!this.gp) return;
    const g = this.gp;
    const ax = g.axes[0] || 0;
    this.gpSteer = Math.abs(ax) > 0.12 ? ax : 0;
    this.gpThrottle = g.buttons[7] ? g.buttons[7].value : 0;
    this.gpBrake = g.buttons[6] ? g.buttons[6].value : 0;
    this.gpHand = !!(g.buttons[0] && g.buttons[0].pressed);
    this.gpNitro = !!(g.buttons[2] && g.buttons[2].pressed);
    const y = !!(g.buttons[3] && g.buttons[3].pressed);
    if (y && !this._yPrev) this.camPressed = true;
    this._yPrev = y;
  }
  get throttle() {
    const k = (this.keys.KeyW || this.keys.ArrowUp || this.touch.g) ? 1 : 0;
    return Math.max(k, this.gp ? this.gpThrottle : 0);
  }
  get brake() {
    const k = (this.keys.KeyS || this.keys.ArrowDown || this.touch.b) ? 1 : 0;
    return Math.max(k, this.gp ? this.gpBrake : 0);
  }
  get handbrake() {
    if (this.keys.Space) return true;
    if (this.gp && this.gpHand) return true;
    return false;
  }
  get nitro() {
    if (this.keys.ShiftLeft || this.keys.ShiftRight || this.touch.n) return true;
    return !!(this.gp && this.gpNitro);
  }
  steerTarget() {
    const l = this.keys.KeyA || this.keys.ArrowLeft || this.touch.l;
    const r = this.keys.KeyD || this.keys.ArrowRight || this.touch.r;
    const k = (l ? -1 : 0) + (r ? 1 : 0);
    if (k !== 0) return k;
    if (this.gp && this.gpSteer) return this.gpSteer;
    return 0;
  }
  update(dt) {
    this.pollGamepad();
    // 键盘/触屏转向做平滑，手柄摇杆直接给目标值
    const t = this.steerTarget();
    const speed = Math.abs(t) === 1 ? (t !== 0 ? 4.5 : 6.5) : 14; // 摇杆跟随更快
    this.steer += Math.sign(t - this.steer) * Math.min(Math.abs(t - this.steer), speed * dt);
  }
}

// ============ 输入：键盘 + 触屏 ============
export class Input {
  constructor() {
    this.keys = {};
    this.touch = { l: false, r: false, g: false, b: false, n: false };
    this.steer = 0;                       // 平滑后的转向 -1..1
    this.isTouch = (('ontouchstart' in window) && matchMedia('(pointer:coarse)').matches)
      || new URLSearchParams(location.search).get('touch') === '1';
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    if (this.isTouch) this.bindTouch();
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
  get throttle() { return (this.keys.KeyW || this.keys.ArrowUp || this.touch.g) ? 1 : 0; }
  get brake() { return (this.keys.KeyS || this.keys.ArrowDown || this.touch.b) ? 1 : 0; }
  get handbrake() { return !!this.keys.Space; }
  get nitro() { return !!(this.keys.ShiftLeft || this.keys.ShiftRight || this.touch.n); }
  steerTarget() {
    const l = this.keys.KeyA || this.keys.ArrowLeft || this.touch.l;
    const r = this.keys.KeyD || this.keys.ArrowRight || this.touch.r;
    return (l ? -1 : 0) + (r ? 1 : 0);
  }
  update(dt) {
    // 键盘转向做平滑，模拟方向盘
    const t = this.steerTarget();
    const speed = t !== 0 ? 4.5 : 6.5;
    this.steer += Math.sign(t - this.steer) * Math.min(Math.abs(t - this.steer), speed * dt);
  }
}

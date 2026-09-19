// ============ 程序化音效：引擎 / 胎响 / 氮气 / 风 ============
export class GameAudio {
  constructor() {
    this.ctx = null; this.muted = false; this.started = false;
  }
  ensure() {
    if (this.ctx || this.muted) return;
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = this.master = ctx.createGain();
      master.gain.value = 0.5; master.connect(ctx.destination);

      // 引擎：双锯齿波 + 低通
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      this.engLP = lp;
      this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
      this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      this.osc1.frequency.value = 70; this.osc2.frequency.value = 35;
      this.osc1.connect(lp); this.osc2.connect(g2); g2.connect(lp);
      lp.connect(this.engGain); this.engGain.connect(master);
      this.osc1.start(); this.osc2.start();

      // 噪声源（胎响/风/氮气共用白噪声）
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;

      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.2;
      this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
      noise.connect(bp); bp.connect(this.skidGain); this.skidGain.connect(master);

      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 500;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      noise.connect(lp2); lp2.connect(this.windGain); this.windGain.connect(master);

      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      this.nitroGain = ctx.createGain(); this.nitroGain.gain.value = 0;
      noise.connect(hp); hp.connect(this.nitroGain); this.nitroGain.connect(master);
      noise.start();
      this.started = true;
    } catch (e) { /* 无音频环境 */ }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
  // rpmN: 0..1, drift: 0..1, speedN: 0..1, nitro: bool
  update(rpmN, drift, speedN, nitro) {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const f = 65 + rpmN * 210;
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engLP.frequency.setTargetAtTime(500 + rpmN * 2600, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.10 + rpmN * 0.16, t, 0.05);
    this.skidGain.gain.setTargetAtTime(drift * 0.22, t, 0.05);
    this.windGain.gain.setTargetAtTime(speedN * speedN * 0.30, t, 0.1);
    this.nitroGain.gain.setTargetAtTime(nitro ? 0.10 : 0, t, 0.06);
  }
  blip(freq = 880) { // 奖励牌 / 测速提示音
    if (!this.started || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }
  thud() { // 碰撞闷响
    if (!this.started || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.32);
  }
}

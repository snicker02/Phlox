// Phlox — audio graph: flame-voice worklet → dry/reverb → master → limiter → out (+ record taps)

export class AudioEngine {
  constructor(version) {
    this.version = version;
    this.ready = false;
    this.onTrails = null;
    this.queue = [];
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !('audioWorklet' in AC.prototype)) throw new Error('This browser has no AudioWorklet support.');
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(new URL(`./phlox-worklet.js?v=${this.version}`, import.meta.url));
    const node = this.node = new AudioWorkletNode(ctx, 'phlox-voice', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = (e) => { if (e.data.type === 'trails' && this.onTrails) this.onTrails(e.data.voices); };
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.verb = ctx.createConvolver();
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 4; this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    node.connect(this.dry); node.connect(this.verb); this.verb.connect(this.wet);
    this.dry.connect(this.master); this.wet.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.streamDest = ctx.createMediaStreamDestination();
    this.limiter.connect(this.streamDest);
    this.tap = new AudioWorkletNode(ctx, 'phlox-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
    const sink = ctx.createGain(); sink.gain.value = 0;
    this.limiter.connect(this.tap); this.tap.connect(sink); sink.connect(ctx.destination);
    this.ready = true;
    for (const [m, t] of this.queue) this.post(m, t);
    this.queue = [];
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  post(msg, transfer) {
    if (!this.ready) { if (msg.type === 'patch' || msg.type === 'params' || msg.type === 'os') this.queue.push([msg, transfer]); return; }
    this.node.port.postMessage(msg, transfer || []);
  }

  setMix(reverb, volume) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(reverb * 0.9, t, 0.03);
    this.dry.gain.setTargetAtTime(1 - reverb * 0.55, t, 0.03);
    this.master.gain.setTargetAtTime(volume, t, 0.03);
  }

  setRoom(seconds) {
    if (!this.ready) return;
    const sr = this.ctx.sampleRate, n = Math.max(1, Math.floor(sr * seconds));
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let s = 1234 + ch * 777, lp = 0;
      for (let i = 0; i < n; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const w = s / 4294967296 * 2 - 1;
        const t = i / sr;
        lp += (w - lp) * (0.55 - 0.4 * (t / seconds)); // darker tail
        const env = Math.exp(-6.9 * t / seconds) * (t < 0.004 ? t / 0.004 : 1);
        d[i] = lp * env * 0.6;
      }
    }
    this.verb.buffer = buf;
  }
}

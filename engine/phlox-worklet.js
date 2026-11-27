// Phlox v1.2.1 — polyphonic flame-voice AudioWorklet (four engines).
// Voices run 4× (High) or 2× (Light) oversampled (192 kHz at 48 kHz) and the mix is decimated with a Kaiser FIR,
// so the rings start without aliasing. A smooth peak limiter keeps chords from clipping.
import { preparePatch, makeVoice, Decimator, OS } from './flame.js';
import { renderAny } from './engines.js';

const MAXV = 8;

class PhloxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = Array.from({ length: MAXV }, (_, i) => makeVoice(i + 11));
    this.patch = null;
    this.norm = 1; this.normTarget = 1;
    this.cx = 0; this.cy = 0; this.cxT = 0; this.cyT = 0;
    this.g = {
      engine: 'voice', ring: 0.35, detail: 32, sr: sampleRate * OS, os: OS, throat: 2400, body: 0.15, breath: 0.03, address: 0, bloom: 0.4,
      attack: 0.04, decay: 0.5, sustain: 0.75, release: 0.7, glide: 0.05, vibRate: 5.2, vibDepth: 14, vibDelay: 0.35,
    };
    this.width = 0.8; this.drive = 0.1;
    this.setOS(OS);
    this.L = new Float32Array(128); this.R = new Float32Array(128);
    this.dcL = 0; this.dcR = 0; this.xl = 0; this.xr = 0;
    this.lim = 1;
    this.trailBuf = Array.from({ length: MAXV }, () => new Float32Array(1200));
    this.trailLen = new Int32Array(MAXV);
    this.trailProxy = Array.from({ length: MAXV }, (_, k) => ({ push: (x, y) => { const n = this.trailLen[k]; if (n < 1198) { this.trailBuf[k][n] = x; this.trailBuf[k][n + 1] = y; this.trailLen[k] = n + 2; } } }));
    this.tick = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  setOS(os) {
    this.os = os; this.g.sr = sampleRate * os; this.g.os = os;
    this.decL = new Decimator(os); this.decR = new Decimator(os);
    this.hL = new Float32Array(128 * os); this.hR = new Float32Array(128 * os);
    for (const v of this.voices) { v.mKey = -1; v.mPatch = null; }
  }

  find(id) { return this.voices.find(v => v.active && v.id === id && !v.rel); }

  onMsg(d) {
    switch (d.type) {
      case 'patch': {
        this.patch = preparePatch(d.P, { ring: d.ring, norm: 1 });
        this.cxT = this.patch.cx; this.cyT = this.patch.cy;
        this.normTarget = d.norm;
        if (d.jump) { this.norm = d.norm; this.cx = this.cxT; this.cy = this.cyT; }
        break;
      }
      case 'os': if ((d.os === 2 || d.os === 4) && d.os !== this.os) this.setOS(d.os); break;
      case 'params':
        if (d.g) {
          const g = Object.assign({}, d.g); delete g.sr; delete g.os;
          if (g.engine && g.engine !== this.g.engine) for (const v of this.voices) { v.active = false; v.env = 0; v.started = false; } // engines keep different voice state
          Object.assign(this.g, g);
        }
        if (d.width != null) this.width = d.width;
        if (d.drive != null) this.drive = d.drive;
        break;
      case 'on': {
        let v = this.find(d.id);
        if (!v) v = this.voices.find(x => !x.active) || this.voices.filter(x => x.rel).sort((a, b) => a.env - b.env)[0] || this.voices.slice().sort((a, b) => b.age - a.age)[0];
        const wasActive = v.active;
        v.active = true; v.rel = false; v.stage = 0; v.id = d.id; v.age = 0; v.vibT = 0;
        if (!wasActive) { v.env = 0; v.f = d.f; v.started = false; v.order = null; v.period = 0; v.phase = 0; }
        else v.strikeReq = true; // re-strike a ringing bell
        v.fTarget = d.f; v.vel = d.vel ?? 1; v.kmod = d.kmod ?? 1;
        break;
      }
      case 'set': { const v = this.find(d.id); if (v) { if (d.f) v.fTarget = d.f; if (d.kmod) v.kmod = d.kmod; if (d.vel != null) v.vel = d.vel; } break; }
      case 'off': { for (const v of this.voices) if (v.active && v.id === d.id) v.rel = true; break; }
      case 'allOff': for (const v of this.voices) if (v.active) v.rel = true; break;
      case 'panic': for (const v of this.voices) { v.active = false; v.env = 0; } break;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
    const OSr = this.os;
    if (this.L.length !== n || this.hL.length !== n * OSr) { this.L = new Float32Array(n); this.R = new Float32Array(n); this.hL = new Float32Array(n * OSr); this.hR = new Float32Array(n * OSr); }
    const hL = this.hL, hR = this.hR, L = this.L, R = this.R;
    hL.fill(0); hR.fill(0);
    // smooth loudness + centre across live patch edits (no steps while dragging triangles)
    this.norm += (this.normTarget - this.norm) * 0.08;
    this.cx += (this.cxT - this.cx) * 0.08; this.cy += (this.cyT - this.cy) * 0.08;
    const p = this.patch;
    const voiceEngine = this.g.engine === 'voice';
    if (p) {
      p.norm = this.norm; p.cx = this.cx; p.cy = this.cy;
      if (voiceEngine) for (let k = 0; k < MAXV; k++) { const v = this.voices[k]; if (v.active) renderAny(v, p, this.g, hL, hR, n * OSr, this.trailProxy[k]); }
    }
    this.decL.process(hL, L); this.decR.process(hR, R);
    if (p && !voiceEngine) { // bell / orbit / cloud are band-limited by construction: base rate
      const gb = this.gBase || (this.gBase = {});
      Object.assign(gb, this.g); gb.sr = sampleRate; gb.os = 1;
      for (let k = 0; k < MAXV; k++) { const v = this.voices[k]; if (v.active) renderAny(v, p, gb, L, R, n, this.trailProxy[k]); }
    }
    const w = this.width, dr = this.drive, dk = 1 + dr * 6, dn = dr > 0 ? 1 / Math.tanh(dk) : 1;
    let lim = this.lim;
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i];
      const m = (l + r) * 0.5, s = (l - r) * 0.5 * w;
      l = m + s; r = m - s;
      const yl = l - this.xl + 0.9985 * this.dcL; this.xl = l; this.dcL = yl;
      const yr = r - this.xr + 0.9985 * this.dcR; this.xr = r; this.dcR = yr;
      l = dr > 0 ? Math.tanh(yl * dk) * dn * 0.85 : yl;
      r = dr > 0 ? Math.tanh(yr * dk) * dn * 0.85 : yr;
      // peak limiter: fast attack (~0.3 ms), slow release (~250 ms), ceiling 0.9
      const pk = Math.max(Math.abs(l), Math.abs(r)), tgt = pk * lim > 0.9 ? 0.9 / pk : 1;
      lim += (tgt - lim) * (tgt < lim ? 0.3 : 0.00008);
      l *= lim; r *= lim;
      // final safety: soft knee above 0.95, never a hard clip
      if (l > 0.95) l = 0.95 + 0.05 * Math.tanh((l - 0.95) * 20); else if (l < -0.95) l = -0.95 - 0.05 * Math.tanh((-l - 0.95) * 20);
      if (r > 0.95) r = 0.95 + 0.05 * Math.tanh((r - 0.95) * 20); else if (r < -0.95) r = -0.95 - 0.05 * Math.tanh((-r - 0.95) * 20);
      oL[i] = l; oR[i] = r;
    }
    this.lim = lim;
    if (++this.tick >= 10) { // ~27 ms: ship orbit trails for the visuals
      this.tick = 0;
      const msg = [];
      for (let k = 0; k < MAXV; k++) {
        const v = this.voices[k], len = this.trailLen[k];
        if (v.active && len) msg.push({ k, id: v.id, env: v.env, f: v.f, pts: this.trailBuf[k].slice(0, len) });
        this.trailLen[k] = 0;
      }
      this.port.postMessage({ type: 'trails', voices: msg });
    }
    return true;
  }
}

class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.bufL = []; this.bufR = []; this.count = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.bufL = []; this.bufR = []; this.count = 0; }
      if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ type: 'done' }); }
    };
  }
  flush() {
    if (!this.bufL.length) return;
    const n = this.bufL.reduce((a, b) => a + b.length, 0);
    const l = new Float32Array(n), r = new Float32Array(n);
    let o = 0;
    for (let i = 0; i < this.bufL.length; i++) { l.set(this.bufL[i], o); r.set(this.bufR[i], o); o += this.bufL[i].length; }
    this.bufL = []; this.bufR = []; this.count = 0;
    this.port.postMessage({ type: 'chunk', l, r }, [l.buffer, r.buffer]);
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    if (outputs[0] && outputs[0][0]) outputs[0][0].fill(0);
    if (this.on && inp && inp[0]) {
      this.bufL.push(Float32Array.from(inp[0]));
      this.bufR.push(Float32Array.from(inp[1] || inp[0]));
      this.count += inp[0].length;
      if (this.count >= 16384) this.flush();
    }
    return true;
  }
}

registerProcessor('phlox-voice', PhloxProcessor);
registerProcessor('phlox-tap', TapProcessor);

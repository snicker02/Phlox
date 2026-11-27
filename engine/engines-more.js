// Phlox v1.3.0 — three more sound engines, each reading the flame a different way.
//   string : waveguide string — the flame's orbit outline is the pluck shape (two polarisations = x, y),
//            every transform is a dispersion stage in the loop (rotation → stiffness), plucked, picked,
//            hammered, bowed or fed back
//   pulse  : rhythm — a step clock drives the chaos game; every transform is a tuned drum
//            (rotation → pitch, size → decay, position → pan and accent)
//   scan   : spectral scanner — the flame's density image is read like a spectrogram: a line sweeps
//            across the picture and its brightness, bottom to top, sets the partials' loudness
import { applyXf } from './flame.js';
import { orbitSpectrum } from './engines.js';

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;
function rnd(v) { let s = v.rng; s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; v.rng = s; return s / 4294967296; }
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const THUEN = (k, n) => { let s = 0; k = Math.abs(k); while (k) { s += k % n; k = Math.floor(k / n); } return s % n; };
function pickW(w, t) { let i = 0; for (; i < w.length - 1; i++) { t -= w[i]; if (t < 0) break; } return i; }
function wsum(patch, f) { let s = 0; for (let i = 0; i < patch.n; i++) s += patch.w[i] * f(patch.R[i], i); return s; }

// ===================== STRING =====================
const SLEN = 4096, SMASK = SLEN - 1;
function stringData(patch, g) {
  const key = `${g.throat}|${g.body}|${g.bloom}|${g.ring}`;
  if (patch._sk === key) return patch._sd;
  // pluck shape: the periodic orbit outline, band-limited (complex table → two polarisations)
  const o = patch._sShape || (patch._sShape = orbitSpectrum(patch, { address: 1, detail: 48, body: 0.55 }));
  const n = patch.n, disp = clamp((g.throat - 300) / 5700, 0, 1);
  const ap = new Float64Array(n);
  for (let i = 0; i < n; i++) ap[i] = -0.9 * disp * (0.2 + 0.8 * Math.abs(patch.R[i].rot) / 180);
  const rotW = wsum(patch, r => r.rot);
  const aniso = wsum(patch, r => Math.abs(Math.log(Math.max(0.05, Math.hypot(r.s00, r.s10)) / Math.max(0.05, Math.hypot(r.s01, r.s11)))));
  const sMean = wsum(patch, r => Math.min(1.2, r.s));
  const d = {
    o, ap, n,
    t60: (0.2 + 14 * g.ring * g.ring) * (0.45 + 0.55 * sMean),
    lpB: 0.01 + 0.235 * (1 - g.body) * (1 - g.body),      // loop damping: dark (felt) … bright (steel)
    couple: g.bloom * 0.5 * (rotW < 0 ? -1 : 1) * (0.35 + 0.65 * Math.min(1, Math.abs(rotW) / 90)), // polarisation rotation per period (rad)
    detune: g.bloom * 0.0035 * (0.4 + Math.min(1.5, aniso)), // y polarisation slightly sharper → beating
  };
  patch._sk = key; patch._sd = d;
  return d;
}
function apDelay(a, w) { // phase delay (samples) of (a + z⁻¹)/(1 + a·z⁻¹) at ω
  const s = Math.sin(w), c = Math.cos(w);
  return -(Math.atan2(-s, a + c) - Math.atan2(-a * s, 1 + a * c)) / w;
}
function readFrac(b, pos) { // Catmull–Rom read from the circular line
  const fl = Math.floor(pos), f = pos - fl, i = fl & SMASK;
  const a = b[(i - 1) & SMASK], x0 = b[i], x1 = b[(i + 1) & SMASK], x2 = b[(i + 2) & SMASK];
  return x0 + 0.5 * f * (x1 - a + f * (2 * a - 5 * x0 + 4 * x1 - x2 + f * (3 * (x0 - x1) + x2 - a)));
}
function tuneString(v, d, sr) {
  const n = Math.min(8, d.n), w0 = TAU * v.f / sr;
  for (let p = 0; p < 2; p++) {
    const N0 = sr / (v.f * (p ? 1 + d.detune : 1));
    let k = 1, sum = 0;
    for (let it = 0; it < 12; it++) { // keep the dispersion stages inside the period
      sum = 0; for (let i = 0; i < n; i++) sum += apDelay(d.ap[i] * k, w0);
      if (sum <= 0.7 * (N0 - 4) || k < 0.02) break;
      k *= 0.7;
    }
    for (let i = 0; i < n; i++) v.sa[p * 8 + i] = d.ap[i] * k;
    v.sD[p] = Math.max(3, N0 - sum - 1); // − 1: the symmetric loop low-pass delays exactly one sample
  }
  v.sG = Math.pow(10, -3 / (d.t60 * v.f));
  v.sTf = v.f;
}
function exciteString(v, d, g, vel) {
  const ex = g.address | 0, o = d.o;
  if (ex <= 1) { // pluck / pick: one period of the fractal outline enters the loop
    const Kmax = Math.floor(0.45 * g.sr / v.f);
    const want = ex === 1 ? o.H : Math.round(2 + 30 * g.body * g.body * (v.kmod || 1));
    const K = Math.max(1, Math.min(o.H, want, Kmax)), N = Math.max(4, Math.min(SLEN - 8, Math.round(v.sD[0] + 1)));
    if (!v.exBuf) v.exBuf = new Float64Array(SLEN * 2);
    const B = v.exBuf, A = vel * o.norm * 2.2;
    for (let t = 0; t < N; t++) { // band-limited outline (harmonics 1…K), softly tapered at the top
      let sx = 0, sy = 0;
      for (let k = 1; k <= K; k++) {
        const a = TAU * k * t / N, c = Math.cos(a), s = Math.sin(a), wk = k > K * 0.7 ? 0.5 + 0.5 * Math.cos(Math.PI * (k - K * 0.7) / (K * 0.3 + 1)) : 1;
        sx += (o.pr[k] * c - o.pi[k] * s + o.nr[k] * c + o.ni[k] * s) * wk;
        sy += (o.pr[k] * s + o.pi[k] * c - o.nr[k] * s + o.ni[k] * c) * wk;
      }
      B[2 * t] = sx * A; B[2 * t + 1] = sy * A;
    }
    v.exLvl = 0; v.exN = N; v.exK = 0; v.exA = A;
  } else if (ex === 2) { // hammer: a soft half-sine pulse, harder higher on the surface
    v.exLvl = -1; v.exN = Math.max(4, Math.round((0.0004 + 0.004 * (1 - g.body) / (v.kmod || 1)) * g.sr)); v.exK = 0;
    v.exA = vel * 0.35 * Math.min(1, Math.sqrt(160 / v.f)); // same loudness up the keyboard
  }
}
export function renderString(v, patch, g, L, R, n, trail) {
  const d = stringData(patch, g), sr = g.sr, nx = Math.min(8, d.n), ex = g.address | 0;
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  const atk = 1 / Math.max(1, g.attack * sr), rel = Math.exp(-1 / Math.max(1, g.release * sr / 4));
  if (!v.sbx) { v.sbx = new Float64Array(SLEN); v.sby = new Float64Array(SLEN); v.sz = new Float64Array(16); v.sa = new Float64Array(16); v.sD = new Float64Array(2); v.sf = new Float64Array(4); }
  if (!v.started) {
    v.started = true; v.env = 0; v.stage = 0; v.t = 0; v.sw = 0;
    v.sbx.fill(0); v.sby.fill(0); v.sz.fill(0); v.sf.fill(0); v.sTf = 0; v.sPatch = null; v.slvl = 0;
    tuneString(v, d, sr); exciteString(v, d, g, v.vel);
  }
  if (v.strikeReq) { v.strikeReq = false; tuneString(v, d, sr); exciteString(v, d, g, v.vel); }
  if (v.sPatch !== d) { v.sPatch = d; tuneString(v, d, sr); }
  const o = d.o, b = d.lpB, b0 = 1 - 2 * b;
  const th = d.couple / Math.max(4, v.sD[0]), cth = Math.cos(th), sth = Math.sin(th);
  const relG = Math.pow(10, -3 / (Math.max(0.04, g.release * 0.6) * v.f));
  const slope = 1.5 + 2.5 * g.body;
  const lvlK = 1 / (0.02 * sr), growK = 1 / (0.12 * v.f);
  const lossF = 1 - v.sG * (1 - 2 * b + 2 * b * Math.cos(TAU * v.f / sr));
  let en = 0;
  const bx = v.sbx, by = v.sby, sa = v.sa, sz = v.sz, sf = v.sf;
  for (let i = 0; i < n; i++) {
    if (v.rel) v.env *= rel;
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    v.f += (v.fTarget - v.f) * gl;
    if ((i & 31) === 0 && Math.abs(v.f - v.sTf) > v.f * 1e-5) tuneString(v, d, sr);
    const w = v.sw;
    let sx = readFrac(bx, w - v.sD[0]), sy = readFrac(by, w - v.sD[1]);
    const ox = sx, oy = sy;
    for (let k = 0; k < nx; k++) { // one dispersion stage per transform
      const ax = sa[k]; let y = ax * sx + sz[k]; sz[k] = sx - ax * y; sx = y;
      const ay = sa[8 + k]; y = ay * sy + sz[8 + k]; sz[8 + k] = sy - ay * y; sy = y;
    }
    const fx = b * sx + b0 * sf[0] + b * sf[1]; sf[1] = sf[0]; sf[0] = sx;
    const fy = b * sy + b0 * sf[2] + b * sf[3]; sf[3] = sf[2]; sf[2] = sy;
    const G = v.rel ? Math.min(v.sG, relG) : v.sG;
    let ix = (fx * cth - fy * sth) * G, iy = (fx * sth + fy * cth) * G;
    // exciters
    if (v.exN > 0) {
      const k = v.exK++;
      if (v.exLvl >= 0) { ix += v.exBuf[2 * k]; iy += v.exBuf[2 * k + 1]; }
      else { const h = Math.sin(Math.PI * k / v.exN) * v.exA; ix += h; iy += h * 0.55; }
      if (k + 1 >= v.exN) v.exN = 0;
    }
    if (ex >= 3) { // sustained: the string drives itself (regeneration), held at a target level
      // adding γ·out to the loop raises the per-pass gain by γ — strongest at the harmonics, never
      // destabilising between them — so γ = (loss at the fundamental) + level error / growth time
      v.slvl += (Math.abs(ox) + Math.abs(oy) - v.slvl) * lvlK;
      const tgt = v.rel ? 0 : 0.3 * v.vel * v.env * (0.6 + 0.4 * (v.kmod || 1));
      const err = clamp(tgt > 0 ? 1 - v.slvl / tgt : -1, -1, 1);
      const gam = Math.min(0.08, Math.max(0, lossF + err * growK));
      if (ex === 3) { // bow: stick–slip shaping (rich, Helmholtz-like) plus rosin noise
        const A = v.slvl + 1e-4, nz = (rnd(v) * 2 - 1) * A * (0.08 + g.breath * 0.6);
        ix += gam * (A * Math.tanh(slope * ox / A) / slope * 1.6 + nz); iy += gam * (A * Math.tanh(slope * oy / A) / slope * 1.6 - nz);
      } else { ix += gam * ox; iy += gam * oy; } // e-bow: pure regeneration (smooth, endless)
      if (v.slvl < 1e-4 && tgt > 0) { const e = (rnd(v) * 2 - 1) * 0.002 * v.vel; ix += e; iy -= e; } // start from a whisper
    } else if (g.breath > 0 && v.t < 0.04) { const e = (rnd(v) * 2 - 1) * g.breath * v.vel * 0.06 * (1 - v.t / 0.04); ix += e; iy -= e; }
    bx[w & SMASK] = ix; by[w & SMASK] = iy;
    v.sw = (w + 1) & 0x3fffffff;
    v.t += 1 / sr;
    L[i] += ox * patch.norm; R[i] += oy * patch.norm;
    en += ox * ox + oy * oy;
  }
  if (trail && (v.age / n & 1) === 0) { // the vibrating string itself, drawn as its two polarisations
    const s = 1 / (o.norm * 2.2 * Math.max(0.2, v.vel)), N = v.sD[0];
    for (let k = 0; k <= 40; k++) { const p = v.sw - 1 - N * k / 40; trail.push(o.mx + readFrac(bx, p) * s, o.my + readFrac(by, p) * s); }
  }
  v.age += n;
  if ((v.rel || (ex <= 2 && v.t > 0.3)) && en / n < 1e-11) { v.active = false; return false; }
  return true;
}

// ===================== PULSE =====================
const HITS = 8;
function pulseData(patch, g) {
  const key = `${g.ring}|${g.breath}|${g.body}`;
  if (patch._pk === key) return patch._pd;
  const n = patch.n, ratio = new Float64Array(n), amp = new Float64Array(n), t60 = new Float64Array(n), nz = new Float64Array(n), pan = new Float64Array(n), rach = new Int32Array(n);
  let amax = 1e-9, ylo = Infinity, yhi = -Infinity;
  for (let i = 0; i < n; i++) { ylo = Math.min(ylo, patch.R[i].py); yhi = Math.max(yhi, patch.R[i].py); }
  for (let i = 0; i < n; i++) {
    const r = patch.R[i], dx = r.px - patch.cx, dy = r.py - patch.cy;
    ratio[i] = Math.pow(2, Math.abs(r.rot) / 180 * 2);
    amp[i] = (0.4 + Math.hypot(dx, dy) / patch.spread) * Math.sqrt(patch.w[i] * n); amax = Math.max(amax, amp[i]);
    t60[i] = (0.05 + 1.3 * g.ring * g.ring) * (0.3 + Math.min(1.2, r.s)) / Math.sqrt(ratio[i]);
    nz[i] = g.breath * (0.2 + 0.8 * (yhi > ylo ? (r.py - ylo) / (yhi - ylo) : 0.5)); // higher transforms are noisier (snare / hat)
    pan[i] = clamp(dx / (patch.spread * 1.5), -1, 1);
    rach[i] = 1 + Math.floor((1 - Math.min(1, r.s)) * 3.99);                       // small transforms roll
  }
  for (let i = 0; i < n; i++) amp[i] /= amax;
  const d = { ratio, amp, t60, nz, pan, rach };
  patch._pk = key; patch._pd = d;
  return d;
}
function pulseHit(v, patch, d, g, k, a, trail) {
  let s = -1, q = 1e9;
  for (let j = 0; j < HITS; j++) { if (!v.hon[j]) { s = j; break; } if (v.ha[j] < q) { q = v.ha[j]; s = j; } }
  let f = v.f * d.ratio[k];
  while (f < 32) f *= 2; while (f > g.sr * 0.3) f *= 0.5;
  v.hon[s] = 1; v.hph[s] = 0; v.hf[s] = f; v.hdrop[s] = 1; v.hpos[s] = 0;
  v.ha[s] = a * d.amp[k];
  v.hdec[s] = Math.exp(-6.907755 / (d.t60[k] * g.sr));
  v.hnz[s] = d.nz[k];
  v.hlo[s] = 0; v.hbd[s] = 0;
  const p = (d.pan[k] * 0.8 + 1) * Math.PI / 4; v.hl[s] = Math.cos(p); v.hr[s] = Math.sin(p);
  if (trail) trail.push(patch.R[k].px, patch.R[k].py);
}
function pulseStep(v, patch, d, g, st, trail) {
  const n = patch.n, mode = g.address | 0, dn = clamp(0.22 + 0.62 * ((v.kmod || 1) - 0.45) / 1.17, 0.12, 1);
  const acc = (st & 3) === 0 ? 1 : (st & 1) ? 0.62 : 0.8;
  const a = v.vel * acc;
  if (mode === 0 || mode === 4) { // chaos game step (optionally rolled)
    if (rnd(v) >= dn) return;
    const k = pickW(patch.w, rnd(v));
    pulseHit(v, patch, d, g, k, a, trail);
    if (mode === 4 && d.rach[k] > 1) { v.rN = d.rach[k] - 1; v.rK = k; v.rEvery = v.stepLen / d.rach[k]; v.rAt = v.rEvery; v.rA = a * 0.75; }
  } else if (mode === 1) { // Euclidean: each transform spreads its share of 16 steps evenly
    for (let k = 0; k < n; k++) {
      const hits = Math.max(1, Math.min(16, Math.round(16 * patch.w[k] * dn * 1.5)));
      const s = ((st + k * 5) % 16 + 16) % 16;
      if ((s * hits) % 16 < hits) pulseHit(v, patch, d, g, k, a / Math.sqrt(1 + k * 0.3), trail);
    }
  } else { // Thue–Morse or Fibonacci word, gated by an irrational rotation
    const gate = (((st * (mode === 2 ? PHI - 1 : Math.SQRT2 - 1)) % 1) + 1) % 1;
    if (gate >= dn) return;
    const k = mode === 2 ? THUEN(st, n) : pickW(patch.w, (((st * (PHI - 1)) % 1) + 1) % 1);
    pulseHit(v, patch, d, g, k, a, trail);
  }
}
export function renderPulse(v, patch, g, L, R, n, trail) {
  const d = pulseData(patch, g), sr = g.sr;
  const atk = 1 / Math.max(1, g.attack * sr), rel = Math.exp(-1 / Math.max(1, g.release * sr / 4));
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  const bpm = clamp(g.throat / 20, 30, 300), stepLen = sr * 60 / bpm / 4;
  v.stepLen = stepLen;
  const clock = g.clock || 0;
  if (!v.hon) {
    v.hon = new Uint8Array(HITS); v.hph = new Float64Array(HITS); v.hf = new Float64Array(HITS); v.hdrop = new Float64Array(HITS); v.hpos = new Float64Array(HITS);
    v.ha = new Float64Array(HITS); v.hdec = new Float64Array(HITS); v.hnz = new Float64Array(HITS); v.hlo = new Float64Array(HITS); v.hbd = new Float64Array(HITS); v.hl = new Float64Array(HITS); v.hr = new Float64Array(HITS);
  }
  if (!v.started) {
    v.started = true; v.env = 0; v.stage = 0; v.rN = 0;
    v.pStep = Math.floor(clock / stepLen);
    pulseStep(v, patch, d, g, v.pStep, trail); // play on the press, then follow the shared clock
    if (!v.hon.some(x => x)) pulseHit(v, patch, d, g, pickW(patch.w, rnd(v)), v.vel, trail);
  }
  if (v.strikeReq) { v.strikeReq = false; pulseHit(v, patch, d, g, pickW(patch.w, rnd(v)), v.vel, trail); }
  const pdec = Math.exp(-1 / ((0.008 + 0.05 * g.body) * sr)), drop = g.body * 5;
  const attackS = 0.0008 * sr, amp = patch.norm;
  const swing = g.bloom * 0.5;
  let live = 0;
  for (let i = 0; i < n; i++) {
    if (v.rel) v.env *= rel;
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    v.f += (v.fTarget - v.f) * gl;
    if (!v.rel) {
      const pos = (clock + i) / stepLen, st = Math.floor(pos), fr = pos - st;
      if (st !== v.pStep && fr >= ((st & 1) ? swing : 0)) { v.pStep = st; pulseStep(v, patch, d, g, st, trail); }
      if (v.rN > 0 && --v.rAt <= 0) { pulseHit(v, patch, d, g, v.rK, v.rA, trail); v.rN--; v.rAt = v.rEvery; v.rA *= 0.8; }
    }
    let l = 0, r = 0;
    for (let s = 0; s < HITS; s++) {
      if (!v.hon[s]) continue;
      live++;
      const p = v.hpos[s]++, a = v.ha[s] * (p < attackS ? p / attackS : 1);
      v.ha[s] *= v.hdec[s];
      if (v.ha[s] < 1e-4) { v.hon[s] = 0; continue; }
      v.hdrop[s] *= pdec;
      const f = Math.min(0.45 * sr, v.hf[s] * (1 + drop * v.hdrop[s]));
      let ph = v.hph[s] + f / sr; ph -= Math.floor(ph); v.hph[s] = ph;
      let sm = Math.sin(TAU * ph) * (1 - v.hnz[s]);
      if (v.hnz[s] > 0) { // band-passed noise (Chamberlin SVF) for snares and hats
        const fc = Math.min(sr / 6.5, v.hf[s] * 3 + 1800), ff = 2 * Math.sin(Math.PI * fc / sr);
        const x = rnd(v) * 2 - 1, hi = x - v.hlo[s] - 0.9 * v.hbd[s];
        v.hbd[s] += ff * hi; v.hlo[s] += ff * v.hbd[s];
        sm += v.hbd[s] * v.hnz[s] * 1.4;
      }
      sm *= a;
      l += sm * v.hl[s]; r += sm * v.hr[s];
    }
    L[i] += l * amp; R[i] += r * amp;
  }
  v.age += n;
  if (v.rel && live === 0) { v.active = false; return false; }
  return true;
}

// ===================== SCAN =====================
const COLS = 48, SCAN_MAP = ['Harmonics', 'Odd harmonics', 'Stretched (bell)', 'Pentatonic chord', 'Half harmonics (hollow)'];
const LADDER = [0, 7, 12, 16, 19, 24, 28, 31, 36, 40, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79, 84];
function scanRatio(mode, r) {
  if (mode === 1) return 2 * r + 1;
  if (mode === 2) return Math.pow(r + 1, 1.13);
  if (mode === 3) { const o = Math.floor(r / LADDER.length); return Math.pow(2, (LADDER[r % LADDER.length] + 12 * 7 * o) / 12); }
  if (mode === 4) return (r + 2) / 2;
  return r + 1;
}
// The picture analysis (a few thousand chaos-game points) is spread over several audio blocks so
// a moving flame (Wander, dragging) never stalls the audio thread; the previous picture keeps
// playing until the new one is ready.
const SCAN_PTS = 4000, SCAN_STEP = 500;
let scanJob = null, scanLast = null;
function scanData(patch, g) {
  const rows = clamp(g.detail | 0 || 32, 8, 64), mode = g.address | 0;
  const key = `${rows}|${g.body}|${mode}`;
  if (patch._ck === key) return patch._cd;
  if (!scanJob || scanJob.done) scanJob = { patch, key, rows, mode, body: g.body, k: 0, m: 0, x: patch.cx, y: patch.cy, s: 4242, xs: new Float64Array(SCAN_PTS), ys: new Float64Array(SCAN_PTS), clock: -1, done: false };
  const J = scanJob, clk = g.clock ?? -2;
  if (J.clock !== clk || clk === -2) { // one slice per audio block, however many voices ask
    J.clock = clk;
    const P = J.patch, acc = [0, 0], end = Math.min(SCAN_PTS + 20, J.k + SCAN_STEP);
    let { x, y, s, m } = J;
    for (; J.k < end; J.k++) {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      applyXf(P.P, pickW(P.w, s / 4294967296), x, y, acc, J.k & 1); x = acc[0]; y = acc[1];
      if (!(Math.abs(x) < 50 && Math.abs(y) < 50)) { x = P.cx; y = P.cy; continue; }
      if (J.k >= 20) { J.xs[m] = x; J.ys[m] = y; m++; }
    }
    J.x = x; J.y = y; J.s = s; J.m = m;
    if (J.k >= SCAN_PTS + 20) { J.done = true; const d = scanFinish(J); J.patch._ck = J.key; J.patch._cd = d; scanLast = d; }
  }
  return patch._ck === key ? patch._cd : scanLast && scanLast.rows === rows ? scanLast : null;
}
function scanFinish(J) {
  const { rows, mode, xs, ys, m } = J;
  // bounds: mean ± 2.2σ (robust enough, no sort)
  let sx = 0, sy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < m; k++) { sx += xs[k]; sy += ys[k]; sxx += xs[k] * xs[k]; syy += ys[k] * ys[k]; }
  const n = Math.max(1, m), mx = sx / n, my = sy / n;
  const dx = Math.sqrt(Math.max(1e-8, sxx / n - mx * mx)) * 2.2, dy = Math.sqrt(Math.max(1e-8, syy / n - my * my)) * 2.2;
  const x0 = mx - dx, x1 = mx + dx, y0 = my - dy, y1 = my + dy;
  const grid = new Float64Array(COLS * rows);
  for (let k = 0; k < m; k++) {
    const c = Math.floor((xs[k] - x0) / (x1 - x0) * COLS), r = Math.floor((ys[k] - y0) / (y1 - y0) * rows);
    if (c >= 0 && c < COLS && r >= 0 && r < rows) grid[c * rows + r]++;
  }
  // light blur (sampling noise → structure), then contrast
  const bl = new Float64Array(COLS * rows);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < rows; r++) {
    let t = 0, wt = 0;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= COLS || rr < 0 || rr >= rows) continue;
      const ww = (dc ? 0.5 : 1) * (dr ? 0.5 : 1); t += grid[cc * rows + rr] * ww; wt += ww;
    }
    bl[c * rows + r] = t / wt;
  }
  let mxv = 1e-9; for (let i = 0; i < bl.length; i++) mxv = Math.max(mxv, bl[i]);
  const gam = 0.35 + 2.2 * J.body;
  const E = new Float64Array(COLS);
  for (let c = 0; c < COLS; c++) { let e = 0; for (let r = 0; r < rows; r++) { const a = Math.pow(bl[c * rows + r] / mxv, gam); bl[c * rows + r] = a; e += a * a; } E[c] = e; }
  let Emax = 1e-12; for (let c = 0; c < COLS; c++) Emax = Math.max(Emax, E[c]);
  for (let c = 0; c < COLS; c++) { const k = 1 / Math.sqrt(Math.max(E[c], 0.2 * Emax)); for (let r = 0; r < rows; r++) bl[c * rows + r] *= k; }
  const ratio = new Float64Array(rows);
  for (let r = 0; r < rows; r++) ratio[r] = scanRatio(mode, r);
  return { rows, grid: bl, ratio, x0, x1, y0, y1 };
}
function column(d, pos, out) { // linear interpolation between columns
  const p = clamp(pos, 0, 1) * (COLS - 1), c = Math.min(COLS - 2, Math.floor(p)), f = p - c, rows = d.rows, G = d.grid;
  for (let r = 0; r < rows; r++) out[r] = G[c * rows + r] * (1 - f) + G[(c + 1) * rows + r] * f;
}
const colL = new Float64Array(64), colR = new Float64Array(64);
export function renderScan(v, patch, g, L, R, n, trail) {
  const d = scanData(patch, g), sr = g.sr;
  if (!d) { // the first picture is still being read (a few ms): keep the envelope moving, stay silent
    if (!v.started) { v.started = true; v.env = 0; v.stage = 0; v.scPh = 0.05 + rnd(v) * 0.2; v.vibT = 0; v.vibK = 1; v.scFresh = true; }
    v.age += n; return true;
  }
  const rows = d.rows;
  const atk = 1 / Math.max(1, g.attack * sr), dec = Math.exp(-1 / Math.max(1, g.decay * sr / 4)), rel = Math.exp(-1 / Math.max(1, g.release * sr / 4));
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  if (!v.scC) { v.scC = new Float64Array(64); v.scS = new Float64Array(64); v.scWc = new Float64Array(64); v.scWs = new Float64Array(64); v.scAL = new Float64Array(64); v.scAR = new Float64Array(64); v.scDL = new Float64Array(64); v.scDR = new Float64Array(64); v.scJ = new Float64Array(64); }
  if (!v.started || v.scFresh) {
    if (!v.started) { v.env = 0; v.stage = 0; v.vibT = 0; v.vibK = 1; v.scPh = rnd(v) * 0.2 + 0.05; }
    v.started = true; v.scFresh = false;
    for (let r = 0; r < 64; r++) { const a = TAU * rnd(v); v.scC[r] = Math.cos(a); v.scS[r] = Math.sin(a); v.scAL[r] = v.scAR[r] = 0; v.scJ[r] = 0; }
  }
  const rate = 0.02 + 0.55 * g.ring * g.ring; // there-and-back sweeps per second
  const vibW = TAU * g.vibRate, amp = patch.norm * v.vel * 0.3;
  const C = v.scC, S = v.scS, WC = v.scWc, WS = v.scWs, AL = v.scAL, AR = v.scAR, DL = v.scDL, DR = v.scDR;
  for (let i = 0; i < n; i++) {
    if (v.rel) { v.env *= rel; if (v.env < 1e-4) { v.active = false; return false; } }
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    else { v.env = g.sustain + (v.env - g.sustain) * dec; }
    v.f += (v.fTarget - v.f) * gl;
    v.vibT += 1 / sr;
    if ((i & 31) === 0) { // move the scan line, read the picture, retune the partials
      const vd = g.vibDepth * Math.min(1, Math.max(0, (v.vibT - g.vibDelay) / 0.4));
      v.vibK = vd ? Math.exp(vd * Math.sin(v.vibT * vibW) * 0.000577622650466621) : 1;
      v.scPh += 32 * rate / sr; v.scPh -= Math.floor(v.scPh);
      const pos = v.scPh < 0.5 ? v.scPh * 2 : 2 - v.scPh * 2;
      column(d, pos - 0.035, colL); column(d, pos + 0.035, colR);
      const f0 = v.f * v.vibK, fc = Math.max(80, g.throat * (v.kmod || 1) * (1 - g.bloom + g.bloom * v.env));
      for (let r = 0; r < rows; r++) {
        const fr = f0 * d.ratio[r];
        let k = 0;
        if (fr < 0.45 * sr) {
          const q = fr / fc; k = 1 / Math.sqrt(1 + q * q) / (1 + r * 0.08);
          if (g.breath > 0) { v.scJ[r] += ((rnd(v) * 2 - 1) - v.scJ[r]) * 0.25; k *= Math.max(0, 1 + g.breath * 1.6 * v.scJ[r]); }
        }
        const tl = colL[r] * k, tr = colR[r] * k;
        if (tl < 1e-6 && tr < 1e-6 && AL[r] < 1e-6 && AR[r] < 1e-6) { AL[r] = AR[r] = DL[r] = DR[r] = 0; }
        else { DL[r] = (tl - AL[r]) / 32; DR[r] = (tr - AR[r]) / 32; }
        const w = TAU * fr / sr; WC[r] = Math.cos(w); WS[r] = Math.sin(w);
        const m = 1 / Math.hypot(C[r], S[r]); C[r] *= m; S[r] *= m;
      }
    }
    let l = 0, rr = 0;
    for (let r = 0; r < rows; r++) {
      if (AL[r] === 0 && AR[r] === 0 && DL[r] === 0 && DR[r] === 0) continue; // above Nyquist or dark: skip
      const c = C[r], s = S[r], ns = c * WS[r] + s * WC[r];
      C[r] = c * WC[r] - s * WS[r]; S[r] = ns;
      AL[r] += DL[r]; AR[r] += DR[r];
      l += AL[r] * ns; rr += AR[r] * ns;
    }
    const e = v.env * amp;
    L[i] += l * e; R[i] += rr * e;
  }
  if (trail && ((v.age / n) & 1) === 0) { // the scan line on the flame, bulging with each partial's level
    const pos = v.scPh < 0.5 ? v.scPh * 2 : 2 - v.scPh * 2, X = d.x0 + pos * (d.x1 - d.x0), wd = (d.x1 - d.x0) * 0.08;
    for (let r = 0; r < rows; r++) trail.push(X + (AL[r] + AR[r]) * wd, d.y0 + (r + 0.5) / rows * (d.y1 - d.y0));
  }
  v.age += n;
  return true;
}
export { SCAN_MAP };

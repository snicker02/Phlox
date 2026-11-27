// Phlox v1.2.1 — the four sound engines, all driven by the same flame.
//   voice : formant voice (flame.js renderVoice) — each transform a vocal-tract resonance
//   bell  : struck/bowed modal body — each transform an inharmonic partial ringing in parallel
//   orbit : wavetable — the flame's periodic orbit under an address word, played band-limited
//   cloud : granular — the chaos game spawns grains, pitched by height on the fractal
import { applyXf, XF_STRIDE, renderVoice, preparePatch, makeVoice, Decimator, OS } from './flame.js';

export const ENGINES = {
  voice: { name: 'Voice', os: true },
  bell: { name: 'Bell', os: false },
  orbit: { name: 'Orbit', os: false },
  cloud: { name: 'Cloud', os: false },
};
const TAU = Math.PI * 2;
function rnd(v) { let s = v.rng; s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; v.rng = s; return s / 4294967296; }
const PHI = (1 + Math.sqrt(5)) / 2;

// ---------- per-patch engine data (lazy, cached on the patch) ----------
function engineData(patch, g) {
  const key = `${g.engine}|${g.throat}|${g.address}|${g.detail}|${g.ring}|${g.engine === 'orbit' ? g.body : ''}`;
  if (patch._ek === key) return patch._ed;
  let d = null;
  if (g.engine === 'bell') d = bellData(patch, g);
  else if (g.engine === 'orbit') d = orbitData(patch, g);
  else if (g.engine === 'cloud') d = cloudData(patch, g);
  patch._ek = key; patch._ed = d;
  return d;
}

// ===================== BELL =====================
// partial ratio from rotation (0° → ×1, 180° → ×2^spread), decay from contraction, strike
// strength from the fixed point's distance to the centre, stereo ellipse from the shape.
function bellData(patch, g) {
  const n = patch.n, oct = g.throat / 1200;
  const ratio = new Float64Array(n), amp = new Float64Array(n), t60 = new Float64Array(n), ph = new Float64Array(n);
  let amax = 1e-9;
  for (let i = 0; i < n; i++) {
    const r = patch.R[i];
    ratio[i] = Math.pow(2, Math.abs(r.rot) / 180 * oct);
    const dx = r.px - patch.cx, dy = r.py - patch.cy;
    amp[i] = (0.35 + Math.hypot(dx, dy) / patch.spread) * Math.sqrt(patch.w[i] * n);
    ph[i] = Math.atan2(dy, dx);
    t60[i] = (0.15 + 9 * g.ring * g.ring) * (0.25 + Math.min(1.2, r.s)) / Math.sqrt(ratio[i]);
    amax = Math.max(amax, amp[i]);
  }
  for (let i = 0; i < n; i++) amp[i] /= amax;
  return { ratio, amp, t60, ph };
}
function strike(v, patch, d, g, vel) {
  const n = patch.n, hard = 2 * g.body - 1 + Math.log2(v.kmod || 1); // higher on the surface = harder mallet
  for (let i = 0; i < n; i++) {
    const a = d.amp[i] * vel * Math.pow(d.ratio[i], hard);
    v.mr[i] += a * Math.cos(d.ph[i]); v.mi[i] += a * Math.sin(d.ph[i]);
  }
  v.burst = 0.012 + g.breath * 0.06; // noise burst length (s)
  v.bend = 1;                          // strike pitch-drop envelope
}
export function renderBell(v, patch, g, L, R, n, trail) {
  const d = engineData(patch, g), nx = patch.n, sr = g.sr;
  if (!v.mr || v.mr.length !== nx) { v.mr = new Float64Array(nx); v.mi = new Float64Array(nx); v.cr = new Float64Array(nx); v.ci = new Float64Array(nx); v.nr = new Float64Array(nx); }
  const rel = Math.exp(-1 / Math.max(1, g.release * sr / 4)), atk = 1 / Math.max(1, g.attack * sr);
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  if (!v.started) { v.started = true; v.env = 0; v.stage = 0; v.mr.fill(0); v.mi.fill(0); v.nextHit = 0; v.t = 0; strike(v, patch, d, g, v.vel); v.hits = 1; }
  if (v.strikeReq) { v.strikeReq = false; strike(v, patch, d, g, v.vel); }
  const ex = g.address | 0; // 0 strike, 1 double, 2 roll, 3 bow, 4 scrape
  const amp = patch.norm;
  for (let i = 0; i < n; i++) {
    if (v.rel) { v.env *= rel; if (v.env < 1e-4) { v.active = false; return false; } }
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    v.f += (v.fTarget - v.f) * gl;
    v.t += 1 / sr;
    // exciters
    if (ex === 1 && v.hits === 1 && v.t > 0.075) { strike(v, patch, d, g, v.vel * 0.55); v.hits = 2; }
    if ((ex === 2 || ex === 4) && !v.rel && v.t >= v.nextHit) { strike(v, patch, d, g, v.vel * (ex === 2 ? 0.3 + 0.3 * rnd(v) : 0.12 + 0.1 * rnd(v))); v.nextHit = v.t + (ex === 2 ? 1 / 13 : 1 / 30) * (0.7 + 0.6 * rnd(v)); }
    if ((i & 31) === 0) { // partial rotators (re-tuned every 32 samples: glide + strike bend)
      const bendK = 1 + g.bloom * 0.07 * v.bend;
      for (let k = 0; k < nx; k++) {
        const w = TAU * Math.min(sr * 0.45, v.f * d.ratio[k] * bendK) / sr, rho = Math.exp(-6.907755 / (d.t60[k] * sr));
        v.cr[k] = rho * Math.cos(w); v.ci[k] = rho * Math.sin(w);
        v.nr[k] = Math.sqrt(1 - rho * rho);
      }
    }
    v.bend *= 0.9993;
    let noise = 0;
    if (v.burst > 0) { noise = (rnd(v) * 2 - 1) * (0.5 + g.breath); v.burst -= 1 / sr; }
    if ((ex === 3 || ex === 4) && !v.rel) noise += (rnd(v) * 2 - 1) * v.vel * (ex === 3 ? 1.2 : 0.6) * v.env;
    let x = 0, y = 0;
    for (let k = 0; k < nx; k++) {
      const a = v.mr[k], b = v.mi[k];
      let nr = a * v.cr[k] - b * v.ci[k], ni = a * v.ci[k] + b * v.cr[k];
      if (noise !== 0) { const e = noise * d.amp[k] * v.nr[k] * 3; nr += e * Math.cos(d.ph[k]); ni += e * Math.sin(d.ph[k]); }
      v.mr[k] = nr; v.mi[k] = ni;
      const r = patch.R[k]; // stereo ellipse from the transform's shape
      x += r.s00 * nr + r.s01 * ni; y += r.s10 * nr + r.s11 * ni;
    }
    const e = v.env * amp;
    L[i] += x * e; R[i] += y * e;
    if (trail && (v.age + i) % 4 === 0) trail.push(patch.cx + x * 0.3, patch.cy + y * 0.3);
  }
  v.age += n;
  // a struck voice that has rung out frees itself
  if (v.t > 0.3 && ex !== 3 && ex !== 4 && ex !== 2) { let en = 0; for (let k = 0; k < nx; k++) en += v.mr[k] ** 2 + v.mi[k] ** 2; if (en < 1e-9) { v.active = false; return false; } }
  return true;
}

// ===================== ORBIT =====================
// address word of length m → periodic orbit of the full flame map (variations included) →
// DFT → band-limited mip tables (complex = stereo) → cubic table playback, then a one-pole
// brightness filter (Brightness × play-surface height × Bloom envelope).
const THUEN = (k, n) => { let s = 0; while (k) { s += k % n; k = Math.floor(k / n); } return s % n; };
function makeWord(patch, mode, m, seed) {
  const n = patch.n, w = patch.w, word = new Int32Array(m);
  if (mode === 0) { // blocks: each transform holds a run (square-ish waves)
    let k = 0; for (let i = 0; i < n; i++) { const c = i === n - 1 ? m - k : Math.round(w[i] * m); for (let j = 0; j < c && k < m; j++) word[k++] = i; }
    while (k < m) word[k++] = n - 1;
  } else if (mode === 1) { // balanced: irrational (√2) rotation through the weights — even, but never repeats
    for (let k = 0; k < m; k++) { let t = (k * (Math.SQRT2 - 1) + 0.137) % 1, i = 0; for (; i < n - 1; i++) { t -= w[i]; if (t < 0) break; } word[k] = i; }
  } else if (mode === 2) { for (let k = 0; k < m; k++) word[k] = THUEN(k, n); }
  else if (mode === 3) { // Sturmian / golden rotation through the weights
    for (let k = 0; k < m; k++) { let t = (k * (PHI - 1)) % 1, i = 0; for (; i < n - 1; i++) { t -= w[i]; if (t < 0) break; } word[k] = i; }
  } else { // seeded random by weight
    let s = seed >>> 0 || 7;
    for (let k = 0; k < m; k++) { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; let t = s / 4294967296, i = 0; for (; i < n - 1; i++) { t -= w[i]; if (t < 0) break; } word[k] = i; }
  }
  return word;
}
const TBL = 2048, MIPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
function orbitData(patch, g) {
  const m = Math.max(4, Math.min(64, g.detail | 0 || 32));
  const word = makeWord(patch, g.address | 0, m, 1234);
  const acc = [0, 0];
  let x = patch.cx, y = patch.cy;
  for (let rep = 0; rep < 14; rep++) for (let k = 0; k < m; k++) {
    applyXf(patch.P, word[k], x, y, acc, k & 1); x = acc[0]; y = acc[1];
    if (!(Math.abs(x) < 50 && Math.abs(y) < 50)) { x = patch.cx; y = patch.cy; }
  }
  const qx = new Float64Array(m), qy = new Float64Array(m);
  for (let k = 0; k < m; k++) { applyXf(patch.P, word[k], x, y, acc, k & 1); x = acc[0]; y = acc[1]; if (!(Math.abs(x) < 50 && Math.abs(y) < 50)) { x = patch.cx; y = patch.cy; } qx[k] = x; qy[k] = y; }
  // trace the orbit's points as an outline (sorted by angle around their centre): one trip around
  // the outline is one period, so the note's pitch is the fundamental and the jagged fractal radius
  // becomes the overtones. (Visiting order jumps across the fractal every step → pitch-less buzz.)
  let ox = 0, oy = 0; for (let k = 0; k < m; k++) { ox += qx[k]; oy += qy[k]; } ox /= m; oy /= m;
  const idx = Array.from({ length: m }, (_, k) => k).sort((a, b) => Math.atan2(qy[a] - oy, qx[a] - ox) - Math.atan2(qy[b] - oy, qx[b] - ox));
  // Edge: exaggerate each point's radial deviation from the mean radius (1× … 9×) → richer overtones
  const G = 1 + 8 * Math.max(0, Math.min(1, g.body));
  let rm = 0; for (let k = 0; k < m; k++) rm += Math.hypot(qx[k] - ox, qy[k] - oy); rm /= m;
  const px = new Float64Array(m), py = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const dx = qx[idx[k]] - ox, dy = qy[idx[k]] - oy, r = Math.hypot(dx, dy) || 1e-9;
    const r2 = Math.max(0.02 * rm, rm + (r - rm) * G);
    px[k] = ox + dx * r2 / r; py[k] = oy + dy * r2 / r;
  }
  // complex DFT of z = x + iy: positive (pr,pi) and negative (nr,ni) harmonics k = 1..H
  const H = Math.floor(m / 2), pr = new Float64Array(H + 1), pi = new Float64Array(H + 1), nr = new Float64Array(H + 1), ni = new Float64Array(H + 1);
  let pow = 0;
  for (let k = 1; k <= H; k++) {
    let ar = 0, ai = 0, br = 0, bi = 0;
    for (let t = 0; t < m; t++) {
      const a = -TAU * k * t / m, c = Math.cos(a), s = Math.sin(a);
      ar += px[t] * c - py[t] * s; ai += px[t] * s + py[t] * c;
      br += px[t] * c + py[t] * s; bi += -px[t] * s + py[t] * c;
    }
    pr[k] = ar / m; pi[k] = ai / m; nr[k] = br / m; ni[k] = bi / m;
    pow += pr[k] ** 2 + pi[k] ** 2 + nr[k] ** 2 + ni[k] ** 2;
  }
  const norm = pow > 1e-12 ? 0.2 / Math.sqrt(pow / 2) : 1;
  // band-limited mip tables: level j holds harmonics 1..MIPS[j] (capped at H)
  const levels = MIPS.filter(K => K <= H);
  if (!levels.length || levels[levels.length - 1] !== H) levels.push(H);
  const tx = [], ty = [];
  const cs = new Float64Array(TBL), sn = new Float64Array(TBL);
  for (let t = 0; t < TBL; t++) { cs[t] = Math.cos(TAU * t / TBL); sn[t] = Math.sin(TAU * t / TBL); }
  for (const K of levels) {
    const X = new Float32Array(TBL + 3), Y = new Float32Array(TBL + 3);
    for (let t = 0; t < TBL; t++) {
      let sx = 0, sy = 0;
      for (let k = 1; k <= K; k++) {
        const q = (k * t) % TBL, c = cs[q], s = sn[q];
        sx += pr[k] * c - pi[k] * s + nr[k] * c + ni[k] * s;
        sy += pr[k] * s + pi[k] * c - nr[k] * s + ni[k] * c;
      }
      X[t] = sx; Y[t] = sy;
    }
    X[TBL] = X[0]; X[TBL + 1] = X[1]; X[TBL + 2] = X[2]; Y[TBL] = Y[0]; Y[TBL + 1] = Y[1]; Y[TBL + 2] = Y[2];
    tx.push(X); ty.push(Y);
  }
  let mx = 0, my = 0; for (let k = 0; k < m; k++) { mx += px[k]; my += py[k]; }
  return { m, word, px, py, H, norm, levels, tx, ty, mx: mx / m, my: my / m };
}
function cubic(T, pos) { // Catmull–Rom on a wrapped table (T has 3 guard samples)
  const i = pos | 0, f = pos - i, i0 = i === 0 ? TBL - 1 : i - 1;
  const a = T[i0], b = T[i], c = T[i + 1], d = T[i + 2];
  return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
}
export function renderOrbit(v, patch, g, L, R, n, trail) {
  const d = engineData(patch, g), sr = g.sr;
  const atk = 1 / Math.max(1, g.attack * sr), dec = Math.exp(-1 / Math.max(1, g.decay * sr / 4)), rel = Math.exp(-1 / Math.max(1, g.release * sr / 4));
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  const U = 1 + Math.round(g.ring * 3), det = g.ring * 0.012; // unison copies, detune spread (ratio)
  if (!v.started) { v.started = true; v.env = 0; v.stage = 0; v.ph = new Float64Array(4); for (let u = 0; u < 4; u++) v.ph[u] = rnd(v); v.sub = 0; v.vibT = 0; v.lx = 0; v.ly = 0; v.vibK = 1; }
  const amp = patch.norm * d.norm * v.vel / Math.sqrt(U);
  const vibW = TAU * g.vibRate;
  let lvl = d.levels.length - 1, X = d.tx[lvl], Y = d.ty[lvl], lp = 1;
  for (let i = 0; i < n; i++) {
    if (v.rel) { v.env *= rel; if (v.env < 1e-4) { v.active = false; return false; } }
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    else { v.env = g.sustain + (v.env - g.sustain) * dec; }
    v.f += (v.fTarget - v.f) * gl;
    v.vibT += 1 / sr;
    if ((i & 31) === 0) {
      const vd = g.vibDepth * Math.min(1, Math.max(0, (v.vibT - g.vibDelay) / 0.4));
      v.vibK = vd ? Math.exp(vd * Math.sin(v.vibT * vibW) * 0.000577622650466621) : 1;
      // pick the richest table whose top harmonic stays under 0.45·sr (highest unison copy)
      const fTop = v.f * v.vibK * (1 + det), Kmax = Math.floor(0.45 * sr / fTop);
      lvl = 0; while (lvl + 1 < d.levels.length && d.levels[lvl + 1] <= Kmax) lvl++;
      if (d.levels[lvl] > Kmax) lvl = -1; // even the fundamental is above Nyquist
      if (lvl >= 0) { X = d.tx[lvl]; Y = d.ty[lvl]; }
      const fc = Math.min(0.45 * sr, Math.max(60, g.throat * (v.kmod || 1) * (1 - g.bloom + g.bloom * v.env)));
      lp = 1 - Math.exp(-TAU * fc / sr);
    }
    const f = v.f * v.vibK;
    let x = 0, y = 0, x0 = 0, y0 = 0;
    if (lvl >= 0) for (let u = 0; u < U; u++) {
      const fu = f * (1 + (U > 1 ? (u / (U - 1) - 0.5) * 2 * det : 0));
      let ph = v.ph[u] + fu / sr; ph -= Math.floor(ph); v.ph[u] = ph;
      const pos = ph * TBL;
      const cx = cubic(X, pos), cy = cubic(Y, pos);
      x += cx; y += cy;
      if (u === 0) { x0 = cx; y0 = cy; }
    }
    // brightness: one-pole low-pass (same magnitude law as 1/√(1+(f/fc)²))
    v.lx += lp * (x - v.lx); v.ly += lp * (y - v.ly);
    const sub = 0;
    const nz = g.breath > 0 ? (rnd(v) * 2 - 1) * g.breath * 0.05 / (d.norm || 1) * Math.sqrt(U) : 0;
    const e = v.env * amp;
    L[i] += (v.lx + sub + nz) * e; R[i] += (v.ly + sub - nz) * e;
    if (trail && (v.age + i) % 4 === 0) trail.push(d.mx + x0, d.my + y0); // the loop sits where the orbit really is on the flame
  }
  v.age += n;
  return true;
}

// ===================== CLOUD =====================
function cloudData(patch, g) {
  const acc = [0, 0], xs = [], ys = [];
  let x = patch.cx, y = patch.cy, s = 99;
  const pick = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; let t = s / 4294967296, i = 0; for (; i < patch.n - 1; i++) { t -= patch.w[i]; if (t < 0) break; } return i; };
  for (let k = 0; k < 3000; k++) { applyXf(patch.P, pick(), x, y, acc, k & 1); x = acc[0]; y = acc[1]; if (!(Math.abs(x) < 50 && Math.abs(y) < 50)) { x = patch.cx; y = patch.cy; } if (k > 20) { xs.push(x); ys.push(y); } }
  const q = (a, f) => { const b = a.slice().sort((p, r) => p - r); return b[Math.floor(f * (b.length - 1))]; };
  const x0 = q(xs, 0.03), x1 = q(xs, 0.97), y0 = q(ys, 0.03), y1 = q(ys, 0.97);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: Math.max(1e-3, (x1 - x0) / 2), hy: Math.max(1e-3, (y1 - y0) / 2) };
}
const PENTA = [0, 3, 5, 7, 10];
function grainRatio(tuning, ny, oct) {
  if (tuning === 0) { const H = Math.max(2, Math.round(Math.pow(2, oct) * 1.5)); return 1 + Math.round((ny + 1) / 2 * (H - 1)); }
  if (tuning === 1) { const st = ny * oct * 12, o = Math.floor(st / 12), r = st - o * 12; let b = 0; for (const p of PENTA) if (Math.abs(p - r) < Math.abs(b - r)) b = p; if (Math.abs(12 - r) < Math.abs(b - r)) b = 12; return Math.pow(2, o + b / 12); }
  if (tuning === 2) return Math.pow(2, ny * oct);
  if (tuning === 3) return Math.pow(2, Math.round(ny * oct));
  return Math.pow(2, Math.round(ny * oct * 12 / 7) * 7 / 12);
}
export function renderCloud(v, patch, g, L, R, n, trail) {
  const d = engineData(patch, g), sr = g.sr, nx = patch.n;
  const atk = 1 / Math.max(1, g.attack * sr), dec = Math.exp(-1 / Math.max(1, g.decay * sr / 4)), rel = Math.exp(-1 / Math.max(1, g.release * sr / 4));
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  const G = 16;
  if (!v.started) {
    v.started = true; v.env = 0; v.stage = 0; v.next = 0;
    v.gc = new Float64Array(G); v.gs = new Float64Array(G); v.gwc = new Float64Array(G); v.gws = new Float64Array(G); v.gpos = new Float64Array(G); v.glen = new Float64Array(G);
    v.gl = new Float64Array(G); v.gr = new Float64Array(G); v.gnz = new Uint8Array(G); v.gon = new Uint8Array(G);
    v.cz = [d.cx, d.cy];
  }
  const density = (4 + g.body * g.body * 300 * (1 - g.bloom * 0.6 + g.bloom * 0.6 * v.env)) * (v.kmod || 1); // grains/s
  const glen = (0.006 + g.ring * g.ring * 0.45) * sr;
  const oct = g.throat / 1200, tuning = g.address | 0;
  const atkFrac = 0.04 + (1 - g.bloom) * 0.45;
  const amp = patch.norm * v.vel * 0.9 / Math.sqrt(1 + density * (glen / sr));
  const acc = [0, 0];
  for (let i = 0; i < n; i++) {
    if (v.rel) { v.env *= rel; if (v.env < 1e-4) { v.active = false; return false; } }
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    else { v.env = g.sustain + (v.env - g.sustain) * dec; }
    v.f += (v.fTarget - v.f) * gl;
    if (--v.next <= 0 && !v.rel) { // spawn: one chaos-game step picks the grain
      v.next = sr / density * (0.4 + 1.2 * rnd(v));
      let t = rnd(v), k = 0; for (; k < nx - 1; k++) { t -= patch.w[k]; if (t < 0) break; }
      applyXf(patch.P, k, v.cz[0], v.cz[1], acc, rnd(v) < 0.5 ? 1 : 0);
      v.cz[0] = acc[0]; v.cz[1] = acc[1];
      if (!(Math.abs(acc[0]) < 50 && Math.abs(acc[1]) < 50)) { v.cz[0] = d.cx; v.cz[1] = d.cy; }
      const nxn = Math.max(-1, Math.min(1, (v.cz[0] - d.cx) / d.hx)), nyn = Math.max(-1, Math.min(1, (v.cz[1] - d.cy) / d.hy));
      let fr = v.f * grainRatio(tuning, nyn, oct);
      while (fr < 40) fr *= 2; // fold sub-audible grains up by octaves
      let slot = -1; for (let s = 0; s < G; s++) if (!v.gon[s]) { slot = s; break; }
      if (slot >= 0 && fr < sr * 0.45) {
        const ph0 = TAU * rnd(v), w0 = TAU * fr / sr;
        v.gon[slot] = 1; v.gc[slot] = Math.cos(ph0); v.gs[slot] = Math.sin(ph0); v.gwc[slot] = Math.cos(w0); v.gws[slot] = Math.sin(w0); v.gpos[slot] = 0;
        v.glen[slot] = glen * (0.7 + 0.6 * rnd(v)) * Math.min(1, 600 / fr + 0.35);
        const pan = (nxn + 1) * Math.PI / 4;
        v.gl[slot] = Math.cos(pan); v.gr[slot] = Math.sin(pan);
        v.gnz[slot] = rnd(v) < g.breath ? 1 : 0;
        if (trail) trail.push(v.cz[0], v.cz[1]);
      }
    }
    let l = 0, r = 0;
    for (let s = 0; s < G; s++) {
      if (!v.gon[s]) continue;
      const p = v.gpos[s] / v.glen[s];
      if (p >= 1) { v.gon[s] = 0; continue; }
      let w;
      if (p < atkFrac) { const a = p / atkFrac; w = a * a * (3 - 2 * a); } else { const q = 1 - (p - atkFrac) / (1 - atkFrac); w = q * q; }
      let sm;
      if (v.gnz[s]) sm = (rnd(v) * 2 - 1) * 0.6;
      else { // recursive oscillator (rotation), 2nd harmonic from sin 2θ = 2 sin θ cos θ
        const c = v.gc[s], sn = v.gs[s];
        v.gc[s] = c * v.gwc[s] - sn * v.gws[s]; v.gs[s] = c * v.gws[s] + sn * v.gwc[s];
        sm = sn + 0.24 * sn * c;
      }
      sm *= w;
      l += sm * v.gl[s]; r += sm * v.gr[s];
      v.gpos[s]++;
    }
    const e = v.env * amp;
    L[i] += l * e; R[i] += r * e;
  }
  v.age += n;
  return true;
}

// ---------- dispatch + offline helpers ----------
/** Render any engine. Voice expects the oversampled rate in g.sr; the others run at the base rate. */
export function renderAny(v, patch, g, L, R, n, trail) {
  switch (g.engine) {
    case 'bell': return renderBell(v, patch, g, L, R, n, trail);
    case 'orbit': return renderOrbit(v, patch, g, L, R, n, trail);
    case 'cloud': return renderCloud(v, patch, g, L, R, n, trail);
    default: return renderVoice(v, patch, g, L, R, n, trail);
  }
}

/** Render one voice offline exactly as the worklet does (oversampled + decimated for Voice). */
export function renderOffline(v, patch, g, seconds, os = OS) {
  const sr = g.sr, n = Math.floor(sr * seconds), B = 128, engine = g.engine || 'voice';
  const L = new Float32Array(n), R = new Float32Array(n);
  if (engine !== 'voice') {
    for (let o = 0; o < n; o += B) renderAny(v, patch, g, L.subarray(o, Math.min(n, o + B)), R.subarray(o, Math.min(n, o + B)), Math.min(B, n - o));
    return { L, R };
  }
  const gh = Object.assign({}, g, { sr: sr * os, os });
  const hL = new Float32Array(B * os), hR = new Float32Array(B * os), oL = new Float32Array(B), oR = new Float32Array(B);
  const dL = new Decimator(os), dR = new Decimator(os);
  for (let o = 0; o < n; o += B) {
    hL.fill(0); hR.fill(0);
    renderVoice(v, patch, gh, hL, hR, B * os);
    dL.process(hL, oL); dR.process(hR, oR);
    L.set(oL.subarray(0, Math.min(B, n - o)), o); R.set(oR.subarray(0, Math.min(B, n - o)), o);
  }
  return { L, R };
}

/** RMS of a patch as heard → loudness normalisation for any engine. */
export function measurePatch(P, g, ring) {
  const prep = preparePatch(P, { ring, norm: 1 });
  const engine = g.engine || 'voice';
  const v = makeVoice(7); v.active = true; v.vel = 1; v.f = v.fTarget = 196;
  if (engine === 'voice') { v.env = 1; v.stage = 1; }
  // measure as played: keep the engine's own attack (bowed bells and pads swell), then a window after it
  const atk = engine === 'voice' ? 0.001 : Math.min(1.5, g.attack);
  const gg = Object.assign({}, g, { attack: atk, sustain: 1, decay: 1, glide: 0, vibDepth: 0, bloom: engine === 'voice' ? 0 : g.bloom, breath: engine === 'voice' ? 0 : g.breath });
  const bowed = engine === 'bell' && ((g.address | 0) === 3 || (g.address | 0) === 4); // bowed bodies build up to steady state
  const win = bowed ? 2.5 : engine === 'bell' ? 0.35 : engine === 'cloud' ? 0.8 : 0.16;
  const { L, R } = renderOffline(v, prep, gg, atk + win);
  const n = L.length, skip = engine === 'voice' ? Math.floor(n * 0.35) : Math.floor((atk + (bowed ? 1.5 : 0)) * g.sr);
  let e = 0;
  for (let i = skip; i < n; i++) e += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(e / (2 * (n - skip)));
  const target = engine === 'bell' ? 0.24 : 0.2;
  return { cx: prep.cx, cy: prep.cy, rms, norm: rms > 1e-6 ? Math.min(40, target / rms) : 1 };
}

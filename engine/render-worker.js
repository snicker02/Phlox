// Phlox v1.2.1 — progressive flame renderer (chaos game → supersampled log-density histogram),
// off the main thread.
//  · supersampling: the histogram is ss× the output in each axis and box-filtered down (anti-aliasing)
//  · robust density normalisation: log-density relative to a high percentile of the occupied bins
//    (not the single brightest bin, which made images darken and flicker as one hot pixel grew)
//  · symmetry (visual): every plotted point lands under a random element of the chosen
//    rotation / dihedral group about the flame's centre
//  · output alpha is pre-encoded with a square root so the 8-bit texture keeps detail in faint areas
import { applyXf, XF_STRIDE } from './flame.js';

let W = 2, H = 2, SS = 1, HW = 2, HH = 2; // output size, supersampling, histogram size
let cnt = null, cr = null, cg = null, cb = null;
let P = null, nx = 0, cum = null, cols = null;
let cam = { cx: 0, cy: 0, scale: 1.2 };
let lut = new Uint8Array(256 * 3).fill(200);
let px = 0.1, py = 0.1, pc = 0.5, jbit = 0;
let lastPost = 0, running = false, dirtyFit = false, total = 0;
let sym = { n: 1, mirror: false, cx: 0, cy: 0 }, symCos = new Float64Array(1).fill(1), symSin = new Float64Array(1);
let fps = 30;
// lazy fading: instead of multiplying every bin on each update, new samples are added with a growing
// weight wAdd; densities are divided by it at tonemap time (O(1) per update instead of O(bins))
let wAdd = 1, lastXfT = 0;
const acc = [0, 0];
let seed = 12345;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

function alloc(w, h, ss) {
  W = w; H = h;
  SS = ss || 1;
  // keep the histogram under ~5 M bins (memory + tonemap time); big exports fall back to ss = 1
  while (SS > 1 && W * H * SS * SS > 5e6) SS--;
  HW = W * SS; HH = H * SS;
  cnt = new Float32Array(HW * HH); cr = new Float32Array(HW * HH); cg = new Float32Array(HW * HH); cb = new Float32Array(HW * HH);
  total = 0; wAdd = 1;
}
function decay(k) {
  if (!cnt) return;
  if (k <= 0) { cnt.fill(0); cr.fill(0); cg.fill(0); cb.fill(0); wAdd = 1; total = 0; return; }
  wAdd /= k; total *= k;
  if (wAdd > 1e12) { // renormalise long before float32 runs out of range
    const s = 1 / wAdd;
    for (let i = 0; i < cnt.length; i++) { cnt[i] *= s; cr[i] *= s; cg[i] *= s; cb[i] *= s; }
    wAdd = 1;
  }
}

function setXf(p) {
  P = p; nx = p.length / XF_STRIDE;
  cum = new Float32Array(nx); cols = new Float32Array(nx);
  let t = 0;
  for (let i = 0; i < nx; i++) { t += Math.max(0, P[i * XF_STRIDE + 6]); cum[i] = t; cols[i] = P[i * XF_STRIDE + 7]; }
  if (t <= 0) for (let i = 0; i < nx; i++) cum[i] = (i + 1) / nx; else for (let i = 0; i < nx; i++) cum[i] /= t;
}
function setSym(s) {
  sym = { n: Math.max(1, s.n | 0), mirror: !!s.mirror, cx: sym.cx, cy: sym.cy }; // centre comes from fit()
  symCos = new Float64Array(sym.n); symSin = new Float64Array(sym.n);
  for (let k = 0; k < sym.n; k++) { symCos[k] = Math.cos(2 * Math.PI * k / sym.n); symSin[k] = Math.sin(2 * Math.PI * k / sym.n); }
}
function pick() { const r = rnd(); for (let i = 0; i < nx - 1; i++) if (r < cum[i]) return i; return nx - 1; }
function step() {
  const i = pick();
  jbit = rnd() < 0.5 ? 1 : 0;
  applyXf(P, i, px, py, acc, jbit, 1);
  px = acc[0]; py = acc[1];
  pc = (pc + cols[i]) * 0.5;
  if (!(Math.abs(px) < 1e4 && Math.abs(py) < 1e4)) { px = rnd() * 2 - 1; py = rnd() * 2 - 1; }
}

function iterate(count) {
  if (!P || !nx || !cnt) return;
  const s = Math.min(HW, HH) / (2 * cam.scale);
  const ox = HW / 2 - cam.cx * s, oy = HH / 2 + cam.cy * s;
  const useSym = sym.n > 1 || sym.mirror;
  for (let k = 0; k < count; k++) {
    step();
    let x = px, y = py;
    if (useSym) {
      let dx = x - sym.cx, dy = y - sym.cy;
      if (sym.mirror && rnd() < 0.5) dx = -dx;
      if (sym.n > 1) { const g = (rnd() * sym.n) | 0, c = symCos[g], si = symSin[g]; const t = dx * c - dy * si; dy = dx * si + dy * c; dx = t; }
      x = sym.cx + dx; y = sym.cy + dy;
    }
    // sub-pixel jitter: spreads each point over neighbouring bins on average (less stair-stepping)
    const fx = x * s + ox + rnd() - 0.5, fy = oy - y * s + rnd() - 0.5;
    const ix = fx | 0, iy = fy | 0;
    if (fx < 0 || fy < 0 || ix >= HW || iy >= HH) continue;
    const o = iy * HW + ix, ci = Math.min(255, Math.max(0, (pc * 255) | 0)) * 3;
    cnt[o] += wAdd; cr[o] += lut[ci] * wAdd; cg[o] += lut[ci + 1] * wAdd; cb[o] += lut[ci + 2] * wAdd;
  }
  total += count;
}

function fit() {
  if (!P || !nx) return;
  const xs = [], ys = [];
  for (let k = 0; k < 20; k++) step();
  for (let k = 0; k < 24000; k++) { step(); xs.push(px); ys.push(py); }
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
  let minx = q(xs, 0.004), maxx = q(xs, 0.996), miny = q(ys, 0.004), maxy = q(ys, 0.996);
  // robust centre of mass (trimmed to the 0.4–99.6 % box) → the symmetry centre
  let mx = 0, my = 0, m = 0;
  for (let i = 0; i < xs.length; i++) if (xs[i] >= minx && xs[i] <= maxx && ys[i] >= miny && ys[i] <= maxy) { mx += xs[i]; my += ys[i]; m++; }
  mx /= Math.max(1, m); my /= Math.max(1, m);
  sym.cx = mx; sym.cy = my;
  if (sym.n > 1) { // rotated copies fill a disc around the centre
    const rs = xs.map((x, i) => Math.hypot(x - mx, ys[i] - my));
    const R = q(rs, 0.996);
    minx = mx - R; maxx = mx + R; miny = my - R; maxy = my + R;
  } else if (sym.mirror) { // mirror copies: symmetric in x about the centre
    const dx = Math.max(maxx - mx, mx - minx);
    minx = mx - dx; maxx = mx + dx;
  }
  self.postMessage({ type: 'bounds', minx, maxx, miny, maxy, mx, my });
}

// symmetry centre only (cheap): keeps copies centred while Wander / morph / edits move the flame
function centre() {
  if (!P || !nx) return;
  let x0 = px, y0 = py, mx = 0, my = 0, m = 0;
  for (let k = 0; k < 20; k++) step();
  for (let k = 0; k < 3000; k++) { step(); if (Math.abs(px) < 1e3 && Math.abs(py) < 1e3) { mx += px; my += py; m++; } }
  if (m) { const a = sym.cx === 0 && sym.cy === 0 ? 1 : 0.5; sym.cx += (mx / m - sym.cx) * a; sym.cy += (my / m - sym.cy) * a; }
  px = x0; py = y0;
}

// buffers handed back by the main thread after upload (avoids a fresh 8 MB allocation per frame)
const pool = [];
let dens = null, R = null, G = null, B = null;
function tonemap() {
  const n = W * H;
  if (!dens || dens.length !== n) { dens = new Float32Array(n); R = new Float32Array(n); G = new Float32Array(n); B = new Float32Array(n); }
  const ss2 = SS * SS;
  // 1. box-filter the supersampled histogram down to the output grid
  let occupied = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = 0, r = 0, g = 0, b = 0;
    for (let j = 0; j < SS; j++) {
      let o = (y * SS + j) * HW + x * SS;
      for (let i = 0; i < SS; i++, o++) { c += cnt[o]; r += cr[o]; g += cg[o]; b += cb[o]; }
    }
    const p = y * W + x;
    dens[p] = c / (ss2 * wAdd); R[p] = r; G[p] = g; B[p] = b;
    if (c > 0) occupied++;
  }
  // 2. reference density = 99.5th percentile of occupied pixels (sampled), not the maximum
  let ref = 1;
  if (occupied > 0) {
    const sample = [], stp = Math.max(1, Math.floor(n / 6000));
    for (let p = 0; p < n; p += stp) if (dens[p] > 0) sample.push(dens[p]);
    if (sample.length) { sample.sort((a, b) => a - b); ref = Math.max(1e-6, sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.995))]); }
  }
  const ln = 1 / Math.log(1 + ref * 4);
  let out = pool.pop();
  if (!out || out.length !== n * 4) out = new Uint8Array(n * 4);
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const d = dens[p];
    if (d <= 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; continue; }
    const ic = 1 / (d * ss2 * wAdd);
    out[o] = R[p] * ic; out[o + 1] = G[p] * ic; out[o + 2] = B[p] * ic;
    // log density relative to the reference, 1.25× headroom for highlights, √-encoded for 8-bit precision
    const a = Math.min(1.25, Math.log(1 + d * 4) * ln) / 1.25;
    out[o + 3] = Math.min(255, Math.round(Math.sqrt(a) * 255));
  }
  self.postMessage({ type: 'frame', W, H, data: out, total, ss: SS }, [out.buffer]);
}

let budgetPts = 260000;
function loop() {
  if (!running) return;
  const t0 = performance.now();
  if (dirtyFit) { dirtyFit = false; fit(); }
  let done = 0;
  const frameMs = 1000 / fps;
  while (performance.now() - t0 < frameMs * 0.65 && done < budgetPts) { iterate(20000); done += 20000; }
  if (cnt && P && performance.now() - lastPost > frameMs) { lastPost = performance.now(); tonemap(); }
  setTimeout(loop, 2);
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'size') { alloc(d.W, d.H, d.ss); }
  else if (d.type === 'xf') {
    // timed updates (Wander) fade by elapsed time, so trails last the same at any update rate
    const now = performance.now(), dt = lastXfT ? now - lastXfT : 33.3; lastXfT = now;
    const keep = d.keep ?? 0.2;
    setXf(d.P); decay(d.timed ? Math.pow(keep, Math.min(6, Math.max(0.2, dt / 33.3))) : keep); if (d.fit) dirtyFit = true; for (let k = 0; k < 30; k++) step(); if ((sym.n > 1 || sym.mirror) && !d.fit) centre(); }
  else if (d.type === 'cam') { cam = d.cam; decay(0); }
  else if (d.type === 'palette') { lut = d.lut; decay(0); }
  else if (d.type === 'quality') { budgetPts = d.pts; if (d.fps) fps = d.fps; }
  else if (d.type === 'sym') { setSym(d.sym); decay(0); if (sym.n > 1 || sym.mirror) centre(); }
  else if (d.type === 'fit') { dirtyFit = true; }
  else if (d.type === 'recycle') { if (d.buf && d.buf.byteLength === W * H * 4) pool.push(new Uint8Array(d.buf)); }
  if (!running) { running = true; loop(); }
};

// Phlox — progressive flame renderer (chaos game → log-density histogram), off the main thread.
import { applyXf, XF_STRIDE } from './flame.js';

let W = 2, H = 2, cnt = null, cr = null, cg = null, cb = null;
let P = null, nx = 0, cum = null, cols = null;
let cam = { cx: 0, cy: 0, scale: 1.2 };
let lut = new Uint8Array(256 * 3).fill(200);
let px = 0.1, py = 0.1, pc = 0.5, jbit = 0;
let lastPost = 0, running = false, dirtyFit = false, total = 0;
const acc = [0, 0];
let seed = 12345;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

function alloc(w, h) {
  W = w; H = h;
  cnt = new Float32Array(W * H); cr = new Float32Array(W * H); cg = new Float32Array(W * H); cb = new Float32Array(W * H);
  total = 0;
}
function decay(k) { if (!cnt) return; for (let i = 0; i < cnt.length; i++) { cnt[i] *= k; cr[i] *= k; cg[i] *= k; cb[i] *= k; } total *= k; }

function setXf(p) {
  P = p; nx = p.length / XF_STRIDE;
  cum = new Float32Array(nx); cols = new Float32Array(nx);
  let t = 0;
  for (let i = 0; i < nx; i++) { t += Math.max(0, P[i * XF_STRIDE + 6]); cum[i] = t; cols[i] = P[i * XF_STRIDE + 7]; }
  if (t <= 0) for (let i = 0; i < nx; i++) cum[i] = (i + 1) / nx; else for (let i = 0; i < nx; i++) cum[i] /= t;
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
  const s = Math.min(W, H) / (2 * cam.scale);
  const ox = W / 2 - cam.cx * s, oy = H / 2 + cam.cy * s;
  for (let k = 0; k < count; k++) {
    step();
    const ix = (px * s + ox) | 0, iy = (oy - py * s) | 0;
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
    const o = iy * W + ix, ci = Math.min(255, Math.max(0, (pc * 255) | 0)) * 3;
    cnt[o] += 1; cr[o] += lut[ci]; cg[o] += lut[ci + 1]; cb[o] += lut[ci + 2];
  }
  total += count;
}

function fit() {
  if (!P || !nx) return;
  const xs = [], ys = [];
  for (let k = 0; k < 20; k++) step();
  for (let k = 0; k < 24000; k++) { step(); xs.push(px); ys.push(py); }
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
  const minx = q(xs, 0.004), maxx = q(xs, 0.996), miny = q(ys, 0.004), maxy = q(ys, 0.996);
  let mx = 0, my = 0; for (let i = 0; i < xs.length; i++) { mx += xs[i]; my += ys[i]; }
  self.postMessage({ type: 'bounds', minx, maxx, miny, maxy, mx: mx / xs.length, my: my / ys.length });
}

function tonemap() {
  let mx = 1;
  for (let i = 0; i < cnt.length; i++) if (cnt[i] > mx) mx = cnt[i];
  const ln = 1 / Math.log(1 + mx), out = new Uint8Array(W * H * 4);
  for (let i = 0, o = 0; i < cnt.length; i++, o += 4) {
    const c = cnt[i];
    if (c <= 0) continue;
    const ic = 1 / c;
    out[o] = cr[i] * ic; out[o + 1] = cg[i] * ic; out[o + 2] = cb[i] * ic;
    out[o + 3] = Math.min(255, Math.log(1 + c) * ln * 255);
  }
  self.postMessage({ type: 'frame', W, H, data: out, total }, [out.buffer]);
}

let budgetPts = 260000;
function loop() {
  if (!running) return;
  const t0 = performance.now();
  if (dirtyFit) { dirtyFit = false; fit(); }
  let done = 0;
  while (performance.now() - t0 < 22 && done < budgetPts) { iterate(20000); done += 20000; }
  if (cnt && P && performance.now() - lastPost > 33) { lastPost = performance.now(); tonemap(); }
  setTimeout(loop, 4);
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'size') { alloc(d.W, d.H); }
  else if (d.type === 'xf') { setXf(d.P); decay(d.keep ?? 0.2); if (d.fit) dirtyFit = true; for (let k = 0; k < 30; k++) step(); }
  else if (d.type === 'cam') { cam = d.cam; decay(0); }
  else if (d.type === 'palette') { lut = d.lut; decay(0); }
  else if (d.type === 'quality') { budgetPts = d.pts; }
  else if (d.type === 'fit') { dirtyFit = true; }
  if (!running) { running = true; loop(); }
};

// Phlox v1.2.1 — shared flame math: variations, transforms, presets, and the voice DSP.
// Imported by the AudioWorklet, the render worker, the UI and the Node tests.
//
// The idea: iterating an affine map z ← A z + b at audio rate is a two-pole resonator
// (eigenvalues of A = pole pair). A flame transform's rotation is a formant frequency,
// its contraction is the formant bandwidth. Switching transforms once per pitch period
// is the glottal pulse. Random switching (the chaos game) is breath noise.

export const VARS = [
  'linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe', 'polar', 'handkerchief', 'heart', 'disc', 'spiral',
  'hyperbolic', 'diamond', 'julia', 'bubble', 'fisheye', 'eyefish', 'cylinder', 'tangent', 'cosine', 'exponential', 'bent', 'waves',
];
export const VAR_INDEX = Object.fromEntries(VARS.map((v, i) => [v, i]));

const PI = Math.PI;
// Writes variation `t` of (x,y) scaled by w into acc[0], acc[1] (added). j = parity for julia branch.
// soft = true (audio path): polar/heart/disc taper to zero at the atan2 cut so the voice never jumps.
const cutTaper = (a) => { const u = Math.min(1, Math.max(0, (Math.PI - Math.abs(a)) / 0.7)); return u * u * (3 - 2 * u); };
export function addVar(t, w, x, y, acc, j, soft) {
  let ox = 0, oy = 0;
  const r2 = x * x + y * y + 1e-12;
  switch (t) {
    case 0: ox = x; oy = y; break;
    case 1: ox = Math.sin(x); oy = Math.sin(y); break;
    case 2: ox = x / r2; oy = y / r2; break;
    case 3: { const s = Math.sin(r2), c = Math.cos(r2); ox = x * s - y * c; oy = x * c + y * s; break; }
    case 4: { const r = Math.sqrt(r2); ox = (x - y) * (x + y) / r; oy = 2 * x * y / r; break; }
    case 5: { const a = Math.atan2(x, y); ox = a / PI * (soft ? cutTaper(a) : 1); oy = Math.sqrt(r2) - 1; break; }
    case 6: { const r = Math.sqrt(r2), a = Math.atan2(x, y); ox = r * Math.sin(a + r); oy = r * Math.cos(a - r); break; }
    case 7: { const r = Math.sqrt(r2), th = Math.atan2(x, y), a = th * r; ox = r * Math.sin(a) * (soft ? cutTaper(th) : 1); oy = -r * Math.cos(a); break; }
    case 8: { const r = Math.sqrt(r2), th = Math.atan2(x, y), a = th / PI * (soft ? cutTaper(th) : 1); ox = a * Math.sin(PI * r); oy = a * Math.cos(PI * r); break; }
    case 9: { const r = Math.sqrt(r2), a = Math.atan2(x, y); ox = (Math.cos(a) + Math.sin(r)) / r; oy = (Math.sin(a) - Math.cos(r)) / r; break; }
    case 10: { const r = Math.sqrt(r2), a = Math.atan2(x, y); ox = Math.sin(a) / r; oy = r * Math.cos(a); break; }
    case 11: { const r = Math.sqrt(r2), a = Math.atan2(x, y); ox = Math.sin(a) * Math.cos(r); oy = Math.cos(a) * Math.sin(r); break; }
    case 12: { const r = Math.sqrt(Math.sqrt(r2)), a = Math.atan2(y, x) * 0.5 + (j ? PI : 0); ox = r * Math.cos(a); oy = r * Math.sin(a); break; }
    case 13: { const s = 4 / (r2 + 4); ox = x * s; oy = y * s; break; }
    case 14: { const s = 2 / (Math.sqrt(r2) + 1); ox = y * s; oy = x * s; break; }
    case 15: { const s = 2 / (Math.sqrt(r2) + 1); ox = x * s; oy = y * s; break; }
    case 16: ox = Math.sin(x); oy = y; break;
    case 17: { const cy = Math.cos(y); ox = Math.sin(x) / (Math.abs(cy) < 1e-3 ? 1e-3 : cy); oy = Math.tan(y); break; }
    case 18: { const a = PI * x; ox = Math.cos(a) * Math.cosh(y); oy = -Math.sin(a) * Math.sinh(y); break; }
    case 19: { const e = Math.exp(Math.min(8, x - 1)), a = PI * y; ox = e * Math.cos(a); oy = e * Math.sin(a); break; }
    case 20: ox = x < 0 ? 2 * x : x; oy = y < 0 ? y * 0.5 : y; break;
    case 21: ox = x + 0.25 * Math.sin(y * 4); oy = y + 0.25 * Math.sin(x * 4); break;
    default: ox = x; oy = y;
  }
  acc[0] += w * ox; acc[1] += w * oy;
}

/** Decomposed transform (what the UI edits). Angles in degrees. */
export function makeXf(o = {}) {
  return {
    rot: o.rot ?? 0, sx: o.sx ?? 0.5, sy: o.sy ?? 0.5, shear: o.shear ?? 0, tx: o.tx ?? 0, ty: o.ty ?? 0,
    w: o.w ?? 1, col: o.col ?? 0, lin: o.lin ?? 1, v1: o.v1 ?? 'sinusoidal', a1: o.a1 ?? 0, v2: o.v2 ?? 'swirl', a2: o.a2 ?? 0,
  };
}

export function matrixOf(x) {
  const t = x.rot * PI / 180, c = Math.cos(t), s = Math.sin(t);
  return { a: c * x.sx, b: c * x.shear - s * x.sy, c: s * x.sx, d: s * x.shear + c * x.sy, e: x.tx, f: x.ty };
}
/** Inverse of matrixOf: set rot/sx/sy/shear from matrix columns (a,c) and (b,d). */
export function setMatrix(x, a, b, c, d) {
  const sx = Math.hypot(a, c) || 1e-6, t = Math.atan2(c, a), co = Math.cos(t), si = Math.sin(t);
  x.sx = sx; x.rot = t * 180 / PI; x.shear = co * b + si * d; x.sy = -si * b + co * d;
}

export const XF_STRIDE = 16;
/** Pack transforms into a Float32Array for the worklet / worker. */
export function compile(xfs) {
  const n = xfs.length, out = new Float32Array(n * XF_STRIDE);
  xfs.forEach((x, i) => {
    const m = matrixOf(x), o = i * XF_STRIDE;
    out[o] = m.a; out[o + 1] = m.b; out[o + 2] = m.c; out[o + 3] = m.d; out[o + 4] = m.e; out[o + 5] = m.f;
    out[o + 6] = Math.max(0, x.w); out[o + 7] = x.col;
    out[o + 8] = 0; out[o + 9] = x.lin;
    out[o + 10] = VAR_INDEX[x.v1] ?? 1; out[o + 11] = x.a1;
    out[o + 12] = VAR_INDEX[x.v2] ?? 3; out[o + 13] = x.a2;
    out[o + 14] = 0; out[o + 15] = 0;
  });
  return out;
}

/** Apply packed transform i to (x,y) → acc. ringScale multiplies the linear part. */
export function applyXf(P, i, x, y, acc, j, ringScale = 1) {
  const o = i * XF_STRIDE;
  const tx = (P[o] * x + P[o + 1] * y) * ringScale + P[o + 4];
  const ty = (P[o + 2] * x + P[o + 3] * y) * ringScale + P[o + 5];
  acc[0] = 0; acc[1] = 0;
  for (let v = 8; v < 16; v += 2) { const w = P[o + v + 1]; if (w !== 0) addVar(P[o + v] | 0, w, tx, ty, acc, j); }
  if (!(acc[0] === acc[0]) || !(acc[1] === acc[1]) || Math.abs(acc[0]) > 1e4 || Math.abs(acc[1]) > 1e4) { acc[0] = tx * 0.5; acc[1] = ty * 0.5; }
}

// ---------- morphing ----------
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) { let d = ((b - a) % 360 + 540) % 360 - 180; return a + d * t; }
export function morphXfs(A, B, t) {
  if (t <= 0) return A.map(x => ({ ...x }));
  if (t >= 1) return B.map(x => ({ ...x }));
  const n = Math.max(A.length, B.length), out = [];
  for (let i = 0; i < n; i++) {
    const a = A[i] || { ...(B[i]), w: 0 }, b = B[i] || { ...(A[i]), w: 0 };
    const x = makeXf({
      rot: lerpAngle(a.rot, b.rot, t), sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), shear: lerp(a.shear, b.shear, t),
      tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), w: lerp(a.w, b.w, t), col: lerp(a.col, b.col, t), lin: lerp(a.lin, b.lin, t),
    });
    // variations cross-fade: keep both sides' first variation, second slot carries the other side
    if (a.v1 === b.v1) { x.v1 = a.v1; x.a1 = lerp(a.a1, b.a1, t); x.v2 = a.v2 === b.v2 ? a.v2 : (t < 0.5 ? a.v2 : b.v2); x.a2 = a.v2 === b.v2 ? lerp(a.a2, b.a2, t) : (t < 0.5 ? a.a2 * (1 - 2 * t) : b.a2 * (2 * t - 1)); }
    else { x.v1 = a.v1; x.a1 = a.a1 * (1 - t); x.v2 = b.v1; x.a2 = b.a1 * t; }
    out.push(x);
  }
  return out;
}

// ---------- presets ----------
const X = makeXf;
// Every preset names its engine; `p` overrides that engine's defaults (see ENGINE_DEFAULTS in main.js).
export const PRESETS = {
  choir: { name: 'Sierpiński choir', engine: 'voice', p: { attack: 0.35, release: 1.6, vibDepth: 22, breath: 0.18, throat: 2000 }, xf: [
    X({ rot: 12, sx: 0.5, sy: 0.5, tx: -0.5, ty: -0.35, col: 0.05 }),
    X({ rot: -9, sx: 0.5, sy: 0.5, tx: 0.5, ty: -0.35, col: 0.5 }),
    X({ rot: 4, sx: 0.5, sy: 0.5, tx: 0, ty: 0.5, col: 0.95 }),
  ] },
  reed: { name: 'Spiral reed', engine: 'voice', p: { body: 0.25, breath: 0.02, vibDepth: 10 }, xf: [
    X({ rot: 138, sx: 0.78, sy: 0.74, tx: 0.45, ty: 0.05, col: 0.1, a1: 0.08, v1: 'sinusoidal' }),
    X({ rot: -96, sx: 0.66, sy: 0.7, tx: -0.42, ty: 0.25, col: 0.75 }),
  ] },
  fern: { name: 'Barnsley fern', engine: 'voice', p: { address: 3, breath: 0.08, throat: 2800 }, xf: [
    X({ rot: -2.5, sx: 0.85, sy: 0.85, shear: 0.0, tx: 0, ty: 1.6 * 0.3, w: 0.7, col: 0.35 }),
    X({ rot: 49, sx: 0.3, sy: 0.27, tx: 0, ty: 1.6 * 0.3, w: 0.15, col: 0.7 }),
    X({ rot: 120, sx: 0.3, sy: -0.28, tx: 0, ty: 0.44 * 0.3, w: 0.15, col: 0.95 }),
  ] },
  dragon: { name: 'Twin dragon', engine: 'voice', p: { address: 1, body: 0.35, vibDepth: 6 }, xf: [
    X({ rot: 45, sx: 0.7071, sy: 0.7071, tx: -0.5, ty: 0, col: 0.15 }),
    X({ rot: 135, sx: 0.7071, sy: 0.7071, tx: 0.5, ty: 0, col: 0.85 }),
  ] },
  golden: { name: 'Golden angle', engine: 'voice', xf: [
    X({ rot: 137.508, sx: 0.82, sy: 0.82, tx: 0.3, ty: 0, col: 0.2, w: 1.3 }),
    X({ rot: -137.508, sx: 0.55, sy: 0.55, tx: -0.55, ty: 0.3, col: 0.6 }),
    X({ rot: 68.75, sx: 0.4, sy: 0.4, tx: 0.1, ty: -0.6, col: 0.95, w: 0.7 }),
  ] },
  swirl: { name: 'Swirl growl', engine: 'voice', p: { address: 2, body: 0.3, breath: 0.06 }, xf: [
    X({ rot: 30, sx: 0.6, sy: 0.6, tx: 0.4, ty: 0.2, col: 0.1, lin: 0.4, v1: 'swirl', a1: 0.6 }),
    X({ rot: -70, sx: 0.55, sy: 0.65, tx: -0.45, ty: -0.1, col: 0.55, lin: 0.6, v1: 'swirl', a1: 0.4 }),
    X({ rot: 160, sx: 0.45, sy: 0.45, tx: 0.05, ty: -0.5, col: 0.9, w: 0.6 }),
  ] },
  bell: { name: 'Spherical bell', engine: 'voice', p: { attack: 0.004, decay: 0.9, sustain: 0.25, release: 1.4, bloom: 0.8, vibDepth: 0 }, xf: [
    X({ rot: 0, sx: 0.9, sy: 0.9, tx: 0.2, ty: 0.1, col: 0.2, lin: 0.2, v1: 'spherical', a1: 0.8 }),
    X({ rot: 72, sx: 0.5, sy: 0.5, tx: -0.6, ty: 0.2, col: 0.55 }),
    X({ rot: -144, sx: 0.5, sy: 0.5, tx: 0.3, ty: -0.6, col: 0.85 }),
  ] },
  julia: { name: 'Julia breath', engine: 'voice', p: { breath: 0.38, address: 4, attack: 0.12, vibDepth: 8 }, xf: [
    X({ rot: 20, sx: 0.8, sy: 0.8, tx: 0.3, ty: 0.2, col: 0.15, lin: 0, v1: 'julia', a1: 1 }),
    X({ rot: 100, sx: 0.5, sy: 0.6, tx: -0.4, ty: -0.2, col: 0.7, lin: 0.7, v1: 'sinusoidal', a1: 0.3 }),
  ] },
  heart: { name: 'Heart drone', engine: 'voice', p: { address: 2, body: 0.55, throat: 1700, attack: 0.5, release: 2, vibDepth: 0 }, xf: [
    X({ rot: -15, sx: 0.55, sy: 0.55, tx: 0.2, ty: 0.3, col: 0.05, lin: 0.3, v1: 'heart', a1: 0.6 }),
    X({ rot: 110, sx: 0.6, sy: 0.6, tx: -0.3, ty: -0.2, col: 0.5 }),
    X({ rot: -120, sx: 0.4, sy: 0.4, tx: 0.4, ty: -0.4, col: 0.9, w: 0.5 }),
  ] },
  disc: { name: 'Disc vox', engine: 'voice', p: { address: 1, throat: 3200, vibDepth: 25, vibRate: 6.2 }, xf: [
    X({ rot: 60, sx: 0.7, sy: 0.7, tx: 0.2, ty: 0, col: 0.25, lin: 0.4, v1: 'disc', a1: 0.5 }),
    X({ rot: -150, sx: 0.6, sy: 0.6, tx: -0.4, ty: 0.3, col: 0.65, lin: 0.6, v1: 'polar', a1: 0.25 }),
    X({ rot: 15, sx: 0.35, sy: 0.35, tx: 0.3, ty: -0.5, col: 0.95, w: 0.5 }),
  ] },
  hand: { name: 'Handkerchief', engine: 'voice', p: { attack: 0.005, decay: 0.35, sustain: 0.15, release: 0.5, bloom: 0.9, vibDepth: 0, throat: 3000 }, xf: [
    X({ rot: 80, sx: 0.65, sy: 0.6, tx: 0.35, ty: 0.1, col: 0.1, lin: 0.3, v1: 'handkerchief', a1: 0.5 }),
    X({ rot: -40, sx: 0.55, sy: 0.55, tx: -0.35, ty: -0.25, col: 0.6, lin: 0.8, v1: 'bubble', a1: 0.4 }),
  ] },
  mono: { name: 'Pure formant', engine: 'voice', p: { ring: 0.7, vibDepth: 0, body: 0 }, xf: [
    X({ rot: 95, sx: 0.85, sy: 0.85, tx: 0.5, ty: 0, col: 0.2 }),
    X({ rot: 95, sx: 0.85, sy: 0.85, tx: -0.5, ty: 0, col: 0.8 }),
  ] },

  // ---------- BELL: each transform an inharmonic partial (rotation → ratio, size → ring time) ----------
  bowl: { name: 'Temple bowl', engine: 'bell', p: { throat: 1950, ring: 0.85, body: 0.3, breath: 0.05, address: 3, bloom: 0, attack: 0.25, release: 3 }, xf: [
    X({ rot: 0, sx: 0.9, sy: 0.9, tx: 0.4, ty: 0, col: 0.1 }),
    X({ rot: 75, sx: 0.8, sy: 0.75, tx: -0.3, ty: 0.35, col: 0.5 }),
    X({ rot: 140, sx: 0.7, sy: 0.7, tx: -0.2, ty: -0.5, col: 0.9 }),
  ] },
  marimba: { name: 'Glass marimba', engine: 'bell', p: { throat: 4000, ring: 0.35, body: 0.55, breath: 0.15, address: 0, bloom: 0.1, release: 0.8 }, xf: [
    X({ rot: 0, sx: 0.85, sy: 0.8, tx: 0.5, ty: 0.1, col: 0.15 }),
    X({ rot: 108, sx: 0.6, sy: 0.6, tx: -0.45, ty: 0.2, col: 0.55, w: 0.7 }),
    X({ rot: 179.5, sx: 0.45, sy: 0.5, tx: 0, ty: -0.55, col: 0.9, w: 0.4 }),
  ] },
  gong: { name: 'Gamelan gong', engine: 'bell', p: { throat: 2400, ring: 0.8, body: 0.4, breath: 0.2, address: 1, bloom: 0.6, release: 2.5 }, xf: [
    X({ rot: 0, sx: 0.95, sy: 0.9, tx: 0.3, ty: 0.3, col: 0.05 }),
    X({ rot: 50, sx: 0.8, sy: 0.85, tx: -0.4, ty: 0.25, col: 0.35 }),
    X({ rot: 132, sx: 0.75, sy: 0.7, tx: 0.2, ty: -0.45, col: 0.65 }),
    X({ rot: 177, sx: 0.6, sy: 0.6, tx: -0.35, ty: -0.3, col: 0.95, w: 0.6 }),
  ] },
  chimes: { name: 'Fractal chimes', engine: 'bell', p: { throat: 3000, ring: 0.7, body: 0.7, breath: 0.05, address: 2, bloom: 0.15, release: 2 }, xf: [
    X({ rot: 137.508, sx: 0.82, sy: 0.82, tx: 0.3, ty: 0, col: 0.2, w: 1.3 }),
    X({ rot: -137.508, sx: 0.55, sy: 0.55, tx: -0.55, ty: 0.3, col: 0.6 }),
    X({ rot: 68.75, sx: 0.4, sy: 0.4, tx: 0.1, ty: -0.6, col: 0.95, w: 0.7 }),
  ] },
  plate: { name: 'Iron plate', engine: 'bell', p: { throat: 3600, ring: 0.6, body: 0.65, breath: 0.3, address: 4, bloom: 0.2, release: 1.5 }, xf: [
    X({ rot: 23, sx: 0.7, sy: 0.65, tx: 0.5, ty: 0.2, col: 0.1 }),
    X({ rot: 61, sx: 0.6, sy: 0.7, tx: -0.4, ty: 0.45, col: 0.3 }),
    X({ rot: 97, sx: 0.65, sy: 0.6, tx: 0.1, ty: -0.5, col: 0.5 }),
    X({ rot: 133, sx: 0.55, sy: 0.6, tx: -0.55, ty: -0.2, col: 0.7 }),
    X({ rot: 171, sx: 0.5, sy: 0.5, tx: 0.35, ty: -0.1, col: 0.9 }),
  ] },
  bowdragon: { name: 'Bowed dragon', engine: 'bell', p: { throat: 2000, ring: 0.9, body: 0.35, breath: 0.1, address: 3, bloom: 0, attack: 0.4, release: 2.5 }, xf: [
    X({ rot: 45, sx: 0.7071, sy: 0.7071, tx: -0.5, ty: 0, col: 0.15 }),
    X({ rot: 135, sx: 0.7071, sy: 0.7071, tx: 0.5, ty: 0, col: 0.85 }),
  ] },

  // ---------- ORBIT: the flame's periodic orbit as a band-limited stereo wavetable ----------
  saw: { name: 'Sierpiński saw', engine: 'orbit', p: { throat: 5000, ring: 0.5, body: 0.7, address: 1, detail: 48 }, xf: [
    X({ rot: 12, sx: 0.5, sy: 0.5, tx: -0.5, ty: -0.35, col: 0.05 }),
    X({ rot: -9, sx: 0.5, sy: 0.5, tx: 0.5, ty: -0.35, col: 0.5 }),
    X({ rot: 4, sx: 0.5, sy: 0.5, tx: 0, ty: 0.5, col: 0.95 }),
  ] },
  fernstring: { name: 'Fern string', engine: 'orbit', p: { throat: 3500, ring: 0.2, body: 0.5, address: 3, detail: 64, attack: 0.004, decay: 0.8, sustain: 0.35, release: 0.6, bloom: 0.7 }, xf: [
    X({ rot: -2.5, sx: 0.85, sy: 0.85, tx: 0, ty: 0.48, w: 0.7, col: 0.35 }),
    X({ rot: 49, sx: 0.3, sy: 0.27, tx: 0, ty: 0.48, w: 0.15, col: 0.7 }),
    X({ rot: 120, sx: 0.3, sy: -0.28, tx: 0, ty: 0.132, w: 0.15, col: 0.95 }),
  ] },
  digidragon: { name: 'Dragon digital', engine: 'orbit', p: { throat: 6000, ring: 0, body: 0.9, address: 2, detail: 32 }, xf: [
    X({ rot: 45, sx: 0.7071, sy: 0.7071, tx: -0.5, ty: 0, col: 0.15 }),
    X({ rot: 135, sx: 0.7071, sy: 0.7071, tx: 0.5, ty: 0, col: 0.85 }),
  ] },
  organ: { name: 'Julia organ', engine: 'orbit', p: { throat: 2500, ring: 0.3, body: 0.3, address: 1, detail: 24, attack: 0.02, sustain: 1 }, xf: [
    X({ rot: 20, sx: 0.8, sy: 0.8, tx: 0.3, ty: 0.2, col: 0.15, lin: 0, v1: 'julia', a1: 1 }),
    X({ rot: 100, sx: 0.5, sy: 0.6, tx: -0.4, ty: -0.2, col: 0.7, lin: 0.7, v1: 'sinusoidal', a1: 0.3 }),
  ] },
  swirlpad: { name: 'Swirl pad', engine: 'orbit', p: { throat: 1800, ring: 1, body: 0.4, address: 4, detail: 64, attack: 0.8, release: 2, bloom: 0.6 }, xf: [
    X({ rot: 30, sx: 0.6, sy: 0.6, tx: 0.4, ty: 0.2, col: 0.1, lin: 0.4, v1: 'swirl', a1: 0.6 }),
    X({ rot: -70, sx: 0.55, sy: 0.65, tx: -0.45, ty: -0.1, col: 0.55, lin: 0.6, v1: 'swirl', a1: 0.4 }),
    X({ rot: 160, sx: 0.45, sy: 0.45, tx: 0.05, ty: -0.5, col: 0.9, w: 0.6 }),
  ] },
  blocks: { name: 'Golden blocks', engine: 'orbit', p: { throat: 4000, ring: 0.6, body: 0.65, address: 0, detail: 32 }, xf: [
    X({ rot: 137.508, sx: 0.82, sy: 0.82, tx: 0.3, ty: 0, col: 0.2, w: 1.3 }),
    X({ rot: -137.508, sx: 0.55, sy: 0.55, tx: -0.55, ty: 0.3, col: 0.6 }),
    X({ rot: 68.75, sx: 0.4, sy: 0.4, tx: 0.1, ty: -0.6, col: 0.95, w: 0.7 }),
  ] },

  // ---------- CLOUD: the chaos game spawns grains; height on the fractal = pitch, x = pan ----------
  shimmer: { name: 'Golden shimmer', engine: 'cloud', p: { throat: 3000, ring: 0.35, body: 0.55, breath: 0, address: 0, bloom: 0.3, attack: 0.4, release: 2.5 }, xf: [
    X({ rot: 137.508, sx: 0.82, sy: 0.82, tx: 0.3, ty: 0, col: 0.2, w: 1.3 }),
    X({ rot: -137.508, sx: 0.55, sy: 0.55, tx: -0.55, ty: 0.3, col: 0.6 }),
    X({ rot: 68.75, sx: 0.4, sy: 0.4, tx: 0.1, ty: -0.6, col: 0.95, w: 0.7 }),
  ] },
  rain: { name: 'Fern rain', engine: 'cloud', p: { throat: 3600, ring: 0.15, body: 0.75, breath: 0.05, address: 1, bloom: 0.9, attack: 0.05, release: 1.2 }, xf: [
    X({ rot: -2.5, sx: 0.85, sy: 0.85, tx: 0, ty: 0.48, w: 0.7, col: 0.35 }),
    X({ rot: 49, sx: 0.3, sy: 0.27, tx: 0, ty: 0.48, w: 0.15, col: 0.7 }),
    X({ rot: 120, sx: 0.3, sy: -0.28, tx: 0, ty: 0.132, w: 0.15, col: 0.95 }),
  ] },
  swarm: { name: 'Dragon swarm', engine: 'cloud', p: { throat: 2400, ring: 0.25, body: 0.9, breath: 0.3, address: 2, bloom: 0.5, attack: 0.2, release: 1.5 }, xf: [
    X({ rot: 45, sx: 0.7071, sy: 0.7071, tx: -0.5, ty: 0, col: 0.15 }),
    X({ rot: 135, sx: 0.7071, sy: 0.7071, tx: 0.5, ty: 0, col: 0.85 }),
  ] },
  stars: { name: 'Octave stars', engine: 'cloud', p: { throat: 4800, ring: 0.55, body: 0.35, breath: 0, address: 3, bloom: 0.2, attack: 0.6, release: 3 }, xf: [
    X({ rot: 12, sx: 0.5, sy: 0.5, tx: -0.5, ty: -0.35, col: 0.05 }),
    X({ rot: -9, sx: 0.5, sy: 0.5, tx: 0.5, ty: -0.35, col: 0.5 }),
    X({ rot: 4, sx: 0.5, sy: 0.5, tx: 0, ty: 0.5, col: 0.95 }),
  ] },
  fifths: { name: 'Fifths drift', engine: 'cloud', p: { throat: 3600, ring: 0.7, body: 0.45, breath: 0, address: 4, bloom: 0, attack: 1, release: 3.5 }, xf: [
    X({ rot: -15, sx: 0.55, sy: 0.55, tx: 0.2, ty: 0.3, col: 0.05, lin: 0.3, v1: 'heart', a1: 0.6 }),
    X({ rot: 110, sx: 0.6, sy: 0.6, tx: -0.3, ty: -0.2, col: 0.5 }),
    X({ rot: -120, sx: 0.4, sy: 0.4, tx: 0.4, ty: -0.4, col: 0.9, w: 0.5 }),
  ] },
};

// ---------- voice DSP ----------
// Each transform i is a resonator around its fixed point p_i:
//   z ← p_i + M_i (z − p_i),   M_i = S_i · ρ_i R(ψ_i) · S_i⁻¹
// ψ_i (formant) from the triangle's rotation, ρ_i (bandwidth) from its contraction, S_i (the
// stereo ellipse) from its aspect/shear. Because M_i is a similarity of a scaled rotation,
// fractional powers are exact: M_i^α = S_i · ρ_i^α R(αψ_i) · S_i⁻¹. Transform switches are
// therefore placed at their exact sub-sample time, so the waveform has no timing jitter.
// The output is the pre-emphasised position of z (continuous, no steps):
//   y = (z − c) − (1 − body)·(z_prev − c)
const PHI = (1 + Math.sqrt(5)) / 2;
const THUE = (n) => { let c = 0; while (n) { c ^= n & 1; n >>>= 1; } return c; };
const FIB = (n) => Math.floor((n + 2) / PHI) - Math.floor((n + 1) / PHI);
export const ADDRESS = ['cycle', 'pendulum', 'thue', 'fibonacci', 'chaos'];

export function makeVoice(seed = 1) {
  // every field any engine uses is declared here, so the object keeps one hidden class (fast in V8)
  return {
    active: false, zx: 0, zy: 0, ox: 0, oy: 0, phase: 0, period: 0, f: 220, fTarget: 220, vel: 1, kmod: 1,
    env: 0, stage: 0, rel: false, seg: 0, cur: 0, order: null, edges: null, rng: (seed * 2654435761) >>> 0 || 1, j: 0, age: 0, id: -1, vibT: 0, vibK: 1,
    M: null, psi: null, lr: null, mKey: -1, mPatch: null, started: false,
    wt: null, pv: null, sx1: 0, sx2: 0, sy1: 0, sy2: 0, slx: 0, sly: 0, shaped: false,
    // bell
    mr: null, mi: null, cr: null, ci: null, nr: null, burst: 0, bend: 0, strikeReq: false, nextHit: 0, t: 0, hits: 0,
    // orbit
    ph: null, sub: 0, lx: 0, ly: 0,
    // cloud
    next: 0, cz: null, gc: null, gs: null, gwc: null, gws: null, gpos: null, glen: null, gl: null, gr: null, gnz: null, gon: null,
  };
}
function rand(v) { let s = v.rng; s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; v.rng = s; return s / 4294967296; }

/** Formant frequency (Hz) a transform rings at, for a given throat length. */
export function formantHz(rotDeg, throat) { return 110 + Math.abs(rotDeg) / 180 * throat; }
/** Bandwidth (Hz) from the transform's contraction s = sqrt|det A| and the ring control. */
export function bandwidthHz(s, ring) { return (22 + Math.max(0, 1 - Math.min(s, 0.985)) * 1100) * (1 - 0.93 * ring); }

/** Precompute per-transform resonator data. opts: { ring, cx, cy, norm } */
export function preparePatch(P, opts) {
  const n = P.length / XF_STRIDE;
  const w = []; let tot = 0;
  for (let i = 0; i < n; i++) { const wi = Math.max(0, P[i * XF_STRIDE + 6]); w.push(wi); tot += wi; }
  if (tot <= 0) { for (let i = 0; i < n; i++) w[i] = 1; tot = n; }
  const R = [];
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    const o = i * XF_STRIDE, a = P[o], b = P[o + 1], c = P[o + 2], d = P[o + 3], e = P[o + 4], f = P[o + 5];
    const det = a * d - b * c, s = Math.sqrt(Math.abs(det)) || 1e-3;
    const rot = Math.atan2(c, a) * 180 / Math.PI;
    const co = Math.cos(-rot * Math.PI / 180), si = Math.sin(-rot * Math.PI / 180);
    const s00 = (co * a - si * c) / s, s01 = (co * b - si * d) / s, s10 = (si * a + co * c) / s, s11 = (si * b + co * d) / s;
    const sd = s00 * s11 - s01 * s10 || 1;
    const i00 = s11 / sd, i01 = -s01 / sd, i10 = -s10 / sd, i11 = s00 / sd;
    const m00 = 1 - a, m01 = -b, m10 = -c, m11 = 1 - d, md = m00 * m11 - m01 * m10;
    let px = e, py = f;
    if (Math.abs(md) > 1e-6) { px = (m11 * e - m01 * f) / md; py = (-m10 * e + m00 * f) / md; }
    if (!(Math.abs(px) < 20 && Math.abs(py) < 20)) { px = e; py = f; }
    const lin = P[o + 9];
    let varSum = 0;
    for (let v = 10; v < 16; v += 2) varSum += Math.abs(P[o + v + 1]);
    R.push({ rot, s, s00, s01, s10, s11, i00, i01, i10, i11, px, py, lin, nonlin: varSum > 1e-4, den: Math.abs(lin) + varSum || 1, o });
    mx += px * w[i] / tot; my += py * w[i] / tot;
  }
  let spread = 0;
  for (let i = 0; i < n; i++) spread += w[i] / tot * ((R[i].px - mx) ** 2 + (R[i].py - my) ** 2);
  spread = Math.sqrt(spread) || 0.3;
  return { P, n, w: w.map(x => x / tot), R, anyNonlin: R.some(r => r.nonlin), ring: opts.ring || 0, cx: opts.cx ?? mx, cy: opts.cy ?? my, norm: opts.norm || 1, spread, ver: (Math.random() * 1e9) | 0 };
}

// per-voice resonator data (recomputed only when the patch or throat × voice throat-mod changes)
function voiceMatrices(v, patch, throat, sr) {
  const n = patch.n;
  if (!v.M || v.M.length !== n * 4) { v.M = new Float64Array(n * 4); v.psi = new Float64Array(n); v.lr = new Float64Array(n); }
  for (let i = 0; i < n; i++) {
    const r = patch.R[i];
    const F = Math.min(sr * 0.45, formantHz(r.rot, throat * v.kmod));
    const psi = 2 * Math.PI * F / sr * (r.rot < 0 ? -1 : 1);
    const lr = -Math.PI * bandwidthHz(r.s, patch.ring) / sr; // ln ρ
    v.psi[i] = psi; v.lr[i] = lr;
    fillM(v.M, i * 4, r, Math.exp(lr), psi);
  }
}
function fillM(M, o, r, rho, psi) {
  const c = Math.cos(psi) * rho, s = Math.sin(psi) * rho;
  const t00 = r.s00 * c + r.s01 * s, t01 = -r.s00 * s + r.s01 * c, t10 = r.s10 * c + r.s11 * s, t11 = -r.s10 * s + r.s11 * c;
  M[o] = t00 * r.i00 + t01 * r.i10; M[o + 1] = t00 * r.i01 + t01 * r.i11;
  M[o + 2] = t10 * r.i00 + t11 * r.i10; M[o + 3] = t10 * r.i01 + t11 * r.i11;
}
const Mf = new Float64Array(4);
function advance(v, patch, i, alpha) {
  const r = patch.R[i];
  let M = v.M, o = i * 4;
  if (alpha !== 1) { fillM(Mf, 0, r, Math.exp(v.lr[i] * alpha), v.psi[i] * alpha); M = Mf; o = 0; }
  const dx = v.zx - r.px, dy = v.zy - r.py;
  v.zx = r.px + M[o] * dx + M[o + 1] * dy;
  v.zy = r.py + M[o + 2] * dx + M[o + 3] * dy;
}

function rebuildOrder(v, patch, mode) {
  const n = patch.n;
  if (!v.order || v.order.length !== n) { v.order = new Int32Array(n); v.edges = new Float64Array(n); }
  const ord = v.order;
  for (let i = 0; i < n; i++) ord[i] = i;
  let rev = 0;
  if (mode === 1) rev = v.period & 1;
  else if (mode === 2) rev = THUE(v.period);
  else if (mode === 3) rev = FIB(v.period);
  if (rev && n > 1) { const f = ord[0]; for (let i = 0; i < n - 1; i++) ord[i] = ord[i + 1]; ord[n - 1] = f; } // rotate by one
  if (mode === 4) for (let i = n - 1; i > 0; i--) { const k = Math.floor(rand(v) * (i + 1)); const t = ord[i]; ord[i] = ord[k]; ord[k] = t; }
  let c = 0;
  for (let k = 0; k < n; k++) { c += patch.w[ord[k]]; v.edges[k] = c; }
  v.edges[n - 1] = 1;
}

/** Shape a point through transform T's variations (identity for purely linear transforms). */
function shape(P, T, x, y, j, out, prev) {
  if (!T.nonlin) { out[0] = x; out[1] = y; return; }
  acc[0] = T.lin * x; acc[1] = T.lin * y;
  for (let k = 10; k < 16; k += 2) {
    const wv = P[T.o + k + 1]; if (wv === 0) continue;
    const t = P[T.o + k] | 0;
    if (t === 12 && prev) { // julia: follow the square-root branch continuously instead of flipping it
      const ax = acc[0], ay = acc[1];
      addVar(12, wv, x, y, acc, 0);
      const r0x = acc[0] - ax, r0y = acc[1] - ay;
      const d0 = (ax + r0x - prev[0]) ** 2 + (ay + r0y - prev[1]) ** 2, d1 = (ax - r0x - prev[0]) ** 2 + (ay - r0y - prev[1]) ** 2;
      if (d1 < d0) { acc[0] = ax - r0x; acc[1] = ay - r0y; }
      continue;
    }
    addVar(t, wv, x, y, acc, j, true);
  }
  let ox = acc[0] / T.den, oy = acc[1] / T.den;
  if (!(Math.abs(ox) < 30) || !(Math.abs(oy) < 30)) { ox = x; oy = y; }
  out[0] = ox; out[1] = oy;
}

/**
 * Render one voice, adding into L/R (length n) at rate g.sr (callers oversample: g.sr = 48k·OS).
 * g = { sr, os, throat, body, breath, address(int), bloom, attack, decay, sustain, release, glide, vibRate, vibDepth, vibDelay }
 * The resonator is linear (clean and periodic); variations bend its path afterwards like a
 * geometric waveshaper, cross-fading over 1.5 ms when the voice moves to the next transform.
 * Returns false once the voice has finished.
 */
const acc = [0, 0], wa = [0, 0], wb = [0, 0];
const BREATH_GAIN = 0.45; // breath 0.5 ≈ breathy voice, 1.0 ≈ whisper
export function renderVoice(v, patch, g, L, R, n, trail) {
  if (!v.active || !patch || patch.n === 0) return false;
  const sr = g.sr, P = patch.P, nx = patch.n, os = g.os || 1;
  const atk = 1 / Math.max(1, g.attack * sr), dec = Math.exp(-1 / Math.max(1, g.decay * sr / 4)), rel = Math.exp(-1 / Math.max(1, g.release * sr / 4));
  const gl = g.glide > 0 ? 1 - Math.exp(-1 / (g.glide * sr)) : 1;
  const vibW = 2 * PI * g.vibRate;
  const amp = patch.norm * v.vel;
  const key = patch.ver + g.throat * v.kmod * 1e-4;
  if (v.mKey !== key || v.mPatch !== patch) { voiceMatrices(v, patch, g.throat, sr); v.mKey = key; v.mPatch = patch; }
  if (!v.order || v.order.length !== nx) { v.seg = 0; rebuildOrder(v, patch, g.address); v.cur = v.order[0]; }
  if (!v.wt || v.wt.length !== nx) { v.wt = new Float64Array(nx); v.wt[v.cur] = 1; }
  if (!v.started) { v.started = true; const r = patch.R[v.cur]; v.zx = r.px; v.zy = r.py; shape(P, r, r.px, r.py, 0, wa); v.ox = wa[0] - patch.cx; v.oy = wa[1] - patch.cy; v.sx1 = v.sx2 = v.slx = wa[0]; v.sy1 = v.sy2 = v.sly = wa[1]; v.shaped = true; }
  const pe = 1 - Math.min(1, Math.max(0, g.body));
  const br = g.breath * patch.spread * BREATH_GAIN / Math.sqrt(os);
  const cx = patch.cx, cy = patch.cy;
  // fade between transforms: 1.5 ms, but never longer than a third of a segment at this pitch
  const fadeStep = 1 / Math.max(1, Math.min(0.0015 * sr, sr / Math.max(20, v.f) / nx / 3));
  const sm = 1 - Math.exp(-2 * Math.PI * Math.min(14000, sr * 0.2) / sr);
  const slew = patch.spread * 2 * Math.PI * 12000 / sr; // ≈4× the speed of a full-size ring at 3 kHz
  const trailEvery = 4 * os;
  for (let i = 0; i < n; i++) {
    if (v.rel) { v.env *= rel; if (v.env < 1e-4) { v.active = false; return false; } }
    else if (v.stage === 0) { v.env += atk; if (v.env >= 1) { v.env = 1; v.stage = 1; } }
    else { v.env = g.sustain + (v.env - g.sustain) * dec; }
    v.f += (v.fTarget - v.f) * gl;
    v.vibT += 1 / sr;
    if ((i & 31) === 0) { // vibrato factor, refreshed every 32 samples (smooth at these rates)
      const vd = g.vibDepth * Math.min(1, Math.max(0, (v.vibT - g.vibDelay) / 0.4));
      v.vibK = vd ? Math.exp(vd * Math.sin(v.vibT * vibW) * 0.000577622650466621) : 1; // 2^(c/1200)
    }
    const inc = Math.max(1e-7, v.f * (v.vibK || 1) / sr);
    // advance through this sample interval, switching transforms at their exact sub-sample times
    let rem = 1, guard = 0;
    while (rem > 1e-12 && guard++ < 32) {
      const dist = (v.edges[v.seg] - v.phase) / inc;
      if (dist >= rem) { advance(v, patch, v.cur, rem === 1 ? 1 : rem); v.phase += rem * inc; rem = 0; break; }
      if (dist > 0) { advance(v, patch, v.cur, dist); rem -= dist; }
      v.phase = v.edges[v.seg];
      v.seg++;
      if (v.seg >= nx) { v.phase -= 1; v.period++; rebuildOrder(v, patch, g.address); v.seg = 0; }
      const nxt = v.order[v.seg];
      v.cur = nxt;
      v.j ^= 1;
    }
    if (br > 0) { const e = br * (0.25 + 0.75 * v.env); v.zx += (rand(v) * 2 - 1) * e; v.zy += (rand(v) * 2 - 1) * e; }
    if (!(Math.abs(v.zx) < 30) || !(Math.abs(v.zy) < 30)) { const r = patch.R[v.cur]; v.zx = r.px; v.zy = r.py; }
    // waveshape through the transforms' variations with continuous per-transform weights
    // (each weight glides toward 1 for the current transform, 0 for the others → never jumps)
    if (!patch.anyNonlin) { wa[0] = v.zx; wa[1] = v.zy; } else {
    const pv = v.pv || (v.pv = [0, 0]);
    pv[0] = v.sx1; pv[1] = v.sy1;
    const wt = v.wt;
    let sw = 0, ax = 0, ay = 0;
    for (let k = 0; k < nx; k++) {
      let wk = wt[k] + (k === v.cur ? fadeStep : -fadeStep);
      wk = wk < 0 ? 0 : wk > 1 ? 1 : wk;
      wt[k] = wk;
      if (wk <= 0) continue;
      shape(P, patch.R[k], v.zx, v.zy, v.j, wb, pv);
      const sk = wk * wk * (3 - 2 * wk);
      ax += sk * wb[0]; ay += sk * wb[1]; sw += sk;
    }
    if (sw > 1e-9) { wa[0] = ax / sw; wa[1] = ay / sw; } else { wa[0] = v.zx; wa[1] = v.zy; }
    }
    // slew limit + two-pole 14 kHz smoother on the shaped path: variation branch cuts (atan2)
    // jump; a jump becomes a short ramp, while real formant motion is far below the limit
    if (!v.shaped) { v.shaped = true; v.sx1 = v.sx2 = v.slx = wa[0]; v.sy1 = v.sy2 = v.sly = wa[1]; }
    { const dx = wa[0] - v.slx, dy = wa[1] - v.sly, d = Math.hypot(dx, dy);
      if (d > slew) { v.slx += dx * slew / d; v.sly += dy * slew / d; } else { v.slx = wa[0]; v.sly = wa[1]; }
      wa[0] = v.slx; wa[1] = v.sly; }
    v.sx1 += sm * (wa[0] - v.sx1); v.sx2 += sm * (v.sx1 - v.sx2);
    v.sy1 += sm * (wa[1] - v.sy1); v.sy2 += sm * (v.sy1 - v.sy2);
    // pre-emphasised, continuous output
    const yx = v.sx2 - cx, yy = v.sy2 - cy;
    const e = v.env * amp;
    const pev = pe * (1 - g.bloom * (1 - v.env) * 0.8); // Bloom: quieter → darker (more body, less pre-emphasis)
    L[i] += (yx - pev * v.ox) * e; R[i] += (yy - pev * v.oy) * e;
    v.ox = yx; v.oy = yy;
    if (trail && (v.age + i) % trailEvery === 0) trail.push(v.sx2, v.sy2);
  }
  v.age += n;
  return true;
}

// ---------- oversampling ----------
export const OS = 4;
/** FIR decimator by `os` (Kaiser-windowed sinc, −6 dB at 0.42·fs_out ≈ 20 kHz, flat to ~16 kHz, ≥80 dB stopband from 24 kHz). */
export class Decimator {
  constructor(os = OS, taps = 127, cutoff = 0.42, beta = 8) {
    this.os = os; this.taps = taps;
    const h = new Float64Array(taps), fc = cutoff / os, m = (taps - 1) / 2; // fc in cycles per input sample
    const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const k = i - m, sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
      const w = I0(beta * Math.sqrt(1 - (k / m) ** 2)) / I0(beta);
      h[i] = sinc * w; sum += h[i];
    }
    for (let i = 0; i < taps; i++) h[i] /= sum;
    this.h = h;
    this.buf = new Float64Array(taps * 2); this.pos = 0;
  }
  /** hi: Float32Array (n·os) → out: Float32Array (n) */
  process(hi, out) {
    const os = this.os, T = this.taps, h = this.h, b = this.buf;
    let pos = this.pos;
    for (let i = 0, k = 0; i < out.length; i++) {
      for (let q = 0; q < os; q++, k++) { pos = pos === 0 ? T - 1 : pos - 1; b[pos] = b[pos + T] = hi[k]; }
      let s = 0;
      for (let t = 0; t < T; t++) s += h[t] * b[pos + t];
      out[i] = s;
    }
    this.pos = pos;
    return out;
  }
}

// renderOffline / measurePatch live in engines.js (they dispatch across all engines).

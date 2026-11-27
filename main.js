// Phlox — the flame voice. UI, play surface, triangle editor, audio + render wiring.
import { PRESETS, VARS, makeXf, matrixOf, setMatrix, compile, morphXfs, formantHz, applyXf } from './engine/flame.js';
import { measurePatch, ENGINES } from './engine/engines.js';
import { FlameView, PALETTES, paletteLut, lutColor } from './engine/view.js';
import { AudioEngine } from './engine/audio.js';
import { Recorder, pickMime, download, savePng, describeMime } from './engine/recorder.js';
import { setupTabs } from './engine/tabs.js';

const VERSION = '1.2.0';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SCALES = {
  minor: { name: 'Natural minor', s: [0, 2, 3, 5, 7, 8, 10] },
  major: { name: 'Major', s: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', s: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', s: [0, 1, 3, 5, 7, 8, 10] },
  'penta-minor': { name: 'Pentatonic minor', s: [0, 3, 5, 7, 10] },
  'penta-major': { name: 'Pentatonic major', s: [0, 2, 4, 7, 9] },
  hijaz: { name: 'Hijaz', s: [0, 1, 4, 5, 7, 8, 10] },
  whole: { name: 'Whole tone', s: [0, 2, 4, 6, 8, 10] },
  chromatic: { name: 'Chromatic', s: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// Per-engine defaults for the shared controls; presets override them (PRESETS[k].p).
const ENGINE_DEFAULTS = {
  voice: { throat: 2400, ring: 0.35, body: 0.15, breath: 0.03, address: 0, bloom: 0.4, attack: 0.04, decay: 0.5, sustain: 0.75, release: 0.7, vibDepth: 14, detail: 32 },
  bell: { throat: 2400, ring: 0.6, body: 0.5, breath: 0.1, address: 0, bloom: 0.2, attack: 0.001, decay: 1, sustain: 1, release: 1.2, vibDepth: 0, detail: 32 },
  orbit: { throat: 3000, ring: 0.35, body: 0.5, breath: 0, address: 1, bloom: 0.3, attack: 0.02, decay: 0.6, sustain: 0.8, release: 0.5, vibDepth: 10, detail: 32 },
  cloud: { throat: 2400, ring: 0.4, body: 0.5, breath: 0.05, address: 0, bloom: 0.5, attack: 0.3, decay: 1, sustain: 0.9, release: 1.5, vibDepth: 0, detail: 32 },
};
// What the shared controls mean in each engine.
const ENGINE_UI = {
  voice: {
    head: 'Throat', info: 'Formant voice — each transform is a resonance of the throat: rotation sets its pitch, size how long it rings, position how hard it is struck.',
    throat: 'Throat (formant range, Hz)', ring: 'Ring (resonance)', body: 'Body (fixed-point pulse)', breath: 'Breath (noise through the formants)', address: 'Address', bloom: 'Bloom (tail darkens)',
    addr: ['Cycle — clean', 'Pendulum — octave-down shimmer', 'Thue–Morse — growl', 'Fibonacci — quasi-periodic', 'Chaos order — rasp'],
  },
  bell: {
    head: 'Strike', info: 'Struck body — each transform is an inharmonic partial ringing in parallel: rotation sets its ratio, size how long it rings, position how hard it is hit. Higher on the play surface = harder mallet.',
    throat: 'Spread (partial range)', ring: 'Ring time', body: 'Mallet hardness', breath: 'Strike noise', address: 'Exciter', bloom: 'Pitch drop on strike',
    addr: ['Strike', 'Double strike', 'Roll (tremolo)', 'Bow (singing bowl)', 'Scrape'],
  },
  orbit: {
    head: 'Wave', info: "Wavetable — the flame's periodic orbit under an address word (variations included) is traced as an outline; one trip round it is one cycle of the wave, played band-limited in stereo. Higher on the play surface = brighter.",
    throat: 'Brightness (Hz)', ring: 'Unison (thickness)', body: 'Edge (fractal jaggedness)', breath: 'Noise', address: 'Orbit word', bloom: 'Brightness follows envelope',
    addr: ['Blocks — runs of each transform', 'Balanced (√2 rotation)', 'Thue–Morse', 'Fibonacci (golden rotation)', 'Random (seeded)'],
  },
  cloud: {
    head: 'Grains', info: 'Granular — the chaos game runs live and every point it lands on spawns a grain: height on the fractal is pitch, left/right is pan. Higher on the play surface = denser.',
    throat: 'Pitch spread', ring: 'Grain length', body: 'Density', breath: 'Noise grains', address: 'Tuning', bloom: 'Grain shape (soft → plucked)',
    addr: ['Harmonics of the note', 'Pentatonic', 'Free (unquantized)', 'Octaves', 'Stacked fifths'],
  },
};

const DEFAULTS = {
  engine: 'voice', detail: 32,
  preset: 'reed', xf: clone(PRESETS.reed.xf), sel: 0, morphTo: 'golden', morph: 0, wander: 0, wanderRate: 0.12,
  throat: 2400, ring: 0.35, body: 0.15, breath: 0.03, address: 0, bloom: 0.4, width: 0.8,
  attack: 0.04, decay: 0.5, sustain: 0.75, release: 0.7, glide: 0.05, vibRate: 5.2, vibDepth: 14, vibDelay: 0.35,
  root: 9, oct: 3, scale: 'minor', snap: true, span: 19, hold: false, velocity: 0.85,
  drive: 0.1, reverb: 0.32, room: 3.2, volume: 0.8,
  palette: 'ember', gamma: 3.2, bright: 1.05, vib: 0.85, glow: 0.22, quality: 1, showTri: true, showOrbits: true, orbitGlow: 1,
  de: 0.35, high: 1, relief: 0, sym: 'none',
  recFormat: 'webm', vidSize: 'view', vidFps: 60, vidRate: 16, vidDur: 0, vidOrbits: true,
  mode: 'play', cam: null, audioQ: 0,
};
// export sizes (all even — H.264 needs even dimensions)
const VID_SIZES = {
  view: { name: 'Match the view' },
  '720p': { name: '1280 × 720 (16:9)', w: 1280, h: 720 },
  '1080p': { name: '1920 × 1080 (16:9)', w: 1920, h: 1080 },
  '1440p': { name: '2560 × 1440 (16:9)', w: 2560, h: 1440 },
  square: { name: '1080 × 1080 (square)', w: 1080, h: 1080 },
  vertical: { name: '1080 × 1920 (9:16 vertical)', w: 1080, h: 1920 },
  portrait45: { name: '1080 × 1350 (4:5)', w: 1080, h: 1350 },
};
const SYMS = {
  none: { name: 'None', n: 1, mirror: false }, r2: { name: '2-fold', n: 2 }, r3: { name: '3-fold', n: 3 }, r4: { name: '4-fold', n: 4 },
  r5: { name: '5-fold', n: 5 }, r6: { name: '6-fold', n: 6 }, r8: { name: '8-fold', n: 8 }, r12: { name: '12-fold', n: 12 },
  d1: { name: 'Mirror', n: 1, mirror: true }, d3: { name: '3-fold + mirror', n: 3, mirror: true }, d4: { name: '4-fold + mirror', n: 4, mirror: true },
  d6: { name: '6-fold + mirror', n: 6, mirror: true }, d8: { name: '8-fold + mirror', n: 8, mirror: true },
};
const SYNTH = ['throat', 'ring', 'detail', 'body', 'breath', 'address', 'bloom', 'attack', 'decay', 'sustain', 'release', 'glide', 'vibRate', 'vibDepth', 'vibDelay'];
const PATCH_KEYS = new Set(['morph', 'morphTo']);
const FMT = {
  morph: v => (v * 100).toFixed(0) + '%', detail: v => v.toFixed(0), wander: v => v.toFixed(1) + '°', wanderRate: v => v.toFixed(2), throat: v => v.toFixed(0), ring: v => v.toFixed(2),
  body: v => v.toFixed(2), breath: v => (v * 100).toFixed(1) + '%', bloom: v => v.toFixed(2), width: v => v.toFixed(2), span: v => v.toFixed(0),
  glide: v => (v * 1000).toFixed(0) + ' ms', velocity: v => v.toFixed(2), vibDepth: v => v.toFixed(0), vibRate: v => v.toFixed(2), vibDelay: v => v.toFixed(2),
  attack: v => v.toFixed(3), decay: v => v.toFixed(2), sustain: v => v.toFixed(2), release: v => v.toFixed(2), drive: v => v.toFixed(2),
  reverb: v => (v * 100).toFixed(0) + '%', room: v => v.toFixed(2), volume: v => v.toFixed(2), gamma: v => v.toFixed(2), bright: v => v.toFixed(2),
  vib: v => v.toFixed(2), glow: v => v.toFixed(2), orbitGlow: v => v.toFixed(2), de: v => v.toFixed(2), high: v => v.toFixed(2), relief: v => v.toFixed(2),
  x_w: v => v.toFixed(2), x_rot: v => v.toFixed(1) + '°', x_sx: v => v.toFixed(3), x_sy: v => v.toFixed(3), x_shear: v => v.toFixed(3),
  x_tx: v => v.toFixed(3), x_ty: v => v.toFixed(3), x_col: v => v.toFixed(2), x_lin: v => v.toFixed(2), x_a1: v => v.toFixed(2), x_a2: v => v.toFixed(2),
};

// ---------- state ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};
let S;
function loadState(obj) {
  S = clone(DEFAULTS);
  if (obj && obj.state) for (const k of Object.keys(DEFAULTS)) if (k in obj.state) S[k] = obj.state[k];
  if (!Array.isArray(S.xf) || !S.xf.length) S.xf = clone(PRESETS.reed.xf);
  S.xf = S.xf.map(x => makeXf(x));
  if (!ENGINES[S.engine]) S.engine = 'voice';
  if (!PRESETS[S.morphTo]) S.morphTo = 'golden';
  if (!VID_SIZES[S.vidSize]) S.vidSize = 'view';
  if (!SYMS[S.sym]) S.sym = 'none';
  S.sel = clamp(S.sel | 0, 0, S.xf.length - 1);
}
const snapshot = () => ({ app: 'phlox', version: VERSION, state: S });
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => store.set('phlox.state', JSON.stringify(snapshot())), 300); }
try { loadState(JSON.parse(store.get('phlox.state', 'null'))); } catch (e) { loadState(null); }

// ---------- core ----------
const glCanvas = $('gl'), orbitCv = $('orbits'), uiCv = $('ui');
const octx = orbitCv.getContext('2d'), uctx = uiCv.getContext('2d');
let view;
try { view = new FlameView(glCanvas); } catch (e) { $('status').textContent = 'WebGL unavailable: ' + e.message; throw e; }
const audio = new AudioEngine(VERSION);
const recCanvas = document.createElement('canvas'); // export composite: flame + orbits at the export size
const rctx = recCanvas.getContext('2d');
const recorder = new Recorder(audio);
let exporting = false;   // canvases + renderer at full export resolution (recording or rendering a still)
const worker = new Worker(new URL(`./engine/render-worker.js?v=${VERSION}`, import.meta.url), { type: 'module' });
let lut = paletteLut(S.palette);
let tabs = null;
let cam = S.cam || { cx: 0, cy: 0, scale: 1.2 };
let frameInfo = { W: 0, H: 0, total: 0 };
let trails = [];

worker.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'frame') {
    view.upload(d.W, d.H, d.data); frameInfo = { W: d.W, H: d.H, total: d.total, ss: d.ss, t: performance.now() };
    worker.postMessage({ type: 'recycle', buf: d.data.buffer }, [d.data.buffer]); // hand the buffer back (no 8 MB allocation per frame)
  }
  else if (d.type === 'bounds') {
    const f = frameRect(), w = Math.max(1, f.w), h = Math.max(1, f.h), m = Math.min(w, h);
    const hx = (d.maxx - d.minx) / 2 || 1, hy = (d.maxy - d.miny) / 2 || 1;
    cam = { cx: (d.minx + d.maxx) / 2, cy: (d.miny + d.maxy) / 2, scale: Math.max(hx * m / w, hy * m / h) * 1.32 };
    S.cam = cam; worker.postMessage({ type: 'cam', cam }); save();
  }
};
worker.onerror = (e) => flash('Renderer error: ' + (e.message || 'worker failed'));
audio.onTrails = (v) => { trails = v; };

// ---------- effective flame (morph + wander) → audio + renderer ----------
let effXf = S.xf, patchDirty = true, fitNext = !S.cam, lastPatchT = 0, lastMeasureT = 0, measured = null;
function effective(t) {
  let xf = S.morph > 0 ? morphXfs(S.xf, PRESETS[S.morphTo].xf, S.morph) : S.xf.map(x => ({ ...x }));
  if (S.wander > 0) xf = xf.map((x, i) => ({ ...x, rot: x.rot + S.wander * Math.sin(2 * Math.PI * S.wanderRate * t + i * 2.399), tx: x.tx + S.wander / 300 * Math.sin(2 * Math.PI * S.wanderRate * 0.61 * t + i * 1.7) }));
  return xf;
}
function globals() {
  const g = { sr: audio.ctx ? audio.ctx.sampleRate : 48000, engine: S.engine };
  for (const k of SYNTH) g[k] = +S[k];
  return g;
}
function pushPatch(now, force) {
  effXf = effective(now / 1000);
  const P = compile(effXf);
  if (force || now - lastMeasureT > 120 || !measured) { measured = measurePatch(P, globals(), S.ring); lastMeasureT = now; }
  audio.post({ type: 'patch', P, ring: S.ring, cx: measured.cx, cy: measured.cy, norm: measured.norm, jump: !!force });
  worker.postMessage({ type: 'xf', P, keep: S.wander > 0 ? 0.6 : 0.15, fit: fitNext });
  fitNext = false;
  lastPatchT = now;
}
function sendSynth() { audio.post({ type: 'params', g: globals(), width: S.width, drive: S.drive }); measured = null; patchDirty = true; }

// audio oversampling: 4× on desktops, 2× on phones unless the user chose
function audioOS() { return S.audioQ === 2 || S.audioQ === 4 ? S.audioQ : (window.matchMedia('(pointer: coarse)').matches ? 2 : 4); }

// ---------- pitch ----------
const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const baseMidi = () => 12 * (+S.oct + 1) + +S.root;
let bend = 0; // semitones (MIDI pitch bend)
function surfaceSemis(fx) {
  const raw = fx * S.span;
  if (!S.snap) return raw;
  const sc = SCALES[S.scale].s;
  let best = 0, bd = 1e9;
  for (let o = -1; o <= Math.ceil(S.span / 12) + 1; o++) for (const d of sc) { const v = o * 12 + d; const dd = Math.abs(v - raw); if (dd < bd) { bd = dd; best = v; } }
  return best;
}

// ---------- voices ----------
const held = new Map(); // id -> {midi, kmod}
function noteOn(id, midi, vel, kmod = 1) {
  wake();
  held.set(id, { midi, kmod });
  audio.post({ type: 'on', id, f: midiFreq(midi + bend), vel, kmod });
}
function noteSet(id, midi, kmod) {
  const h = held.get(id); if (!h) return;
  if (midi != null) h.midi = midi; if (kmod != null) h.kmod = kmod;
  audio.post({ type: 'set', id, f: midiFreq(h.midi + bend), kmod: h.kmod });
}
function noteOff(id) {
  if (!held.has(id)) return;
  if (S.hold && typeof id === 'number') return; // pointer notes latch while Hold is on
  held.delete(id);
  audio.post({ type: 'off', id });
}
function allOff() { held.clear(); audio.post({ type: 'allOff' }); for (const b of $('pads').children) b.classList.remove('held'); }

// ---------- pointer: play surface + triangle editor ----------
const ptrs = new Map();
let hover = null;
function viewSize() { const r = uiCv.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top }; }
/** Export size in pixels (even), or null when matching the view. */
function exportSize() {
  const v = VID_SIZES[S.vidSize];
  if (v && v.w) return { w: v.w, h: v.h };
  const f = frameRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  return { w: Math.max(2, Math.round(f.w * dpr / 2) * 2), h: Math.max(2, Math.round(f.h * dpr / 2) * 2) };
}
/** The visible export frame inside the view (CSS px): the whole view, or letterboxed to the export shape. */
function frameRect() {
  const { w, h } = viewSize(), v = VID_SIZES[S.vidSize];
  if (!v || !v.w) return { x: 0, y: 0, w, h };
  const a = v.w / v.h;
  let fw = w, fh = w / a;
  if (fh > h) { fh = h; fw = h * a; }
  return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
}
function camScale(c, f) { return Math.min(f.w, f.h) / (2 * (c || cam).scale); }
function toWorld(px, py) { const f = frameRect(), s = camScale(cam, f); return [cam.cx + (px - f.x - f.w / 2) / s, cam.cy - (py - f.y - f.h / 2) / s]; }
function toScreen(x, y) { const f = frameRect(), s = camScale(cam, f); return [f.x + f.w / 2 + (x - cam.cx) * s, f.y + f.h / 2 - (y - cam.cy) * s]; }
function local(e) { const v = viewSize(); return [e.clientX - v.l, e.clientY - v.t]; }
function kmodFromY(y) { const { h } = viewSize(); return 0.45 * Math.pow(3.6, 1 - clamp(y / h, 0, 1)); }
function setCam(c) { cam = c; S.cam = c; worker.postMessage({ type: 'cam', cam }); save(); }

function triPoints(x) {
  const m = matrixOf(x);
  return { O: [m.e, m.f], X: [m.e + m.a, m.f + m.c], Y: [m.e + m.b, m.f + m.d] };
}
function hitTest(px, py) {
  const order = [S.sel, ...S.xf.map((_, i) => i).filter(i => i !== S.sel)];
  for (const i of order) {
    const t = triPoints(S.xf[i]);
    for (const k of ['X', 'Y', 'O']) { const [sx, sy] = toScreen(...t[k]); if (Math.hypot(px - sx, py - sy) < 16) return { i, part: k }; }
  }
  for (const i of order) {
    const t = triPoints(S.xf[i]);
    const [ax, ay] = toScreen(...t.O), [bx, by] = toScreen(...t.X), [cx, cy] = toScreen(...t.Y);
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by), d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy), d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return { i, part: 'body' };
  }
  return null;
}
function bakeMorph() {
  if (S.morph > 0) { S.xf = morphXfs(S.xf, PRESETS[S.morphTo].xf, S.morph).map(x => makeXf(x)); S.morph = 0; syncUI(); }
}

let lastTap = 0;
uiCv.addEventListener('contextmenu', (e) => e.preventDefault());
uiCv.addEventListener('pointerdown', (e) => {
  e.preventDefault(); wake();
  uiCv.setPointerCapture(e.pointerId);
  const [px, py] = local(e);
  const p = { id: e.pointerId, x: px, y: py, x0: px, y0: py, kind: null };
  ptrs.set(e.pointerId, p);
  if (S.mode === 'play') {
    const { w } = viewSize();
    p.kind = 'note';
    let vel = S.velocity; if (e.pointerType === 'pen' && e.pressure > 0) vel *= 0.4 + e.pressure * 1.2;
    if (S.hold && held.has(e.pointerId)) { held.delete(e.pointerId); audio.post({ type: 'off', id: e.pointerId }); }
    noteOn(e.pointerId, baseMidi() + surfaceSemis(px / w), vel, kmodFromY(py));
    return;
  }
  // edit mode
  const now = performance.now();
  if (now - lastTap < 300 && ptrs.size === 1 && !hitTest(px, py)) { lastTap = 0; fitNext = true; worker.postMessage({ type: 'fit' }); return; }
  lastTap = now;
  if (ptrs.size === 2) { // pinch/pan begins
    for (const q of ptrs.values()) { q.kind = 'pinch'; q.dragging = null; }
    p.cam0 = { ...cam }; return;
  }
  const hit = S.showTri ? hitTest(px, py) : null;
  if (hit) {
    bakeMorph();
    S.sel = hit.i; p.kind = 'tri'; p.hit = hit; p.start = { ...S.xf[hit.i] }; p.w0 = toWorld(px, py);
    buildChips(); syncXf();
  } else { p.kind = 'pan'; p.cam0 = { ...cam }; }
});
uiCv.addEventListener('pointermove', (e) => {
  const [px, py] = local(e);
  hover = [px, py];
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  p.x = px; p.y = py;
  if (p.kind === 'note') {
    const { w } = viewSize();
    noteSet(e.pointerId, baseMidi() + surfaceSemis(px / w), kmodFromY(py));
  } else if (p.kind === 'tri') {
    const x = S.xf[p.hit.i], [wx, wy] = toWorld(px, py), m = matrixOf(p.start);
    if (p.hit.part === 'O' || p.hit.part === 'body') {
      x.tx = p.start.tx + (wx - p.w0[0]); x.ty = p.start.ty + (wy - p.w0[1]);
    } else if (p.hit.part === 'X') {
      setMatrix(x, wx - m.e, m.b, wy - m.f, m.d);
    } else if (p.hit.part === 'Y') {
      setMatrix(x, m.a, wx - m.e, m.c, wy - m.f);
    }
    patchDirty = true; syncXf();
  } else if (p.kind === 'pan') {
    const s = camScale(p.cam0, frameRect());
    setCam({ cx: p.cam0.cx - (px - p.x0) / s, cy: p.cam0.cy + (py - p.y0) / s, scale: p.cam0.scale });
  } else if (p.kind === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    if (!pinch0) pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...cam } };
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const f = frameRect(), fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
    const sc = clamp(pinch0.cam.scale * pinch0.d / d, 0.02, 50), s = Math.min(f.w, f.h) / (2 * sc);
    const s0 = Math.min(f.w, f.h) / (2 * pinch0.cam.scale);
    const wx = pinch0.cam.cx + (pinch0.mx - fcx) / s0, wy = pinch0.cam.cy - (pinch0.my - fcy) / s0;
    setCam({ cx: wx - (mx - fcx) / s, cy: wy + (my - fcy) / s, scale: sc });
  }
});
let pinch0 = null;
function endPtr(e) {
  const p = ptrs.get(e.pointerId);
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch0 = null;
  if (!p) return;
  if (p.kind === 'note') noteOff(e.pointerId);
  if (p.kind === 'tri') { measured = null; patchDirty = true; save(); }
}
uiCv.addEventListener('pointerup', endPtr);
uiCv.addEventListener('pointercancel', endPtr);
uiCv.addEventListener('pointerleave', () => { if (!ptrs.size) hover = null; });
uiCv.addEventListener('wheel', (e) => {
  if (S.mode !== 'edit') return;
  e.preventDefault();
  const [px, py] = local(e), [wx, wy] = toWorld(px, py);
  const sc = clamp(cam.scale * Math.exp(e.deltaY * 0.0015), 0.02, 50);
  const f = frameRect(), s = Math.min(f.w, f.h) / (2 * sc);
  setCam({ cx: wx - (px - f.x - f.w / 2) / s, cy: wy + (py - f.y - f.h / 2) / s, scale: sc });
}, { passive: false });

// ---------- keyboard ----------
const LOWER = 'zsxdcvgbhnjm,l.;/', UPPER = 'q2w3er5t6y7ui9o0p';
window.addEventListener('keydown', (e) => {
  const t = e.target, tag = t && t.tagName;
  if (tag === 'INPUT' && (t.type === 'text' || t.type === 'number') || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Tab') { e.preventDefault(); setMode(S.mode === 'play' ? 'edit' : 'play'); return; }
  if (e.repeat) { if (LOWER.includes(e.key.toLowerCase()) || UPPER.includes(e.key.toLowerCase())) e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (k === 'escape') { allOff(); return; }
  if (k === '[') { S.oct = clamp(+S.oct - 1, 1, 5); syncUI(); buildPads(); save(); return; }
  if (k === ']') { S.oct = clamp(+S.oct + 1, 1, 5); syncUI(); buildPads(); save(); return; }
  let semi = LOWER.indexOf(k);
  if (semi < 0) { const u = UPPER.indexOf(k); if (u >= 0) semi = 12 + u; }
  if (semi >= 0) {
    if (tag === 'BUTTON' && k === ' ') return;
    e.preventDefault();
    const id = 'k' + k;
    if (held.has(id)) return;
    noteOn(id, 12 * (+S.oct + 1) + semi, S.velocity * (e.shiftKey ? 1.3 : 1), hover ? kmodFromY(hover[1]) : 1);
  }
});
window.addEventListener('keyup', (e) => { const id = 'k' + e.key.toLowerCase(); if (held.has(id)) { held.delete(id); audio.post({ type: 'off', id }); } });
window.addEventListener('blur', () => { for (const id of [...held.keys()]) if (String(id).startsWith('k')) { held.delete(id); audio.post({ type: 'off', id }); } });

// ---------- pads ----------
function buildPads() {
  const el = $('pads'); el.innerHTML = '';
  const sc = SCALES[S.scale].s, list = [];
  for (let o = 0; o < 3 && list.length < 15; o++) for (const d of sc) { if (list.length >= 15) break; list.push(baseMidi() + o * 12 + d); }
  list.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${NOTE_NAMES[m % 12]}<small>${Math.floor(m / 12) - 1}</small>`;
    const id = 'p' + m;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); if (S.hold && held.has(id)) { held.delete(id); audio.post({ type: 'off', id }); b.classList.remove('held'); return; } noteOn(id, m, S.velocity); b.classList.add('held'); });
    const up = () => { if (S.hold) return; held.delete(id); audio.post({ type: 'off', id }); b.classList.remove('held'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    el.appendChild(b);
  });
}

// ---------- panel controls ----------
const ENGINE_FMT = {
  bell: { throat: v => (v / 1200).toFixed(2) + ' oct', ring: v => (0.15 + 9 * v * v).toFixed(2) + ' s', bloom: v => (v * 7).toFixed(1) + '%' },
  orbit: { ring: v => (1 + Math.round(v * 3)) + '× · ' + (v * 12 * 1.73).toFixed(0) + '¢', body: v => (1 + 8 * v).toFixed(1) + '×' },
  cloud: { throat: v => (v / 1200).toFixed(2) + ' oct', ring: v => ((0.006 + v * v * 0.45) * 1000).toFixed(0) + ' ms', body: v => (4 + v * v * 300).toFixed(0) + '/s' },
};
function setOut(input) {
  const o = input.parentElement.querySelector('output');
  const f = (ENGINE_FMT[S.engine] && ENGINE_FMT[S.engine][input.id]) || FMT[input.id] || (v => v);
  if (o) o.textContent = f(+input.value);
}
function applyEngineUI() {
  const U = ENGINE_UI[S.engine];
  for (const k of ['throat', 'ring', 'body', 'breath', 'address', 'bloom']) $('lt_' + k).textContent = U[k];
  $('address').innerHTML = U.addr.map((t, i) => `<option value="${i}">${t}</option>`).join('');
  $('address').value = String(S.address);
  $('detailRow').hidden = S.engine !== 'orbit';
  $('throatHead').textContent = U.head;
  $('engineInfo').textContent = U.info;
  for (const b of $('engineSeg').children) b.classList.toggle('on', b.dataset.engine === S.engine);
  for (const [k, b] of Object.entries(presetBtns)) b.hidden = PRESETS[k].engine !== S.engine;
  $('morphTo').innerHTML = Object.entries(PRESETS).filter(([, v]) => v.engine === S.engine).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  if (PRESETS[S.morphTo].engine !== S.engine) S.morphTo = Object.keys(PRESETS).find(k => PRESETS[k].engine === S.engine && k !== S.preset) || S.morphTo;
  $('morphTo').value = S.morphTo;
  if (tabs) tabs.rebuild();
  updateHint();
}
function applyEngineParams(engine, p) {
  Object.assign(S, ENGINE_DEFAULTS[engine], p || {});
  S.engine = engine;
}
function syncUI() {
  for (const el of document.querySelectorAll('#panel input[type=range]')) {
    if (el.id in S) { el.value = S[el.id]; setOut(el); }
  }
  applyEngineUI();
  for (const id of ['morphTo', 'address', 'root', 'oct', 'scale', 'palette', 'quality', 'recFormat', 'vidSize', 'vidFps', 'vidRate', 'vidDur', 'sym']) $(id).value = String(S[id]);
  $('vidOrbits').checked = !!S.vidOrbits;
  $('audioQ').value = String(audioOS());
  $('snap').checked = !!S.snap; $('showTri').checked = !!S.showTri; $('showOrbits').checked = !!S.showOrbits;
  $('holdBtn').classList.toggle('on', !!S.hold);
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === S.mode);
  markPresets();
  buildChips(); syncXf();
}
function onChange(id) {
  if (SYNTH.includes(id)) { sendSynth(); if (id === 'ring' && S.engine === 'voice') { measured = null; patchDirty = true; } }
  else if (id === 'width' || id === 'drive') audio.post({ type: 'params', width: S.width, drive: S.drive });
  else if (PATCH_KEYS.has(id)) { measured = null; patchDirty = true; }
  else if (id === 'reverb' || id === 'volume') audio.setMix(S.reverb, S.volume);
  else if (id === 'room') { clearTimeout(onChange.rt); onChange.rt = setTimeout(() => audio.setRoom(S.room), 120); }
  else if (id === 'root' || id === 'oct' || id === 'scale') buildPads();
  else if (id === 'palette') { lut = paletteLut(S.palette); worker.postMessage({ type: 'palette', lut }); buildChips(); drawPresetThumbs(); }
  else if (id === 'quality') resize(true);
  else if (id === 'vidSize') { if (recorder.recording && recorder.active.kind !== 'wav') recStop(); resize(true); fitNext = true; worker.postMessage({ type: 'fit' }); }
  else if (id === 'sym') { sendSym(); fitNext = true; worker.postMessage({ type: 'fit' }); }
  else if (id === 'audioQ') audio.post({ type: 'os', os: audioOS() });
  save();
}
for (const el of document.querySelectorAll('#panel input[type=range]')) {
  if (!(el.id in DEFAULTS)) continue;
  el.addEventListener('input', () => { S[el.id] = +el.value; setOut(el); onChange(el.id); });
}
for (const id of ['address', 'root', 'oct', 'quality', 'audioQ']) $(id).addEventListener('change', () => { S[id] = +$(id).value; onChange(id); });
for (const id of ['morphTo', 'scale', 'palette', 'recFormat', 'vidSize', 'sym']) $(id).addEventListener('change', () => { S[id] = $(id).value; onChange(id); });
for (const id of ['vidFps', 'vidRate', 'vidDur']) $(id).addEventListener('change', () => { S[id] = +$(id).value; onChange(id); });
$('vidOrbits').addEventListener('change', (e) => { S.vidOrbits = e.target.checked; save(); });
$('snap').addEventListener('change', (e) => { S.snap = e.target.checked; save(); });
$('showTri').addEventListener('change', (e) => { S.showTri = e.target.checked; save(); });
$('showOrbits').addEventListener('change', (e) => { S.showOrbits = e.target.checked; save(); });
$('root').innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
$('scale').innerHTML = Object.entries(SCALES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
for (const id of ['x_v1', 'x_v2']) $(id).innerHTML = VARS.map(v => `<option value="${v}">${v}</option>`).join('');

// selected transform
const XKEYS = ['w', 'rot', 'sx', 'sy', 'shear', 'tx', 'ty', 'col', 'lin', 'a1', 'a2'];
function syncXf() {
  const x = S.xf[S.sel]; if (!x) return;
  for (const k of XKEYS) { const el = $('x_' + k); el.value = x[k]; setOut(el); }
  $('x_v1').value = x.v1; $('x_v2').value = x.v2;
  const det = Math.abs(x.sx * x.sy);
  const what = S.engine === 'voice' ? `formant ≈ ${formantHz(x.rot, S.throat).toFixed(0)} Hz`
    : S.engine === 'bell' ? `partial ×${Math.pow(2, Math.abs(x.rot) / 180 * S.throat / 1200).toFixed(3)} of the note`
    : S.engine === 'orbit' ? `${(x.w * 100 / Math.max(1e-6, S.xf.reduce((a, t) => a + t.w, 0))).toFixed(0)}% of the orbit word`
    : `${(x.w * 100 / Math.max(1e-6, S.xf.reduce((a, t) => a + t.w, 0))).toFixed(0)}% of the grains`;
  $('xInfo').textContent = `Transform ${S.sel + 1}: ${what} · contraction ${Math.sqrt(det).toFixed(2)}${S.morph > 0 ? ' · editing bakes the current morph' : ''}`;
}
for (const k of XKEYS) {
  $('x_' + k).addEventListener('input', (e) => { bakeMorph(); const x = S.xf[S.sel]; x[k] = +e.target.value; setOut(e.target); patchDirty = true; if (k === 'col') buildChips(); syncXf(); save(); });
  $('x_' + k).addEventListener('change', () => { measured = null; patchDirty = true; });
}
for (const id of ['x_v1', 'x_v2']) $(id).addEventListener('change', (e) => { bakeMorph(); S.xf[S.sel][id === 'x_v1' ? 'v1' : 'v2'] = e.target.value; measured = null; patchDirty = true; save(); });
function buildChips() {
  const el = $('chips'); el.innerHTML = '';
  S.xf.forEach((x, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<i style="background:${lutColor(lut, x.col)}"></i>${i + 1}`;
    if (i === S.sel) b.classList.add('on');
    b.addEventListener('click', () => { S.sel = i; buildChips(); syncXf(); });
    el.appendChild(b);
  });
}
function randXf() {
  const r = Math.random;
  const v = VARS[1 + Math.floor(r() * (VARS.length - 1))];
  return makeXf({ rot: (r() * 2 - 1) * 170, sx: 0.35 + r() * 0.5, sy: (r() < 0.15 ? -1 : 1) * (0.35 + r() * 0.5), shear: (r() - 0.5) * 0.4, tx: (r() - 0.5) * 1.4, ty: (r() - 0.5) * 1.4, w: 0.4 + r(), col: r(), lin: r() < 0.5 ? 1 : 0.5, v1: v, a1: r() < 0.5 ? 0 : r() * 0.6 });
}
function explicit() { measured = null; patchDirty = true; fitNext = true; buildChips(); syncXf(); markPresets(); save(); }
$('xAdd').addEventListener('click', () => { if (S.xf.length >= 8) return flash('Eight transforms maximum'); bakeMorph(); S.xf.push(randXf()); S.sel = S.xf.length - 1; explicit(); });
$('xDup').addEventListener('click', () => { if (S.xf.length >= 8) return flash('Eight transforms maximum'); bakeMorph(); const c = { ...S.xf[S.sel], tx: S.xf[S.sel].tx + 0.15 }; S.xf.splice(S.sel + 1, 0, c); S.sel++; explicit(); });
$('xDel').addEventListener('click', () => { if (S.xf.length <= 2) return flash('A voice needs at least two transforms'); bakeMorph(); S.xf.splice(S.sel, 1); S.sel = Math.min(S.sel, S.xf.length - 1); explicit(); });
$('xRand').addEventListener('click', () => { bakeMorph(); S.xf[S.sel] = randXf(); explicit(); });
$('randomize').addEventListener('click', () => { S.morph = 0; const n = 2 + Math.floor(Math.random() * 3); S.xf = Array.from({ length: n }, randXf); S.sel = 0; S.preset = null; syncUI(); explicit(); });
$('mutate').addEventListener('click', () => {
  bakeMorph();
  for (const x of S.xf) { x.rot += (Math.random() - 0.5) * 30; x.sx *= 1 + (Math.random() - 0.5) * 0.15; x.sy *= 1 + (Math.random() - 0.5) * 0.15; x.tx += (Math.random() - 0.5) * 0.12; x.ty += (Math.random() - 0.5) * 0.12; }
  S.preset = null; explicit();
});

// presets
const presetBtns = {};
function thumb(cv, xf) {
  const n = 56, c = cv.getContext('2d'), img = c.createImageData(n, n), P = compile(xf), cnt = new Float32Array(n * n), col = new Float32Array(n * n);
  const nx = P.length / 16, acc = [0, 0];
  let x = 0.1, y = 0.1, cc = 0.5;
  const pts = [];
  for (let k = 0; k < 9000; k++) {
    let tot = 0; for (let i = 0; i < nx; i++) tot += P[i * 16 + 6];
    let r = Math.random() * tot, i = 0; for (; i < nx - 1; i++) { r -= P[i * 16 + 6]; if (r < 0) break; }
    applyXf(P, i, x, y, acc, Math.random() < 0.5 ? 1 : 0); x = acc[0]; y = acc[1]; cc = (cc + P[i * 16 + 7]) / 2;
    if (k > 20) pts.push(x, y, cc);
  }
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let i = 0; i < pts.length; i += 3) { if (!isFinite(pts[i]) || Math.abs(pts[i]) > 20 || Math.abs(pts[i + 1]) > 20) continue; mnx = Math.min(mnx, pts[i]); mxx = Math.max(mxx, pts[i]); mny = Math.min(mny, pts[i + 1]); mxy = Math.max(mxy, pts[i + 1]); }
  const sc = (n - 6) / Math.max(mxx - mnx, mxy - mny, 1e-6);
  for (let i = 0; i < pts.length; i += 3) {
    const ix = Math.floor(3 + (pts[i] - mnx) * sc), iy = Math.floor(n - 3 - (pts[i + 1] - mny) * sc);
    if (ix < 0 || iy < 0 || ix >= n || iy >= n) continue;
    cnt[iy * n + ix]++; col[iy * n + ix] += pts[i + 2];
  }
  let mx = 1; for (const v of cnt) mx = Math.max(mx, v);
  for (let i = 0; i < n * n; i++) {
    const a = cnt[i] ? Math.pow(Math.log(1 + cnt[i]) / Math.log(1 + mx), 0.5) : 0, li = Math.round(col[i] / (cnt[i] || 1) * 255) * 3;
    img.data[4 * i] = lut[li] * a; img.data[4 * i + 1] = lut[li + 1] * a; img.data[4 * i + 2] = lut[li + 2] * a; img.data[4 * i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}
function drawPresetThumbs() { for (const [k, b] of Object.entries(presetBtns)) thumb(b.querySelector('canvas'), PRESETS[k].xf); }
function markPresets() { for (const [k, b] of Object.entries(presetBtns)) b.classList.toggle('on', k === S.preset); }
for (const [k, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button'); b.type = 'button';
  const cv = document.createElement('canvas'); cv.width = cv.height = 56;
  b.append(cv, document.createTextNode(p.name));
  b.addEventListener('click', () => {
    const engineChanged = p.engine !== S.engine;
    S.preset = k; S.xf = clone(p.xf).map(x => makeXf(x)); S.sel = 0; S.morph = 0;
    applyEngineParams(p.engine, p.p);
    if (engineChanged) allOff();
    syncUI(); sendSynth(); explicit();
  });
  presetBtns[k] = b; $('presetGrid').appendChild(b);
}
drawPresetThumbs();

$('engineSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-engine]'); if (!b || b.dataset.engine === S.engine) return;
  allOff();
  applyEngineParams(b.dataset.engine, null);
  S.preset = null; S.morph = 0;
  syncUI(); sendSynth(); measured = null; patchDirty = true; save();
});

// header
function setMode(m) {
  S.mode = m;
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === m);
  updateHint(); save();
}
$('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
$('holdBtn').addEventListener('click', () => { S.hold = !S.hold; $('holdBtn').classList.toggle('on', S.hold); if (!S.hold) allOff(); save(); });
$('offBtn').addEventListener('click', allOff);
$('fitBtn').addEventListener('click', () => { fitNext = true; worker.postMessage({ type: 'fit' }); });

// ---------- export: video, stills, WAV ----------
const vidName = () => `phlox-${(S.preset || 'custom').toLowerCase()}`;
let recPreparing = false, recEndAt = 0;
function setExporting(on) { exporting = on; resize(true); }
/** wait until the renderer has delivered frames at the current size for at least `ms` (accumulation) */
function waitForRender(ms) {
  const t0 = performance.now();
  return new Promise((res) => {
    const chk = () => {
      const ok = frameInfo.W === resize.tw && frameInfo.H === resize.th && frameInfo.t > t0;
      if (ok && performance.now() - t0 >= ms) res(); else if (performance.now() - t0 > ms + 6000) res(); else setTimeout(chk, 40);
    };
    chk();
  });
}
function composite() {
  const W = recCanvas.width, H = recCanvas.height;
  rctx.drawImage(glCanvas, 0, 0, W, H);
  if (S.vidOrbits && S.showOrbits) rctx.drawImage(orbitCv, 0, 0, W, H);
}
async function recStart() {
  if (S.recFormat === 'wav') {
    try { recorder.start({ kind: 'wav', name: vidName() }); } catch (e) { $('recInfo').textContent = e.message; flash(e.message); }
    recEndAt = S.vidDur > 0 ? performance.now() + S.vidDur * 1000 : 0;
    markRec(); return;
  }
  if (!pickMime(S.recFormat)) { const m = S.recFormat === 'mp4' ? 'MP4 recording is not supported in this browser (needs Safari, or Chrome/Edge 126+). Use WebM or WAV.' : 'WebM recording is not supported in this browser — try MP4.'; $('recInfo').textContent = m; flash(m); return; }
  recPreparing = true; markRec();
  setExporting(true);
  const e = exportSize();
  recCanvas.width = e.w; recCanvas.height = e.h;
  await waitForRender(600); // let the flame fill in at the export resolution before the first frame
  composite();
  try {
    recorder.start({ kind: S.recFormat, canvas: recCanvas, fps: +S.vidFps, bitrate: S.vidRate * 1e6, name: `${vidName()}-${e.w}x${e.h}` });
    recEndAt = S.vidDur > 0 ? performance.now() + S.vidDur * 1000 : 0;
  } catch (err) { $('recInfo').textContent = err.message; flash(err.message); setExporting(false); }
  recPreparing = false; markRec();
}
function recStop() {
  if (!recorder.recording) return;
  const kind = recorder.active.kind;
  recorder.stop(); recEndAt = 0;
  if (kind !== 'wav') setExporting(false);
  markRec();
}
function recToggle() {
  wake();
  if (recPreparing) return;
  if (recorder.recording) recStop(); else recStart();
}
function markRec() {
  const live = recorder.recording || recPreparing;
  for (const b of [$('recBtn'), $('recBtn2')]) b.classList.toggle('live', live);
  $('recBtn').textContent = recPreparing ? '… Preparing' : recorder.recording ? '■ Stop' : '● Rec';
  $('recBtn2').textContent = recPreparing ? '… Preparing' : recorder.recording ? '■ Stop recording' : '● Start recording';
}
async function saveStill() {
  wake();
  if (recorder.recording) { composite(); savePng(recCanvas, vidName()); return; }
  const btn = $('stillBtn'); btn.disabled = true; flash('Rendering the still at full resolution…');
  setExporting(true);
  const e = exportSize(); recCanvas.width = e.w; recCanvas.height = e.h;
  await waitForRender(1800);
  view.draw(drawOpts()); drawOrbits(true);
  composite();
  try { await savePng(recCanvas, `${vidName()}-${e.w}x${e.h}`); flash(`Saved ${e.w}×${e.h} PNG`); } catch (err) { flash(err.message); }
  setExporting(false); btn.disabled = false;
}
$('recBtn').addEventListener('click', recToggle);
$('recBtn2').addEventListener('click', recToggle);
$('stillBtn').addEventListener('click', saveStill);
recorder.onSaved = () => flash('Recording saved');
{
  const w = describeMime('webm'), m = describeMime('mp4');
  $('recInfo').textContent = `This browser records WebM as ${w || '— (not supported)'} · MP4 as ${m || '— (not supported; needs Safari, or Chrome/Edge 126+)'}${m && /Opus/.test(m) ? ' — some players (QuickTime, iOS Photos) need AAC; use WebM or convert if one refuses it' : ''} · WAV always.`;
}
$('vidSize').innerHTML = Object.entries(VID_SIZES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
$('sym').innerHTML = Object.entries(SYMS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');

// patches
$('savePatch').addEventListener('click', () => download(new Blob([JSON.stringify(snapshot(), null, 1)], { type: 'application/json' }), `phlox-patch-${S.preset || 'custom'}.json`));
$('loadPatch').addEventListener('click', () => $('patchFile').click());
$('patchFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const obj = JSON.parse(await f.text()); if (obj.app !== 'phlox') throw new Error('not a Phlox patch'); loadState(obj); afterLoad(); }
  catch (err) { flash('Could not load patch: ' + err.message); }
  e.target.value = '';
});
let resetArmT = 0;
function resetClick(btn) {
  if (!btn.classList.contains('armed')) {
    for (const b of [$('resetTop'), $('resetAll')]) { b.classList.add('armed'); b.dataset.label = b.dataset.label || b.textContent; b.textContent = 'Tap again to reset'; }
    clearTimeout(resetArmT);
    resetArmT = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  if (recorder.recording || recPreparing) recStop();
  allOff();
  loadState(null);
  fitNext = true;
  afterLoad();
  flash('Everything reset to defaults');
}
function disarmReset() { clearTimeout(resetArmT); for (const b of [$('resetTop'), $('resetAll')]) { b.classList.remove('armed'); if (b.dataset.label) b.textContent = b.dataset.label; } }
$('resetTop').addEventListener('click', () => resetClick($('resetTop')));
$('resetAll').addEventListener('click', () => resetClick($('resetAll')));
function afterLoad() {
  allOff(); lut = paletteLut(S.palette); worker.postMessage({ type: 'palette', lut });
  cam = S.cam || cam; fitNext = fitNext || !S.cam; if (S.cam) worker.postMessage({ type: 'cam', cam });
  sendSym(); resize(true);
  syncUI(); buildPads(); sendSynth(); audio.post({ type: 'os', os: audioOS() }); audio.post({ type: 'params', width: S.width, drive: S.drive }); audio.setMix(S.reverb, S.volume); audio.setRoom(S.room);
  drawPresetThumbs(); measured = null; patchDirty = true; save();
}

// MIDI
$('midiBtn').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) { $('midiInfo').textContent = 'Web MIDI is not available in this browser.'; return; }
  try {
    const acc = await navigator.requestMIDIAccess();
    const hook = () => {
      const names = []; acc.inputs.forEach((inp) => { inp.onmidimessage = onMidi; names.push(inp.name); });
      $('midiInfo').textContent = names.length ? 'MIDI: ' + names.join(', ') + ' — pitch bend ±2, CC1 breath, CC74 throat, CC64 hold.' : 'MIDI enabled — no inputs connected yet.';
    };
    acc.onstatechange = hook; hook(); $('midiBtn').classList.add('on');
  } catch (e) { $('midiInfo').textContent = 'MIDI access denied.'; }
});
let midiThroat = 1;
function onMidi(ev) {
  const [st, d1, d2] = ev.data, type = st & 0xf0, id = 'm' + d1;
  if (type === 0x90 && d2 > 0) { if (held.has(id)) { held.delete(id); audio.post({ type: 'off', id }); } noteOn(id, d1, d2 / 127 * 1.2, midiThroat); }
  else if (type === 0x80 || (type === 0x90 && d2 === 0)) { if (!S.hold) { held.delete(id); audio.post({ type: 'off', id }); } }
  else if (type === 0xe0) { bend = ((d2 << 7 | d1) - 8192) / 8192 * 2; for (const k of held.keys()) noteSet(k, null, null); }
  else if (type === 0xb0) {
    if (d1 === 1) { S.breath = d2 / 127 * 0.6; $('breath').value = S.breath; setOut($('breath')); sendSynth(); }
    if (d1 === 74) { midiThroat = 0.45 * Math.pow(3.6, d2 / 127); for (const k of held.keys()) if (String(k).startsWith('m')) noteSet(k, null, midiThroat); }
    if (d1 === 64) { S.hold = d2 >= 64; $('holdBtn').classList.toggle('on', S.hold); if (!S.hold) for (const k of [...held.keys()]) if (String(k).startsWith('m')) { held.delete(k); audio.post({ type: 'off', id: k }); } }
  }
}

// ---------- layout ----------
tabs = setupTabs({ panel: $('panel'), bar: $('tabbar'), key: 'phlox.tab' });
function resize(force) {
  const f = frameRect(), v = viewSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // the flame + orbit canvases cover exactly the export frame; the UI canvas covers the whole view
  for (const c of [glCanvas, orbitCv]) {
    c.style.left = f.x + 'px'; c.style.top = f.y + 'px'; c.style.width = f.w + 'px'; c.style.height = f.h + 'px';
    c.style.right = 'auto'; c.style.bottom = 'auto';
  }
  $('view').classList.toggle('framed', S.vidSize !== 'view');
  const uw = Math.max(2, Math.round(v.w * dpr)), uh = Math.max(2, Math.round(v.h * dpr));
  if (uiCv.width !== uw || uiCv.height !== uh) { uiCv.width = uw; uiCv.height = uh; }
  let bw, bh;
  if (exporting) { const e = exportSize(); bw = e.w; bh = e.h; }
  else { bw = Math.max(2, Math.round(f.w * dpr)); bh = Math.max(2, Math.round(f.h * dpr)); }
  view.resize(bw, bh);
  if (orbitCv.width !== bw || orbitCv.height !== bh) { orbitCv.width = bw; orbitCv.height = bh; }
  const q = exporting ? 1 : ([0.45, 0.7, 1][S.quality] ?? 0.7);
  const ss = exporting ? 2 : ([1, 2, 2][S.quality] ?? 2);
  const cap = exporting ? 4096 : 1600;
  const tw = Math.max(64, Math.min(cap, Math.round(bw * q))), th = Math.max(64, Math.min(cap, Math.round(bh * q)));
  if (force || tw !== resize.tw || th !== resize.th || ss !== resize.ss) {
    resize.tw = tw; resize.th = th; resize.ss = ss;
    worker.postMessage({ type: 'size', W: tw, H: th, ss });
    worker.postMessage({ type: 'quality', pts: exporting ? 900000 : ([120000, 260000, 520000][S.quality] ?? 260000), fps: exporting ? Math.min(60, +S.vidFps) : 30 });
    worker.postMessage({ type: 'cam', cam });
    patchDirty = true;
  }
}
function sendSym() { const y = SYMS[S.sym] || SYMS.none; worker.postMessage({ type: 'sym', sym: { n: y.n, mirror: !!y.mirror } }); }
new ResizeObserver(() => resize()).observe($('view'));

const coarse = window.matchMedia('(pointer: coarse)');
function axisName() { return { voice: 'throat', bell: 'mallet hardness', orbit: 'brightness', cloud: 'density' }[S.engine]; }
function updateHint() {
  const t = coarse.matches;
  $('hint').textContent = S.mode === 'play'
    ? (t ? `every finger plays · ↔ pitch · ↕ ${axisName()}` : `click & hold to play · ↔ pitch · ↕ ${axisName()} · Z–/ Q–P keys · Tab edit`)
    : (t ? 'drag triangle corners · one finger pans · pinch zooms · double-tap fits' : 'drag triangle corners · drag empty to pan · wheel zoom · double-click fits · Tab play');
}
coarse.addEventListener && coarse.addEventListener('change', updateHint);
let flashMsg = '', flashT = 0;
function flash(m) { flashMsg = m; flashT = performance.now(); }
function wake() { audio.resume().then(updateStartOverlay); }
function updateStartOverlay() { $('startOverlay').hidden = !audio.ready || audio.running; }
$('startBtn').addEventListener('click', () => wake());

// ---------- overlays ----------
function drawOrbits() {
  const c = octx, W = orbitCv.width, H = orbitCv.height, f = frameRect(), dpr = W / Math.max(1, f.w);
  // world → orbit-canvas pixels
  const toScreen = (x, y) => { const s = camScale(cam, f); return [f.w / 2 + (x - cam.cx) * s, f.h / 2 - (y - cam.cy) * s]; };
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'lighter';
  if (!S.showOrbits) return;
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (S.engine === 'cloud') { // grains: sparks where the chaos game landed
    for (const v of trails) {
      const pts = v.pts, a = Math.min(1, v.env * 1.3) * S.orbitGlow;
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = toScreen(pts[i], pts[i + 1]);
        c.fillStyle = lutColor(lut, 0.75, 0.16 * a); c.beginPath(); c.arc(x * dpr, y * dpr, 14 * dpr, 0, 6.283); c.fill();
        c.fillStyle = lutColor(lut, 0.9, 0.35 * a); c.beginPath(); c.arc(x * dpr, y * dpr, 6 * dpr, 0, 6.283); c.fill();
        c.fillStyle = 'rgba(255,255,255,' + (0.95 * a).toFixed(3) + ')'; c.beginPath(); c.arc(x * dpr, y * dpr, 2.6 * dpr, 0, 6.283); c.fill();
      }
    }
    c.globalAlpha = 1;
    return;
  }
  for (const v of trails) {
    const pts = v.pts; if (pts.length < 4) continue;
    const a = Math.min(1, v.env * 1.2) * S.orbitGlow;
    const col = lutColor(lut, 0.55 + 0.45 * ((v.k * 0.37) % 1), 1);
    c.strokeStyle = col;
    // orbit wavetables retrace the same loop every cycle: draw them finer so the loop stays readable
    const layers = S.engine === 'orbit' ? [[3, 0.03], [1.2, 0.08], [0.7, 0.25]] : [[6, 0.08], [2.2, 0.35], [1, 0.9]];
    for (const [lw, al] of layers) {
      c.globalAlpha = Math.min(1, al * a); c.lineWidth = lw * dpr;
      c.beginPath();
      for (let i = 0; i < pts.length; i += 2) { const [x, y] = toScreen(pts[i], pts[i + 1]); i ? c.lineTo(x * dpr, y * dpr) : c.moveTo(x * dpr, y * dpr); }
      c.stroke();
    }
  }
  c.globalAlpha = 1;
}
function drawUI() {
  const c = uctx, W = uiCv.width, H = uiCv.height, { w, h } = viewSize(), dpr = W / Math.max(1, w);
  c.clearRect(0, 0, W, H);
  c.save(); c.scale(dpr, dpr);
  if (S.mode === 'play') {
    // pitch lanes
    const sc = SCALES[S.scale].s;
    c.font = '11px system-ui'; c.textAlign = 'center';
    for (let semi = 0; semi <= S.span; semi++) {
      const isScale = sc.includes(((semi % 12) + 12) % 12);
      if (S.snap && !isScale) continue;
      const x = (semi + (S.snap ? 0 : 0.5)) / S.span * w;
      const m = baseMidi() + semi, root = semi % 12 === 0;
      c.strokeStyle = root ? 'rgba(255,200,140,.22)' : 'rgba(255,255,255,.07)';
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
      if (isScale) { c.fillStyle = root ? 'rgba(255,210,160,.7)' : 'rgba(255,255,255,.35)'; c.fillText(NOTE_NAMES[m % 12], clamp(x, 8, w - 8), 16); }
    }
    for (const p of ptrs.values()) {
      if (p.kind !== 'note') continue;
      c.strokeStyle = 'rgba(255,220,180,.9)'; c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.y, 20, 0, 6.283); c.stroke();
      c.fillStyle = 'rgba(255,140,60,.18)'; c.fill();
    }
  } else if (S.showTri) {
    S.xf.forEach((x, i) => {
      const t = triPoints(x), sel = i === S.sel;
      const [ox, oy] = toScreen(...t.O), [xx, xy] = toScreen(...t.X), [yx, yy] = toScreen(...t.Y);
      c.strokeStyle = lutColor(lut, x.col, sel ? 1 : 0.55); c.lineWidth = sel ? 2 : 1.2;
      c.fillStyle = lutColor(lut, x.col, sel ? 0.12 : 0.05);
      c.beginPath(); c.moveTo(ox, oy); c.lineTo(xx, xy); c.lineTo(yx, yy); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = sel ? '#fff' : 'rgba(255,255,255,.6)';
      c.beginPath(); c.arc(ox, oy, sel ? 6 : 4, 0, 6.283); c.fill();
      c.fillRect(xx - (sel ? 5 : 3.5), xy - (sel ? 5 : 3.5), sel ? 10 : 7, sel ? 10 : 7);
      c.beginPath(); c.moveTo(yx, yy - 7); c.lineTo(yx + 6, yy + 5); c.lineTo(yx - 6, yy + 5); c.closePath(); c.fill();
      c.font = '12px system-ui'; c.fillText(String(i + 1), ox + 9, oy - 7);
    });
  }
  c.restore();
}

function drawOpts() { return { gamma: S.gamma, bright: S.bright, vib: S.vib, glow: S.glow, de: S.de, high: S.high, relief: S.relief, thresh: 0.015, bg: [0.024, 0.016, 0.04] }; }

// ---------- frame loop ----------
let frameN = 0;
function frame(now) {
  if (S.wander > 0) patchDirty = patchDirty || now - lastPatchT > 33;
  if (patchDirty) { patchDirty = false; pushPatch(now, !measured); }
  view.draw(drawOpts());
  drawOrbits();
  drawUI();
  if (recorder.recording && recorder.active.kind !== 'wav') composite();
  if (recorder.recording && recEndAt && now >= recEndAt) recStop();
  if (++frameN % 6 === 0) {
    let st = `${ENGINES[S.engine].name} · ${S.preset ? PRESETS[S.preset].name : 'Custom flame'}${S.morph > 0 ? ' → ' + PRESETS[S.morphTo].name + ' ' + (S.morph * 100).toFixed(0) + '%' : ''} · ${S.xf.length} transforms · ${held.size} held · ${NOTE_NAMES[+S.root]} ${SCALES[S.scale].name.toLowerCase()}`;
    if (recorder.recording) {
      const el = (now - recorder.t0) / 1000, k = recorder.active.kind;
      st = `● REC ${k.toUpperCase()}${k !== 'wav' ? ' ' + recCanvas.width + '×' + recCanvas.height + ' ' + S.vidFps + 'fps' : ''} · ${el.toFixed(1)} s${recEndAt ? ' / ' + S.vidDur + ' s' : ''} · ` + st;
    } else if (recPreparing) st = 'Preparing the recording at export resolution… · ' + st;
    if (flashMsg && now - flashT < 4000) st = flashMsg;
    $('status').textContent = st;
  }
  requestAnimationFrame(frame);
}

// ---------- boot ----------
worker.postMessage({ type: 'palette', lut });
sendSym();
resize(true);
syncUI();
buildPads();
updateHint();
sendSynth();
audio.init().then(() => {
  audio.post({ type: 'os', os: audioOS() });
  sendSynth();
  audio.post({ type: 'params', width: S.width, drive: S.drive });
  audio.setMix(S.reverb, S.volume);
  audio.setRoom(S.room);
  measured = null; patchDirty = true;
  updateStartOverlay();
  audio.ctx.onstatechange = updateStartOverlay;
}).catch((e) => flash('Audio unavailable: ' + e.message));
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (audio.ready && !audio.running) wake(); }, { capture: true }));
requestAnimationFrame(frame);
window.__phlox = { get S() { return S; }, audio, noteOn, noteOff, allOff, get trails() { return trails; }, get frameInfo() { return frameInfo; }, setMode, frameRect, exportSize, get exporting() { return exporting; }, get recording() { return recorder.recording; }, recStart, recStop, saveStill, onChange };

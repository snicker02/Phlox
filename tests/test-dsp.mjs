// node tests/test-dsp.mjs — Phlox DSP checks (v1.1.0)
import { PRESETS, compile, preparePatch, makeVoice, formantHz, morphXfs, makeXf, matrixOf, setMatrix, Decimator, OS } from '../engine/flame.js';
import { renderOffline, measurePatch } from '../engine/engines.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sr = 48000;
const G = { sr, engine: 'voice', ring: 0.35, detail: 32, throat: 2400, body: 0.15, breath: 0, address: 0, bloom: 0, attack: 0.005, decay: 0.3, sustain: 1, release: 0.2, glide: 0, vibRate: 5, vibDepth: 0, vibDelay: 0 };

function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } } for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), u = i + k + len / 2, xr = re[u] * c - im[u] * s, xi = re[u] * s + im[u] * c; re[u] = re[i + k] - xr; im[u] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } } }
function render(xf, f0, g = G, secs = 1.75) {
  const P = compile(xf), m = measurePatch(P, g, 0.35), prep = preparePatch(P, { ring: 0.35, norm: m.norm });
  const v = makeVoice(3); v.active = true; v.f = v.fTarget = f0; v.vel = 1;
  return renderOffline(v, prep, g, secs);
}
function spec(x, from, N = 65536) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[from + i] * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N));
  fft(re, im);
  return { N, mag: (b) => Math.hypot(re[b], im[b]), pow: (b) => re[b] ** 2 + im[b] ** 2 };
}
function harmonicPeak(x, f0) {
  const s = spec(x, 8000); let best = 0, bf = 0;
  for (let h = 2; h * f0 < 8000; h++) { const b = Math.round(h * f0 * s.N / sr); let m = 0; for (let d = -3; d <= 3; d++) m = Math.max(m, s.mag(b + d)); if (m > best) { best = m; bf = h * f0; } }
  return bf;
}
/** energy away from the harmonics relative to on them, dB — crackle, aliasing and jitter all land here */
function inharmonic(x, f0) {
  const s = spec(x, 8000); let h = 0, o = 0;
  for (let b = 1; b < s.N / 2; b++) { const f = b * sr / s.N, k = f / f0, d = Math.abs(k - Math.round(k)) * f0; if (d < 12) h += s.pow(b); else o += s.pow(b); }
  return 10 * Math.log10(o / h);
}

// 1. formant follows rotation
for (const rot of [40, 95, 150]) {
  const f0 = 55, xf = [makeXf({ rot, sx: 0.85, sy: 0.85, tx: 0.5 }), makeXf({ rot, sx: 0.85, sy: 0.85, tx: -0.5 })];
  const bf = harmonicPeak(render(xf, f0).L, f0), exp = formantHz(rot, 2400);
  ok(Math.abs(bf - exp) <= Math.max(0.12 * exp, 2 * f0), `rotation ${rot}° → formant ${bf} Hz (expected ≈${exp.toFixed(0)})`);
}
// 2. formant fixed across pitch
{
  const xf = [makeXf({ rot: 95, sx: 0.85, sy: 0.85, tx: 0.5 }), makeXf({ rot: 95, sx: 0.85, sy: 0.85, tx: -0.5 })];
  const a = harmonicPeak(render(xf, 110).L, 110), b = harmonicPeak(render(xf, 165).L, 165);
  ok(Math.abs(a - b) < 200, `formant stays put across pitch (${a} vs ${b} Hz)`);
}
// 3. CRACKLE REGRESSION: steady tones must be clean (v1.0.0 measured −15…−25 dB here)
for (const k of ['choir', 'reed', 'golden', 'dragon', 'mono', 'fern']) for (const f0 of [220, 523.25]) {
  const db = inharmonic(render(PRESETS[k].xf, f0).L, f0);
  ok(db < -60, `${k} @ ${f0} Hz: off-harmonic noise ${db.toFixed(1)} dB (< −60)`);
}
for (const k of ['swirl', 'bell', 'heart', 'julia', 'disc', 'hand']) for (const f0 of [220, 880]) {
  const db = inharmonic(render(PRESETS[k].xf, f0).L, f0);
  const lim = k === 'julia' ? -45 : -50; // julia's square-root branch near the origin leaves a faint steady hiss
  ok(db < lim, `${k} (variation waveshaping) @ ${f0} Hz: off-harmonic noise ${db.toFixed(1)} dB (< ${lim})`);
}
// 3b. Light mode (2× oversampling, phone default) is still clean
for (const k of ['reed', 'golden', 'swirl']) {
  const P = compile(PRESETS[k].xf), m = measurePatch(P, G, 0.35), prep = preparePatch(P, { ring: 0.35, norm: m.norm });
  const v = makeVoice(3); v.active = true; v.f = v.fTarget = 330;
  const db = inharmonic(renderOffline(v, prep, G, 1.75, 2).L, 330);
  ok(db < -45, `Light mode (2×) ${k} @ 330 Hz: off-harmonic noise ${db.toFixed(1)} dB (< −45)`);
}
// 4. every preset: finite, normalised, periodic
for (const [k, p] of Object.entries(PRESETS)) {
  if (p.engine !== 'voice') continue;
  const { L, R } = render(p.xf, 196, G, 0.8);
  let e = 0, fin = true, pk = 0;
  for (let i = 8000; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) fin = false; e += L[i] * L[i] + R[i] * R[i]; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const rms = Math.sqrt(e / (2 * (L.length - 8000)));
  const T = sr / 196; let num = 0, den = 0;
  for (let i = 10000; i < 30000; i++) { num += L[i] * L[i + Math.round(T)]; den += L[i] * L[i]; }
  ok(fin && rms > 0.1 && rms < 0.32 && pk < 2 && num / den > 0.8, `preset ${k}: rms ${rms.toFixed(3)}, peak ${pk.toFixed(2)}, periodicity ${(num / den).toFixed(2)}`);
}
// 5. breath is continuous noise (lowers periodicity a little, no impulsive events)
{
  const per = (g) => { const { L } = render(PRESETS.golden.xf, 196, g); const T = Math.round(sr / 196); let n = 0, d = 0; for (let i = 10000; i < 30000; i++) { n += L[i] * L[i + T]; d += L[i] * L[i]; } return n / d; };
  const c = per(G), b = per({ ...G, breath: 0.5 });
  ok(b < c - 0.02 && b > 0.3, `breath adds noise smoothly (periodicity ${c.toFixed(2)} → ${b.toFixed(2)})`);
  const { L } = render(PRESETS.golden.xf, 196, { ...G, breath: 0.5 });
  let mx = 0, rms = 0; for (let i = 8000; i < L.length; i++) { const d = Math.abs(L[i] - L[i - 1]); mx = Math.max(mx, d); rms += d * d; }
  rms = Math.sqrt(rms / (L.length - 8000));
  ok(mx / rms < 8, `no impulsive breath clicks (max/rms of sample steps ${(mx / rms).toFixed(1)})`);
}
// 6. Thue–Morse sub-octave
{
  const sub = (g) => { const s = spec(render(PRESETS.golden.xf, 220, g).L, 8000); const b = f => s.mag(Math.round(f * s.N / sr)); return b(110) / b(220); };
  const c = sub(G), t = sub({ ...G, address: 2 });
  ok(t > c * 3 && t > 0.05, `Thue–Morse adds energy at f0/2 (ratio ${c.toFixed(4)} → ${t.toFixed(3)})`);
}
// 7. decimator: passband flat, stopband deep
{
  const d = new Decimator(OS), n = 4096, gain = (f) => {
    const hi = new Float32Array(n * OS), out = new Float32Array(n);
    for (let i = 0; i < hi.length; i++) hi[i] = Math.sin(2 * Math.PI * f * i / (sr * OS));
    d.process(hi, out); let e = 0; for (let i = 1000; i < n; i++) e += out[i] * out[i]; return Math.sqrt(2 * e / (n - 1000));
  };
  const pass = [1000, 10000, 16000].map(gain), stop = [28000, 50000, 70000].map(gain);
  ok(pass.every(g => Math.abs(20 * Math.log10(g)) < 0.5) && stop.every(g => 20 * Math.log10(g) < -70),
    `decimator passband ${pass.map(g => (20 * Math.log10(g)).toFixed(2)).join('/')} dB, stopband ${stop.map(g => (20 * Math.log10(g)).toFixed(0)).join('/')} dB`);
}
// 8. editing helpers
{
  const x = makeXf({ rot: 33, sx: 0.7, sy: -0.4, shear: 0.2, tx: 0.1, ty: -0.3 }), m = matrixOf(x), y = makeXf({});
  setMatrix(y, m.a, m.b, m.c, m.d); const m2 = matrixOf(y);
  ok(['a', 'b', 'c', 'd'].every(k => Math.abs(m[k] - m2[k]) < 1e-12), 'setMatrix ∘ matrixOf is the identity');
  const mh = morphXfs(PRESETS.reed.xf, PRESETS.golden.xf, 0.5);
  ok(mh.length === 3, 'morph pads transform counts');
}
// 9. the real worklet (mocked scope): polyphony, limiter, smooth live edits, CPU
{
  const mod = await import('../engine/flame.js');
  const eng = await import('../engine/engines.js');
  const src = readFileSync(new URL('../engine/phlox-worklet.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
  const make = () => {
    const reg = {}, posted = [];
    new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'preparePatch', 'makeVoice', 'Decimator', 'OS', 'renderAny', src)(
      48000, class { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }, (n, c) => { reg[n] = c; },
      mod.preparePatch, mod.makeVoice, mod.Decimator, mod.OS, eng.renderAny);
    const W = new reg['phlox-voice'](); W.posted = posted; W.send = d => W.port.onmessage({ data: d }); return W;
  };
  const P = compile(PRESETS.dragon.xf), m = measurePatch(P, G, 0.35);
  const run = (W, blocks, each) => { const out = [[new Float32Array(128), new Float32Array(128)]], L = new Float32Array(blocks * 128); for (let b = 0; b < blocks; b++) { if (each) each(b); W.process([], out); L.set(out[0][0], b * 128); } return L; };
  // chord of 8 loud voices: limiter holds the ceiling
  const W = make();
  W.send({ type: 'patch', P, ring: 0.35, norm: m.norm, jump: true });
  W.send({ type: 'params', g: { ...G, sr: 48000 }, drive: 0 });
  for (let i = 0; i < 10; i++) W.send({ type: 'on', id: 'n' + i, f: 110 * (1 + i * 0.25), vel: 1.5 });
  const t0 = performance.now();
  const L = run(W, 600);
  const ms = (performance.now() - t0) / 600;
  let pk = 0; for (const x of L) pk = Math.max(pk, Math.abs(x));
  ok(W.voices.filter(v => v.active).length === 8 && pk < 1, `8 loud voices: peak ${pk.toFixed(4)} (always below full scale — never clips)`);
  ok(ms < 0.8, `worklet CPU ${ms.toFixed(2)} ms per 128-sample block, 8 voices, linear flame (budget 2.67 ms)`);
  for (const pk2 of ['swirl', 'julia', 'disc', 'heart']) {
    const w2 = make(), P2 = compile(PRESETS[pk2].xf), m2 = measurePatch(P2, G, 0.35);
    w2.send({ type: 'patch', P: P2, ring: 0.35, norm: m2.norm, jump: true });
    w2.send({ type: 'params', g: { ...G, sr: 48000 } });
    for (let i = 0; i < 8; i++) w2.send({ type: 'on', id: 'q' + i, f: 110 * (1 + i * 0.3), vel: 1 });
    run(w2, 50);
    let ms2 = Infinity;
    for (let rep = 0; rep < 3; rep++) { const t1 = performance.now(); run(w2, 300); ms2 = Math.min(ms2, (performance.now() - t1) / 300); } // best of 3 (shared machine)
    ok(ms2 < 1.2, `worklet CPU ${ms2.toFixed(2)} ms per block, 8 voices, ${pk2} (nonlinear shaping)`);
  }
  ok(W.posted.some(p => p.type === 'trails' && p.voices.length === 8 && p.voices[0].pts.length > 50), 'orbit trails shipped');
  // live editing: re-sending the patch every few blocks must not click
  const one = (edits) => {
    const w = make();
    w.send({ type: 'patch', P, ring: 0.35, norm: m.norm, jump: true });
    w.send({ type: 'params', g: { ...G, sr: 48000, vibDepth: 0 }, drive: 0 });
    w.send({ type: 'on', id: 'a', f: 220, vel: 1 });
    return run(w, 400, edits ? (b) => { if (b % 3 === 0) { const xf = PRESETS.dragon.xf.map((x, i) => ({ ...x, rot: x.rot + 6 * Math.sin(b * 0.02 + i) })); w.send({ type: 'patch', P: compile(xf), ring: 0.35, norm: m.norm }); } } : null);
  };
  const a = one(false), b = one(true);
  const stepStat = (x) => { let mx = 0, r = 0; for (let i = 20000; i < x.length; i++) { const d = Math.abs(x[i] - x[i - 1]); mx = Math.max(mx, d); r += d * d; } return mx / Math.sqrt(r / (x.length - 20000)); };
  ok(stepStat(b) < stepStat(a) * 1.5, `live patch edits stay smooth (max/rms step ${stepStat(a).toFixed(1)} steady vs ${stepStat(b).toFixed(1)} while editing)`);
  W.send({ type: 'allOff' }); run(W, 1500);
  ok(W.voices.every(v => !v.active), 'all off releases every voice');
}

// ===================== new engines (v1.1.0) =====================
const ED = {
  bell: { throat: 2400, ring: 0.6, body: 0.5, breath: 0.1, address: 0, bloom: 0.2, attack: 0.001, decay: 1, sustain: 1, release: 1.2, vibDepth: 0, detail: 32 },
  orbit: { throat: 3000, ring: 0.35, body: 0.5, breath: 0, address: 1, bloom: 0.3, attack: 0.02, decay: 0.6, sustain: 0.8, release: 0.5, vibDepth: 0, detail: 32 },
  cloud: { throat: 2400, ring: 0.4, body: 0.5, breath: 0.05, address: 0, bloom: 0.5, attack: 0.3, decay: 1, sustain: 0.9, release: 1.5, vibDepth: 0, detail: 32 },
};
function renderE(key, f0, secs = 1.75, over = {}) {
  const pr = PRESETS[key], g = { ...G, ...ED[pr.engine], ...(pr.p || {}), vibDepth: 0, ...over, engine: pr.engine };
  const P = compile(pr.xf), m = measurePatch(P, g, 0.35), prep = preparePatch(P, { ring: 0.35, norm: m.norm });
  const v = makeVoice(3); v.active = true; v.f = v.fTarget = f0; v.vel = 1;
  return { ...renderOffline(v, prep, g, secs), g, prep };
}
// every non-voice preset: finite, sensible level, no clipping
for (const [k, p] of Object.entries(PRESETS)) {
  if (p.engine === 'voice') continue;
  const { L, R } = renderE(k, 196, 2.5);
  let pk = 0, fin = true, best = 0;
  for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) fin = false; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  for (let w = 0; w + 12000 <= L.length; w += 6000) { let e = 0; for (let i = w; i < w + 12000; i++) e += L[i] * L[i] + R[i] * R[i]; best = Math.max(best, Math.sqrt(e / 24000)); }
  ok(fin && best > 0.08 && best < 0.45 && pk < 2.2, `${p.engine} preset ${k}: loudest 0.25 s rms ${best.toFixed(3)}, peak ${pk.toFixed(2)}`);
}
// bell: partials land at the ratios the triangles' rotations predict (inharmonic by design)
{
  const { L } = renderE('marimba', 110, 1.75, { ring: 0.9 });
  const s = spec(L, 1000), f0 = 110, oct = 4000 / 1200;
  for (const rot of [0, 108, 179.5]) {
    const fexp = f0 * Math.pow(2, rot / 180 * oct), b0 = Math.round(fexp * s.N / sr);
    let best = 0, bb = 0; for (let b = b0 - 40; b <= b0 + 40; b++) { const m = s.mag(b); if (m > best) { best = m; bb = b; } }
    // compare against the noise floor halfway to the next partial
    const floor = s.mag(Math.round(b0 * 1.15));
    ok(Math.abs(bb * sr / s.N - fexp) / fexp < 0.01 && best > floor * 30, `bell partial for rotation ${rot}° at ${(bb * sr / s.N).toFixed(1)} Hz (expected ${fexp.toFixed(1)})`);
  }
}
// bell rings out and frees the voice (strike exciter)
{
  const pr = PRESETS.marimba, g = { ...G, ...ED.bell, ...pr.p, engine: 'bell' };
  const P = compile(pr.xf), prep = preparePatch(P, { ring: 0.35, norm: 1 });
  const v = makeVoice(1); v.active = true; v.f = v.fTarget = 220; v.vel = 1;
  renderOffline(v, prep, g, 6);
  ok(!v.active, 'struck bell frees its voice once it has rung out');
}
// orbit: band-limited wavetable → periodic and clean even at high pitch
for (const [k, f0] of [['saw', 220], ['saw', 1760], ['digidragon', 440], ['organ', 880], ['fernstring', 3520]]) {
  // unison detune and the Bloom brightness envelope are deliberate motion — switch them off to measure the oscillator
  const db = inharmonic(renderE(k, f0, 1.75, { ring: 0, bloom: 0, sustain: 1, breath: 0 }).L, f0);
  ok(db < -60, `orbit ${k} @ ${f0} Hz: off-harmonic noise ${db.toFixed(1)} dB (< −60, band-limited)`);
}
// orbit plays the note: the fundamental is the strongest harmonic for every preset × word
{
  let worst = 0, where = '';
  for (const k of Object.keys(PRESETS).filter(k => PRESETS[k].engine === 'orbit')) for (const ad of [0, 1, 2, 3, 4]) {
    const { L } = renderE(k, 110, 1, { address: ad, ring: 0, breath: 0, bloom: 0, throat: 20000, sustain: 1 });
    const s = spec(L, 8000, 32768), H = [];
    for (let h = 1; h <= 40; h++) { const b = Math.round(h * 110 * s.N / sr); H.push(Math.max(s.mag(b - 1), s.mag(b), s.mag(b + 1))); }
    const db = 20 * Math.log10(H[0] / Math.max(...H));
    if (db < worst) { worst = db; where = `${k}/word ${ad}`; }
  }
  ok(worst > -6, `orbit pitch: fundamental within 6 dB of the strongest harmonic everywhere (worst ${worst.toFixed(1)} dB${where ? ' at ' + where : ''})`);
}
// orbit words give different timbres from the same flame
{
  const cent = (L) => { const s = spec(L, 8000); let a = 0, b = 0; for (let k = 1; k < s.N / 2; k++) { const p = s.pow(k); a += p * k; b += p; } return a / b * sr / s.N; };
  const c = [0, 1, 2, 3, 4].map(ad => cent(renderE('digidragon', 220, 1.75, { address: ad, ring: 0, throat: 20000 }).L));
  const spread = Math.max(...c) / Math.min(...c);
  ok(spread > 1.15, `orbit words change the timbre (spectral centroids ${c.map(x => x.toFixed(0)).join('/')} Hz)`);
}
// cloud: harmonic tuning keeps grains on the note's harmonics; grains are spawned
{
  const { L } = renderE('shimmer', 220, 1.75, { breath: 0 });
  const s = spec(L, 8000); let on = 0, off = 0;
  for (let b = 1; b < s.N / 2; b++) { const f = b * sr / s.N; if (f > 6000) break; const k = f / 220, d = Math.abs(k - Math.round(k)) * 220; if (d < 30) on += s.pow(b); else off += s.pow(b); }
  const r = 10 * Math.log10(off / on);
  ok(r < -10, `cloud harmonic tuning: energy off the note's harmonics ${r.toFixed(1)} dB`);
}
// worklet: each engine, 8 voices, CPU + clean switch
{
  const mod = await import('../engine/flame.js'), eng = await import('../engine/engines.js');
  const src = readFileSync(new URL('../engine/phlox-worklet.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
  const reg = {};
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'preparePatch', 'makeVoice', 'Decimator', 'OS', 'renderAny', src)(
    48000, class { constructor() { this.port = { postMessage: () => {}, onmessage: null }; } }, (n, c) => { reg[n] = c; }, mod.preparePatch, mod.makeVoice, mod.Decimator, mod.OS, eng.renderAny);
  const W = new reg['phlox-voice'](), send = d => W.port.onmessage({ data: d });
  const out = [[new Float32Array(128), new Float32Array(128)]];
  for (const [engine, key] of [['bell', 'plate'], ['orbit', 'swirlpad'], ['cloud', 'swarm']]) {
    const pr = PRESETS[key], g = { ...G, ...ED[engine], ...pr.p, engine };
    const P = compile(pr.xf), m = measurePatch(P, g, 0.35);
    send({ type: 'params', g: { ...g, sr: 48000 } });
    send({ type: 'patch', P, ring: 0.35, norm: m.norm, jump: true });
    for (let i = 0; i < 8; i++) send({ type: 'on', id: engine + i, f: 110 * (1 + i * 0.3), vel: 1 });
    for (let b = 0; b < 40; b++) W.process([], out);
    let best = Infinity, pk = 0;
    for (let rep = 0; rep < 3; rep++) { const t = performance.now(); for (let b = 0; b < 200; b++) { W.process([], out); for (const x of out[0][0]) pk = Math.max(pk, Math.abs(x)); } best = Math.min(best, (performance.now() - t) / 200); }
    ok(best < 1.2 && pk < 1, `worklet ${engine}: ${best.toFixed(2)} ms/block for 8 voices, peak ${pk.toFixed(3)}`);
  }
  send({ type: 'params', g: { ...G, engine: 'voice', sr: 48000 } });
  ok(W.voices.every(v => !v.active), 'switching engine clears the other engine\'s voices');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

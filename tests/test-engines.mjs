// Phlox: offline checks for the String, Pulse and Scan engines — finite, below clipping, audible, String in tune.
import { PRESETS, compile, makeVoice, preparePatch } from '../engine/flame.js';
import { renderOffline, measurePatch } from '../engine/engines.js';
const sr = 48000;
const DEF = {
  string: { throat: 1200, ring: 0.5, body: 0.6, breath: 0.1, address: 0, bloom: 0.35, attack: 0.001, decay: 1, sustain: 1, release: 0.4, vibDepth: 0, detail: 32 },
  pulse: { throat: 2400, ring: 0.35, body: 0.5, breath: 0.2, address: 0, bloom: 0.1, attack: 0.001, decay: 1, sustain: 1, release: 0.3, vibDepth: 0, detail: 32 },
  scan: { throat: 3000, ring: 0.3, body: 0.5, breath: 0.1, address: 0, bloom: 0.3, attack: 0.25, decay: 1, sustain: 1, release: 1.2, vibDepth: 6, detail: 24 },
};
let fails = 0;
function pitch(x, f0) { // autocorrelation peak near expected period
  const n = 8192, o = Math.floor(x.length * 0.3); let best = 0, bl = 0;
  const lo = Math.floor(sr / (f0 * 1.5)), hi = Math.ceil(sr / (f0 / 1.5));
  for (let l = lo; l <= hi; l++) { let s = 0, e = 0; for (let i = 0; i < n; i++) { s += x[o + i] * x[o + i + l]; e += x[o+i]*x[o+i]; } if (s > best) { best = s; bl = l; } }
  return sr / bl;
}
for (const [k, p] of Object.entries(PRESETS)) {
  if (!DEF[p.engine]) continue;
  const g = Object.assign({ sr, os: 1, engine: p.engine, glide: 0, vibRate: 5, vibDelay: 0.3 }, DEF[p.engine], p.p || {});
  const P = compile(p.xf);
  const m = measurePatch(P, g, g.ring);
  const prep = preparePatch(P, { ring: g.ring, norm: m.norm });
  for (const f of [110, 440, 1400]) {
    const v = makeVoice(3); v.active = true; v.vel = 0.9; v.f = v.fTarget = f; v.kmod = 1;
    const t0 = performance.now();
    const { L, R } = renderOffline(v, prep, g, 2.0);
    const ms = performance.now() - t0;
    let pk = 0, e = 0, bad = 0, jump = 0;
    for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (!isFinite(a)) bad++; pk = Math.max(pk, a); e += L[i]*L[i]; if (i && Math.abs(L[i]-L[i-1]) > 0.5) jump++; }
    const rms = Math.sqrt(e / L.length);
    let extra = '';
    if (p.engine === 'string' && f <= 440) { const pf = pitch(L, f); extra = ` pitch ${pf.toFixed(1)} (${(1200*Math.log2(pf/f)).toFixed(0)}¢)`; if (Math.abs(1200*Math.log2(pf/f)) > 35) { extra += ' OFF'; fails++; } }
    const ok = !bad && pk < 3 && rms > 0.005;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${p.engine.padEnd(6)} ${k.padEnd(10)} ${String(f).padStart(4)} Hz  peak ${pk.toFixed(2)} rms ${rms.toFixed(3)} norm ${m.norm.toFixed(2)} cpu ${(ms/2/10).toFixed(2)}%/voice${extra}${bad ? ' NaN' : ''}${jump ? ' jumps ' + jump : ''}`);
  }
}
console.log(fails ? fails + ' FAILED' : 'ALL PASS');

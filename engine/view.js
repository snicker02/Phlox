// Phlox v1.2.1 — WebGL1 display of the flame histogram.
// Texture: RGB = average palette colour, A = √(log-density / 1.25) from the render worker.
// Shader: gamma with a linear threshold (faint areas don't turn to noise), vibrancy,
// density-estimation smoothing (sparse pixels average over a wider neighbourhood, like flam3's
// DE filter), highlight power (blown colours desaturate to white instead of clipping),
// relief lighting from the density gradient, and glow.

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGamma, uBright, uVib, uGlow, uDE, uHigh, uRelief, uThresh;
uniform vec3 uBg;

float dec(vec4 t) { return t.a * t.a * 1.25; }                       // decoded log-density
vec4 smp(vec2 uv) { vec4 t = texture2D(uTex, uv); float d = dec(t); return vec4(t.rgb * d, d); } // premultiplied

vec3 tone(vec4 pm) {
  float d = pm.a;
  if (d <= 0.0) return vec3(0.0);
  vec3 c = pm.rgb / d;
  float g = 1.0 / uGamma;
  float al = d < uThresh ? d / uThresh * pow(uThresh, g) : pow(d, g); // linear below the threshold
  al *= uBright;
  vec3 vib = c * al;
  vec3 flatc = pow(c * min(d, 1.0), vec3(g)) * uBright;
  vec3 col = mix(flatc, vib, uVib);
  float m = max(col.r, max(col.g, col.b));
  if (m > 1.0) col = mix(col / m, vec3(1.0), clamp((m - 1.0) * uHigh, 0.0, 1.0)); // highlight power
  return col;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 c0 = smp(uv);
  // empty background far from the flame: nothing to smooth or glow — skip the expensive work.
  if (c0.a <= 0.0 && uDE <= 0.0 && uGlow <= 0.0) { gl_FragColor = vec4(uBg, 1.0); return; }
  // 8 probes cover the glow and smoothing reach (≤ 6 texels).
  if (c0.a <= 0.0 && (uDE > 0.0 || uGlow > 0.0)) {
    float probe = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + 0.3927;
      vec2 o = vec2(cos(a), sin(a)) * uTexel;
      probe += texture2D(uTex, uv + o * 2.5).a + texture2D(uTex, uv + o * 5.5).a;
      if (probe > 0.0) break;
    }
    if (probe <= 0.0) { gl_FragColor = vec4(uBg, 1.0); return; }
  }
  if (uDE > 0.0) {
    float sp = 1.0 - clamp(sqrt(c0.a), 0.0, 1.0);               // 1 = sparse, 0 = dense
    float sp2 = sp * sp;                                        // only genuinely sparse pixels get the wide kernel
    float r = 0.6 + uDE * 2.6 * sp2;                            // kernel radius in texels
    vec4 s = c0 * 2.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + 0.3927;
      s += smp(uv + vec2(cos(a), sin(a)) * uTexel * r);
    }
    c0 = mix(c0, s / 10.0, clamp(uDE * (0.05 + 1.1 * sp2), 0.0, 1.0));
  }
  vec3 col = tone(c0);
  if (uRelief > 0.0) {
    // gradient of the density over a 2-ring neighbourhood (structure, not per-pixel sampling noise)
    vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
    float dx = 0.0, dy = 0.0;
    for (int k = 1; k <= 2; k++) {
      float f = float(k) * 1.6;
      dx += dec(texture2D(uTex, uv + tx * f)) - dec(texture2D(uTex, uv - tx * f))
          + 0.5 * (dec(texture2D(uTex, uv + tx * f + ty * f)) - dec(texture2D(uTex, uv - tx * f + ty * f)))
          + 0.5 * (dec(texture2D(uTex, uv + tx * f - ty * f)) - dec(texture2D(uTex, uv - tx * f - ty * f)));
      dy += dec(texture2D(uTex, uv - ty * f)) - dec(texture2D(uTex, uv + ty * f))
          + 0.5 * (dec(texture2D(uTex, uv - ty * f + tx * f)) - dec(texture2D(uTex, uv + ty * f + tx * f)))
          + 0.5 * (dec(texture2D(uTex, uv - ty * f - tx * f)) - dec(texture2D(uTex, uv + ty * f - tx * f)));
    }
    vec3 n = normalize(vec3(-dx * 1.4, -dy * 1.4, 1.0));
    vec3 L = normalize(vec3(-0.5, 0.6, 0.62));
    float dif = clamp(dot(n, L), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);
    float lum = max(col.r, max(col.g, col.b));
    col = col * mix(1.0, 0.3 + 0.95 * dif, uRelief) + spec * uRelief * 0.45 * min(lum * 2.0, 1.0);
  }
  if (uGlow > 0.0) {
    // two rings of raw (premultiplied) samples, tone-mapped once per ring — not once per sample
    vec4 g1 = vec4(0.0), g2 = vec4(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 o = vec2(cos(a), sin(a)) * uTexel;
      g1 += smp(uv + o * 3.0);
      g2 += smp(uv + o * 7.0);
    }
    col += (tone(g1 / 8.0) * 8.0 + tone(g2 / 8.0) * 4.8) * (uGlow / 13.0);
  }
  float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  vec3 outc = uBg * (1.0 - alpha) + col;
  gl_FragColor = vec4(min(outc, vec3(1.0)), 1.0);
}
`;

export class FlameView {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    this.pr = pr; gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'aPos');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uTex', 'uTexel', 'uGamma', 'uBright', 'uVib', 'uGlow', 'uDE', 'uHigh', 'uRelief', 'uThresh', 'uBg']) this.u[n] = gl.getUniformLocation(pr, n);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.tw = 1; this.th = 1;
  }
  upload(W, H, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (W !== this.tw || H !== this.th) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); this.tw = W; this.th = H; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  resize(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  draw(o) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.u.uTex, 0);
    gl.uniform2f(this.u.uTexel, 1 / this.tw, 1 / this.th);
    gl.uniform1f(this.u.uGamma, o.gamma); gl.uniform1f(this.u.uBright, o.bright); gl.uniform1f(this.u.uVib, o.vib); gl.uniform1f(this.u.uGlow, o.glow);
    gl.uniform1f(this.u.uDE, o.de ?? 0); gl.uniform1f(this.u.uHigh, o.high ?? 1); gl.uniform1f(this.u.uRelief, o.relief ?? 0); gl.uniform1f(this.u.uThresh, o.thresh ?? 0.01);
    gl.uniform3fv(this.u.uBg, o.bg);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// ---- palettes (flame gradients) ----
export const PALETTES = {
  ember: ['#2a0610', '#8a1424', '#ff5a1f', '#ffc56a', '#fff3d6'],
  abyss: ['#061a3a', '#0b4a8a', '#19a3b8', '#9ff0e0', '#ffffff'],
  orchid: ['#2b0638', '#7a1c8c', '#e04aa8', '#ffa07a', '#fff1c1'],
  verdigris: ['#08261b', '#11634a', '#3fae86', '#d8e89a', '#fffbe8'],
  aurora: ['#1b0f5e', '#2c7bd6', '#36e0b0', '#e6f56a', '#ff7ac8'],
  solar: ['#3b0a00', '#a32a00', '#ff7a00', '#ffd43b', '#fffbe6'],
  glacier: ['#0a1430', '#24508f', '#7fb8e6', '#dff2ff', '#ffffff'],
  ink: ['#3a3a3a', '#6e6e6e', '#a8a8a8', '#dcdcdc', '#ffffff'],
};
export function paletteLut(name) {
  const st = (PALETTES[name] || PALETTES.ember).map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (st.length - 1), k = Math.min(st.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(st[k][c] + (st[k + 1][c] - st[k][c]) * f);
  }
  return lut;
}
export function lutColor(lut, t, a = 1) {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return `rgba(${lut[i]},${lut[i + 1]},${lut[i + 2]},${a})`;
}

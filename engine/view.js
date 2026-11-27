// Phlox — WebGL1 display of the flame histogram (log-density + palette colour), with gamma/vibrancy/glow.

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGamma, uBright, uVib, uGlow;
uniform vec3 uBg;

vec3 tone(vec4 t){
  float a = t.a;
  float al = pow(max(a, 0.0), 1.0 / uGamma) * uBright;
  vec3 c = t.rgb;
  vec3 vib = c * al;
  vec3 flatc = pow(max(c * a, vec3(0.0)), vec3(1.0 / uGamma)) * uBright;
  return mix(flatc, vib, uVib);
}

void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 t = texture2D(uTex, uv);
  vec3 col = tone(t);
  if (uGlow > 0.0) {
    vec3 g = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 o = vec2(cos(a), sin(a));
      g += tone(texture2D(uTex, uv + o * uTexel * 3.0));
      g += tone(texture2D(uTex, uv + o * uTexel * 7.0)) * 0.6;
    }
    col += g * (uGlow / 13.0);
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
    for (const n of ['uTex', 'uTexel', 'uGamma', 'uBright', 'uVib', 'uGlow', 'uBg']) this.u[n] = gl.getUniformLocation(pr, n);
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

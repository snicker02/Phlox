// Phlox v1.2.1 — recording: video (WebM or MP4 via MediaRecorder) from a dedicated export canvas
// at the chosen resolution, lossless WAV via the tap worklet, and PNG stills.
import { fixWebmDuration } from './webm-duration.js';

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MP4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'];

export function pickMime(kind) {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = kind === 'mp4' ? MP4 : WEBM;
  for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ } }
  return null;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

export class Recorder {
  constructor(audio) { this.audio = audio; this.active = null; this.t0 = 0; this.frames = 0; }

  get recording() { return !!this.active; }

  /** opts: { kind: 'webm'|'mp4'|'wav', canvas, fps, bitrate (bits/s), name } */
  start(opts) {
    if (this.active) return;
    if (opts.kind === 'wav') return this.startWav(opts.name);
    const mime = pickMime(opts.kind);
    if (!mime) throw new Error(opts.kind === 'mp4' ? 'MP4 recording is not supported in this browser (needs Safari, or Chrome/Edge 126+). Use WebM or WAV.' : 'WebM recording is not supported in this browser — try MP4 or WAV.');
    const fps = opts.fps || 60;
    const v = opts.canvas.captureStream(fps);
    const stream = new MediaStream([...v.getVideoTracks(), ...this.audio.streamDest.stream.getAudioTracks()]);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitrate || 16e6, audioBitsPerSecond: 256000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const ext = opts.kind === 'mp4' ? 'mp4' : 'webm';
    rec.onstop = async () => {
      v.getTracks().forEach(t => t.stop());
      let blob = new Blob(chunks, { type: mime.split(';')[0] });
      // Chrome writes WebM without a duration (no length shown, poor seeking): patch it in
      if (ext === 'webm') blob = await fixWebmDuration(blob, performance.now() - this.t0);
      download(blob, `${opts.name || 'phlox'}-${stamp()}.${ext}`);
      if (this.onSaved) this.onSaved();
    };
    rec.start(500);
    this.active = { kind: opts.kind, stop: () => rec.stop(), mime };
    this.t0 = performance.now(); this.frames = 0;
  }

  startWav(name) {
    const port = this.audio.tap.port, L = [], R = [];
    const sr = this.audio.ctx.sampleRate;
    port.onmessage = (e) => {
      if (e.data.type === 'chunk') { L.push(e.data.l); R.push(e.data.r); }
      if (e.data.type === 'done') { port.onmessage = null; download(encodeWav(L, R, sr), `${name || 'phlox'}-${stamp()}.wav`); if (this.onSaved) this.onSaved(); }
    };
    port.postMessage('start');
    this.active = { kind: 'wav', stop: () => port.postMessage('stop') };
    this.t0 = performance.now();
  }

  stop() { if (!this.active) return; this.active.stop(); this.active = null; }
}

/** Human-readable codecs for a container, e.g. "H.264 + AAC". */
export function describeMime(kind) {
  const m = pickMime(kind);
  if (!m) return null;
  const v = /avc1/.test(m) ? 'H.264' : /vp9/.test(m) ? 'VP9' : /vp8/.test(m) ? 'VP8' : 'video';
  const a = /mp4a/.test(m) ? 'AAC' : /opus/.test(m) ? 'Opus' : kind === 'webm' ? 'Opus' : 'browser default audio';
  return `${v} + ${a}`;
}

export function savePng(canvas, name) {
  return new Promise((res, rej) => canvas.toBlob(b => { if (!b) return rej(new Error('image encode failed')); download(b, `${name || 'phlox'}-${stamp()}.png`); res(b); }, 'image/png'));
}

export function encodeWav(L, R, sr) {
  const n = L.reduce((a, b) => a + b.length, 0);
  const buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 4, true);
  let o = 44;
  for (let c = 0; c < L.length; c++) {
    const l = L[c], r = R[c];
    for (let i = 0; i < l.length; i++) {
      dv.setInt16(o, Math.max(-1, Math.min(1, l[i])) * 32767, true);
      dv.setInt16(o + 2, Math.max(-1, Math.min(1, r[i])) * 32767, true);
      o += 4;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Phlox — recording: video (WebM or MP4 via MediaRecorder) and lossless WAV via the tap worklet.

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MP4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640028,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4'];

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

const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

export class Recorder {
  constructor(audio, canvas) { this.audio = audio; this.canvas = canvas; this.active = null; this.t0 = 0; }

  get recording() { return !!this.active; }

  start(kind) {
    if (this.active) return;
    if (kind === 'wav') return this.startWav();
    const mime = pickMime(kind);
    if (!mime) throw new Error(kind === 'mp4' ? 'MP4 recording is not supported in this browser (needs Safari or Chrome 126+). Use WebM or WAV.' : 'WebM recording is not supported in this browser — try MP4 or WAV.');
    const v = this.canvas.captureStream(60);
    const stream = new MediaStream([...v.getVideoTracks(), ...this.audio.streamDest.stream.getAudioTracks()]);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 192000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      v.getTracks().forEach(t => t.stop());
      download(new Blob(chunks, { type: mime.split(';')[0] }), `phlox-${stamp()}.${kind === 'mp4' ? 'mp4' : 'webm'}`);
    };
    rec.start(250);
    this.active = { kind, stop: () => rec.stop() };
    this.t0 = performance.now();
  }

  startWav() {
    const port = this.audio.tap.port, L = [], R = [];
    const sr = this.audio.ctx.sampleRate;
    port.onmessage = (e) => {
      if (e.data.type === 'chunk') { L.push(e.data.l); R.push(e.data.r); }
      if (e.data.type === 'done') { port.onmessage = null; download(encodeWav(L, R, sr), `phlox-${stamp()}.wav`); }
    };
    port.postMessage('start');
    this.active = { kind: 'wav', stop: () => port.postMessage('stop') };
    this.t0 = performance.now();
  }

  stop() { if (!this.active) return; this.active.stop(); this.active = null; }
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

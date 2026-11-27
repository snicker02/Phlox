// Phlox v1.3.0 — give MediaRecorder WebM files a duration.
// Chrome's MediaRecorder writes WebM with no Duration in the Segment Info, so players show no
// length and often can't seek. This inserts (or fixes) the EBML Duration element. Only the first
// 64 KB are parsed; the rest of the file is passed through untouched (Blob slices, no big copies).

const ID_SEGMENT = 0x18538067, ID_INFO = 0x1549A966, ID_DURATION = 0x4489, ID_TIMECODESCALE = 0x2AD7B1;

function readId(b, p) {
  const f = b[p]; let len = 1;
  if (f & 0x80) len = 1; else if (f & 0x40) len = 2; else if (f & 0x20) len = 3; else if (f & 0x10) len = 4; else return null;
  let id = 0; for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}
function readSize(b, p) {
  const f = b[p]; let len = 1, mask = 0x80;
  while (len <= 8 && !(f & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let v = f & (mask - 1), unknown = v === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) unknown = false; }
  return { size: v, len, unknown };
}
function writeSize(v, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}
function sizeLen(v) { let len = 1; while (v >= Math.pow(2, 7 * len) - 1) len++; return len; }

/** @param {Blob} blob WebM from MediaRecorder  @param {number} ms duration in milliseconds  @returns {Promise<Blob>} */
export async function fixWebmDuration(blob, ms) {
  try {
    const headLen = Math.min(blob.size, 65536);
    const b = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
    let p = 0;
    // EBML header
    let e = readId(b, p); if (!e || e.id !== 0x1A45DFA3) return blob;
    let s = readSize(b, p + e.len); p += e.len + s.len + s.size;
    // Segment
    e = readId(b, p); if (!e || e.id !== ID_SEGMENT) return blob;
    const segSizePos = p + e.len, seg = readSize(b, segSizePos);
    p = segSizePos + seg.len;
    // find Info among the Segment's first children
    while (p < headLen - 8) {
      const c = readId(b, p); if (!c) return blob;
      const cs = readSize(b, p + c.len); if (!cs) return blob;
      if (c.id === ID_INFO) {
        const infoStart = p, payStart = p + c.len + cs.len, payEnd = payStart + cs.size;
        if (payEnd > headLen) return blob;
        let scale = 1e6, durPos = -1, durLen = 0;
        for (let q = payStart; q < payEnd;) {
          const ci = readId(b, q), cz = readSize(b, q + ci.len), dp = q + ci.len + cz.len;
          if (ci.id === ID_TIMECODESCALE) { let v = 0; for (let i = 0; i < cz.size; i++) v = v * 256 + b[dp + i]; scale = v || 1e6; }
          if (ci.id === ID_DURATION) { durPos = dp; durLen = cz.size; }
          q = dp + cz.size;
        }
        const value = ms * 1e6 / scale; // in TimecodeScale units
        if (durPos >= 0) { // already present: overwrite in place
          const out = b.slice(0, headLen), dv = new DataView(out.buffer);
          if (durLen === 8) dv.setFloat64(durPos, value); else if (durLen === 4) dv.setFloat32(durPos, value); else return blob;
          return new Blob([out, blob.slice(headLen)], { type: blob.type });
        }
        // insert Duration (ID 0x4489, size 8, float64) at the end of Info
        const dur = new Uint8Array(11); dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88; new DataView(dur.buffer).setFloat64(3, value);
        const newSize = cs.size + 11, sl = Math.max(cs.len, sizeLen(newSize));
        const infoHead = new Uint8Array(c.len + sl);
        infoHead.set(b.subarray(infoStart, infoStart + c.len), 0);
        infoHead.set(writeSize(newSize, sl), c.len);
        const grow = 11 + (sl - cs.len);
        const pre = b.slice(0, infoStart);
        if (!seg.unknown) { // known Segment size: grow it, keeping its byte width
          let v = seg.size + grow; const w = writeSize(v, seg.len); pre.set(w, segSizePos);
        }
        return new Blob([pre, infoHead, b.subarray(payStart, payEnd), dur, blob.slice(payEnd)], { type: blob.type });
      }
      if (cs.unknown) return blob;
      p += c.len + cs.len + cs.size;
    }
  } catch (err) { /* leave the file as recorded */ }
  return blob;
}

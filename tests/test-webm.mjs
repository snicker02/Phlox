// node tests/test-webm.mjs <file.webm> — inserts a duration and checks it with ffprobe
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fixWebmDuration } from '../engine/webm-duration.js';
const src = process.argv[2];
const before = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${src}"`).toString().trim();
const blob = new Blob([readFileSync(src)], { type: 'video/webm' });
const fixed = await fixWebmDuration(blob, 3210);
const out = '/tmp/fixed.webm';
writeFileSync(out, Buffer.from(await fixed.arrayBuffer()));
const after = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${out}"`).toString().trim();
const frames = execSync(`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${out}"`).toString().trim();
const twice = await fixWebmDuration(fixed, 4000);
writeFileSync('/tmp/fixed2.webm', Buffer.from(await twice.arrayBuffer()));
const after2 = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/fixed2.webm`).toString().trim();
const ok = Math.abs(+after - 3.21) < 0.01 && +frames > 0 && Math.abs(+after2 - 4) < 0.01;
console.log(`${ok ? 'PASS' : 'FAIL'} webm duration: before "${before}", after ${after} s (expected 3.21), video frames still decode: ${frames}, re-fix overwrites in place: ${after2} s`);
process.exit(ok ? 0 : 1);

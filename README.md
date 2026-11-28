# Phlox

**The flame voice.** Version 1.3.0

Phlox (Greek φλόξ, "flame") is an instrument played by a flame fractal. It has seven engines, each turning the same IFS transforms into a different kind of sound:

| Engine | What it is | Transform → sound |
|---|---|---|
| **Voice** | Formant singer | each transform is a resonance of the throat (details below) |
| **Bell** | Struck / bowed body | each transform is an inharmonic partial ringing in parallel: rotation sets the ratio, size the ring time, position how hard it is hit. Exciters: strike, double strike, roll, bow (singing bowl), scrape |
| **Orbit** | Wavetable synth | the flame's periodic orbit under an address word, variations included, is traced as an outline; one trip round it is one cycle. Band-limited mip tables, unison, Edge (fractal jaggedness), brightness filter |
| **Cloud** | Granular | the chaos game runs live; each point it lands on spawns a grain. Height on the fractal is pitch (harmonics / pentatonic / free / octaves / fifths), left/right is pan, and the grains show as sparks |
| **String** | Waveguide string | one period of the flame's orbit outline is the pluck shape, its x and y the string's two polarisations; every transform is an allpass dispersion stage in the loop (rotation → stiffness / inharmonicity). Exciters: pluck, pick, hammer, bow, feedback (e-bow). The vibrating string is drawn on the flame |
| **Pulse** | Rhythm | a step clock (tempo, swing) drives the chaos game; each transform is a tuned drum: rotation sets its pitch, size its decay, position its pan and accent, height its noise (snare / hat). Rhythms: chaos dice, Euclidean, Thue–Morse word, Fibonacci word, ratchet. Held notes share one clock |
| **Scan** | Spectral scanner | the flame's density picture is read like a spectrogram: a line sweeps across it and the brightness bottom to top sets each partial's loudness (harmonics / odd / stretched / pentatonic chord / half harmonics). The left and right ears read either side of the line, which is drawn on the flame |

The Throat panel relabels itself for each engine (Throat / Strike / Wave / Grains / String / Rhythm / Scan). The play surface's vertical axis is the throat (Voice), mallet hardness (Bell), brightness (Orbit, String, Scan), density (Cloud) or busyness (Pulse).

### The Voice engine

Iterating an affine map z ← A·z + b over and over, once per audio sample, makes a resonator: z spirals into the map's fixed point, and that spiral is a ringing tone.
So every transform of an IFS flame is a **formant**:

| Triangle property | What you hear |
|---|---|
| Rotation | Formant pitch (0° is a dull "oo"; 180° is a bright "ee") |
| Size / contraction | How long the formant rings (bandwidth) |
| Position on the fractal | How hard it is struck when the voice jumps to it |
| Aspect and shear | The stereo shape of the ring (left = x, right = y) |
| Variations (swirl, julia, spherical, ...) | Bend the voice's path like a geometric waveshaper: grit, growl and bell tones |
| Weight | How much of each pitch period the transform holds |

Each pitch period the voice hops from transform to transform, like vocal cords pulsing into a vocal tract.
Breath is noise blown through those same resonators.
The glowing loops drawn over the flame are the actual audio: each voice's point ringing around one fixed point, then jumping to the next.

## Playing
- **Play mode**: the canvas is a playing surface. Left↔right is pitch (scale-snapped or free), and up↕down opens or closes the throat. Every finger is its own voice (8-voice polyphony). **Hold** latches notes.
- **Edit mode**: JWildfire-style triangles. Drag the ○ origin or the body to move a transform, and drag the □ X or △ Y corners to rotate, scale and shear it. Drag empty space to pan, use the wheel or a pinch to zoom, and double-click or double-tap to fit. Editing while you hold notes changes the vowel live.
- **Keys**: tracker-layout piano on <kbd>Z</kbd>–<kbd>/</kbd> and <kbd>Q</kbd>–<kbd>P</kbd>. Hover over the canvas to set the throat. <kbd>[</kbd> <kbd>]</kbd> shift octave, <kbd>Tab</kbd> switches between Play and Edit, <kbd>Esc</kbd> releases all.
- **MIDI**: notes with velocity, pitch bend ±2, CC1 breath, CC74 throat, CC64 hold.

## Panels
- **Voice**: engine selector and 44 presets:
  - Voice ×12: Sierpiński choir, Spiral reed, Barnsley fern, Twin dragon, Golden angle, Swirl growl, Spherical bell, Julia breath, Heart drone, Disc vox, Handkerchief, Pure formant
  - Bell ×6: Temple bowl, Glass marimba, Gamelan gong, Fractal chimes, Iron plate, Bowed dragon
  - Orbit ×6: Sierpiński saw, Fern string, Dragon digital, Julia organ, Swirl pad, Golden blocks
  - Cloud ×5: Golden shimmer, Fern rain, Dragon swarm, Octave stars, Fifths drift
  - String ×5: Sierpiński harp, Fern koto, Dragon piano, Golden cello, Julia e-bow
  - Pulse ×5: Sierpiński tabla, Euclid fern, Dragon machine, Golden gamelan, Swirl ratchet
  - Scan ×5: Sierpiński organ, Fern spectrum, Dragon glass, Golden chords, Heart hollow

  Each preset sets its engine's controls, not just the flame. Also morph toward any preset, *Wander* (an LFO that slowly turns the transforms, so the vowel and the flame drift), Randomize and Mutate.
- **Transforms**: up to 8. Per transform: weight, rotation (shows its formant in Hz), scale X/Y, shear, move, colour, linear amount, and two variations with amounts, from 22 flam3-style variations.
- **Throat**:
  - **Throat**: formant range; the vocal-tract length.
  - **Ring**: resonance.
  - **Body**: blends in the fixed-point pulse.
  - **Breath**: noise blown through the formants (0.5 is breathy, 1.0 a whisper).
  - **Address**: the order of transforms in each period. Cycle is clean, Pendulum and Thue–Morse create period-doubling sub-octaves, Fibonacci is quasi-periodic, Chaos order rasps.
  - **Bloom**: the tail darkens as a note fades.
  - **Stereo width**.
- **Play**: pads, root/octave/scale, snap, surface span, glide, velocity, vibrato (depth/rate/delay), ADSR, MIDI.
- **Sound**: drive, generated reverb, room size, volume, and audio quality: **High** (4× oversampling, the desktop default) or **Light** (2×, the phone default, half the CPU).
- **View**: 8 flame palettes, gamma, brightness, vibrancy, smoothing (density estimation), highlight power, relief lighting, glow, symmetry (2- to 12-fold rotation, mirror, or both — visual only, the sound is unchanged), render quality, triangles and orbits on/off, orbit glow.
- **Record**:
  - **WebM or MP4 video** of the flame, the orbits (optional) and the sound, rendered at the chosen size: match the view, 720p, 1080p, 1440p, 1080×1080 square, 1080×1920 vertical or 1080×1350 (4:5).
  - 30 or 60 fps; quality from 8 to 50 Mb/s; length "until Stop" or 10/15/30/60 s auto-stop.
  - A fixed size shows its frame on the canvas, so you compose exactly what gets recorded.
  - WebM files get their duration written into the header (Chrome leaves it out, which breaks seeking).
  - **Save image (PNG)** at the same size; lossless **WAV**; save/load patches.
- **Reset all** in the top bar puts everything back to the defaults (tap twice to confirm).

## How it works
- `engine/flame.js`: the shared core. It holds the variations, transform packing and morphing, the presets, and the voice DSP. Each transform becomes the resonator z ← p + M·(z − p) around its fixed point p, with M = S·ρR(ψ)·S⁻¹:
  - ψ comes from the rotation (formant),
  - ρ from the contraction (bandwidth),
  - S from the shape (stereo ellipse).

  Because M is a similarity of a scaled rotation, its fractional powers are exact, so every switch to the next transform lands at its exact sub-sample time with no timing jitter. Variations act as a geometric waveshaper on the linear resonator's path, with continuous per-transform weights so they never jump. polar, heart and disc are tapered at their atan2 cut in the audio path; julia follows its square-root branch continuously. The output is the pre-emphasised position of the voice, which is continuous with no steps. Voices run oversampled (4× or 2×) and a Kaiser FIR decimates them. Loudness is normalised per patch from an offline render.
- `engine/engines.js`: the Bell (parallel damped rotators per transform, with exciters), Orbit (orbit outline → DFT → band-limited mip tables → cubic playback + one-pole brightness) and Cloud (live chaos game → recursive-oscillator grains) engines. It also holds the shared offline render and loudness measurement.
- `engine/engines-more.js`: String (dual-polarisation waveguide, one allpass per transform, tuned by exact phase delay, Catmull–Rom fractional delay; sustained exciters are regenerative with level control, so they are stable at every pitch), Pulse (shared step clock → rhythm generator → pitch-dropping sine + SVF noise drums) and Scan (chaos-game density grid → swept column → recursive-oscillator partials; the picture is analysed a slice per audio block, so a moving flame never stalls the audio).
- `engine/phlox-worklet.js`: 8-voice AudioWorklet. Voice runs oversampled with FIR decimation; Bell, Orbit and Cloud are band-limited by construction and run at the base rate. Also: voice stealing, + FIR decimation, voice stealing, DC blocker, stereo width, drive, and a peak limiter that never hard-clips. Live patch edits are smoothed, so dragging triangles doesn't click. It also sends orbit trails to the UI.
- `engine/render-worker.js`: progressive chaos-game renderer that builds a log-density histogram with flame colouring in a module worker.
- `engine/render-worker.js`: the renderer, in a module worker.
  - **Accumulation:** progressive chaos-game histogram with 2× supersampling and sub-pixel jitter.
  - **Normalisation:** log-density relative to the 99.5th percentile of occupied pixels (one hot pixel no longer darkens the whole image).
  - **Symmetry:** applied by plotting each point under a random element of the rotation/dihedral group about the flame's centre of mass.
  - **Encoding:** √-encoded alpha keeps faint detail in an 8-bit texture.
- `engine/view.js`: WebGL1 display.
  - **Tone:** gamma with a linear threshold, vibrancy, and highlight power (blown colours go to white instead of clipping).
  - **Smoothing:** density estimation, so only sparse pixels get the wider kernel.
  - **Lighting:** relief from the density gradient, plus glow.
- `engine/recorder.js` + `engine/webm-duration.js`: MediaRecorder capture from an export canvas at the chosen size, PNG stills, WAV, and a small EBML patcher that writes the WebM duration.
- `engine/tabs.js`: phone layout (docked view, pill tabs).

No external dependencies; WebGL1, AudioWorklet, ES modules. Serve it over http(s) (GitHub Pages is fine). It won't run from `file://`.

## Tests
```
node tests/test-dsp.mjs
node tests/test-engines.mjs                    # String / Pulse / Scan presets at three pitches
node tests/test-webm.mjs some-recording.webm   # needs ffprobe
```
The test file covers:
- formant frequency vs triangle rotation
- formant stays fixed across pitch
- **crackle regression**: off-harmonic noise of every preset at several pitches, in High and Light mode
- every preset finite, loudness-normalised and periodic
- breath is smooth noise with no clicks
- Thue–Morse makes a sub-octave
- decimator passband and stopband
- triangle editing round-trips; morph endpoints
- the real worklet: 8-voice chords never clip, live patch edits stay smooth, CPU per block, orbit trails
- Bell partials land where the rotations predict; struck bells free their voice
- Orbit is band-limited (−84 dB or better up to 3.5 kHz), the note's fundamental is always the strongest harmonic, and the words change the timbre
- Cloud's harmonic tuning stays on the note's harmonics
- every preset of every engine is finite, loudness-matched and below clipping; CPU per engine

## Changelog
- **1.3.0**: three new engines with 15 presets. **String**: a waveguide whose pluck shape is the flame's outline and whose stiffness comes from the transforms' rotations; pluck, pick, hammer, bow and e-bow. **Pulse**: a rhythm engine; the chaos game plays tuned drums on a shared step clock, with tempo, swing and five rhythm generators. **Scan**: reads the flame picture like a spectrogram. Fixed: the preset grid showed every engine's presets instead of only the current engine's.
- **1.2.1**: Wander is fast again. It now runs on its own 30 Hz clock instead of the screen's frame rate, and trails fade by elapsed time, so the flame keeps moving at full speed even when rendering is slow. Faster display shader: empty background skips the smoothing and glow work, and glow tone-maps two averaged rings instead of 16 samples (about 2× the frame rate with default settings).
- **1.2.0**: **Reset all** button in the top bar. Better flames: supersampling, robust density normalisation, density-estimation smoothing, highlight power, relief lighting, symmetry, two new palettes. Better video export: true export resolutions with an on-canvas frame guide, 30/60 fps, bitrate presets, auto-stop, the codec actually used shown in the Record tab, WebM duration fixed, PNG stills. GoatCounter analytics snippet (privacy-friendly, no cookies).
- **1.1.1**: added the "Created with help from Claude AI" credit to the app and README.
- **1.1.0**: three new engines (Bell, Orbit, Cloud) with 17 new presets; the Voice presets now carry their own envelopes, breath, address and vibrato, so they differ from each other too. The Throat panel relabels per engine; Cloud draws grain sparks.
- **1.0.1**: crackle fix. Off-harmonic noise on steady notes dropped from about −20 dB to −67 to −84 dB:
  - transform switches at their exact sub-sample time (fractional resonator powers)
  - continuous pre-emphasised output instead of a stepped one
  - 4× oversampling + FIR decimation
  - variations moved out of the feedback loop into a waveshaper with continuous per-transform weights
  - branch-cut taming for polar/heart/disc/julia
  - breath is now noise through the formants (it used to make random jumps, which clicked)
  - a peak limiter so chords never clip
  - smoothed live edits
  - an Audio quality setting (High 4× / Light 2×)
- **1.0.0**: first release.

## License

MIT — see [LICENSE](LICENSE).

---

Created with help from Claude AI

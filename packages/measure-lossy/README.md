# @audio/measure-lossy [![npm](https://img.shields.io/npm/v/@audio/measure-lossy)](https://www.npmjs.com/package/@audio/measure-lossy) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Lossy-transcode detection — spectral-cutoff estimation + source classification (Spek / aucdtect class)

```
npm install @audio/measure-lossy
```

```js
import lossy from '@audio/measure-lossy'
```

Is this "lossless" file really a lossless master, or an upsampled/transcoded MP3, AAC, Vorbis or Opus source relabelled as WAV/FLAC? Reads the file's long-term average spectrum (Welch, via [@audio/spectral-ltas](https://github.com/audiojs/spectral)) plus a per-frame max-hold spectrum, finds where content stops (a sustained dB drop, not a notch), measures how steep that edge is, and counts the "swiss cheese" spectral holes and the MP3-specific ~16 kHz scalefactor-band notch that give away a lossy source. This is the numeric form of the manual "look at the spectrogram" method popularised by [Spek](https://www.spek.cc/) and [aucdtect](https://github.com/lifestream1/lossless-audio-checker)/"Fakin' the Funk" guessers — the same heuristics (spectrogram cutoff, sfb21 notch), just measured instead of eyeballed.

```js
let r = lossy(data, { fs: 44100 })
r.cutoff      // Hz — estimated content bandwidth
r.lossy       // boolean verdict
r.confidence  // 0..1, heuristic — not a calibrated probability
r.source      // best guess: 'mp3-128', 'opus-96', 'lossless', 'upsampled', 'unknown', …
r.evidence    // the numbers behind the verdict (see below)
r.spectrum    // { freqs, db } — the LTAS used, for plotting
```

`data` is a mono `Float32Array`, or `Float32Array[]` (one per channel — mixed down internally).

| Option | Default | |
|---|---|---|
| `fs` | `44100` | sample rate, Hz |
| `frameSize` | `4096` | Welch/STFT analysis window, samples |
| `hop` | `frameSize / 2` | frame hop, samples |
| `floorDb` | `-90` | bins at or below this level count as "empty" |
| `minDrop` | `20` | dB drop that counts as a spectral cutoff |
| `maxSeconds` | `120` | analyse at most this much, evenly sampled across the file |

`evidence`:

| Field | | |
|---|---|---|
| `cutoffDb` | `number` | dB drop from the reference band to the cutoff bin |
| `sfb21` | `boolean` | MP3's ~16 kHz scalefactor-band starvation notch, independent of the overall cutoff |
| `cutoffSharpness` | `number` | slope at the edge, dB/octave — a codec lowpass is steep (>60), a natural roll-off is gentle |
| `holes` | `number` | persistent 4-16 kHz spectral holes per second ("swiss cheese" — low-bitrate MP3 signature) |
| `upsampled` | `boolean` | cutoff sits at a clean fraction of `fs` — a sample-rate upsample, not a codec lowpass |
| `bandwidthRatio` | `number` | `cutoff / (fs / 2)` |

Method (cited in full in `lossy.js`): LTAS + max-hold spectra over the analysed span; the highest frequency where the (smoothed) LTAS drops `minDrop` dB relative to the band 2 kHz below and stays down to Nyquist is the cutoff — max-hold arbitrates, extending the estimate toward Nyquist when transients demonstrably punch past what looked like a wall, but never resetting a genuine low cutoff back up on one loud click. Spectral holes and the MP3 sfb21 notch follow Hennequin et al. ("Codec-independent lossy audio compression detection", ICASSP 2017) and Yang et al. ("Detecting MP3 compression history", 2008); the bitrate→cutoff source table is LAME's/aoTuVb's/Opus's published defaults, with citations and measured caveats in `lossy.js`.

**This method loses power above roughly 128-160 kbps** — that's a documented, known limit of spectral-cutoff detection generally (aucdtect and Spek-based "guessers" share it), not specific to this implementation: well-tuned psychoacoustic encoders at moderate-to-high bitrates can be spectrally near-transparent. It is also fooled the other way by **naturally band-limited material** — a cassette dub, a narrow-band mic, an aggressive de-esser, or plain speech (see the `audio-lena/raw` test in `test.js`) can read exactly like a lossy cutoff. `evidence` exposes every number precisely so a caller/UI can judge instead of trusting a single boolean; `confidence` is a heuristic score, not a calibrated probability.

Also exported as an `audio.js` stat manifest (`./audio` — `a.stat('lossy')`, no pre-fold needed since the kernel already accepts multichannel input).

**Use when:** verifying a purchased/downloaded "lossless" file is what it claims to be; auditing a library for mislabelled transcodes; flagging upsampled masters before mastering/distribution.

---

Part of [@audio/measure](https://github.com/audiojs/measure) — the measure family umbrella.

MIT © [audiojs](https://github.com/audiojs)

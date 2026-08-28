# @audio/measure

Try it in the browser: [Room and speaker measurement](https://audiojs.dev/util/measure/). Runs on this package, nothing is uploaded.

> Practical recording measurement — capture what your room/gear actually does.

| Package | What |
|---|---|
| `@audio/measure-ir` | ESS sweep → impulse response (Farina 2000) — feeds `reverb-convolution` + `amp-cabinet` |
| `@audio/measure-latency` | loopback round-trip latency, sample-exact via FFT cross-correlation |
| `@audio/measure-align` | multi-mic delay + polarity alignment, optional correction apply |
| `@audio/measure-response` | frequency response of a device/chain from its impulse response |
| `@audio/quality` | objective SNR/LSD/spectral-similarity metrics vs. a reference signal |
| `@audio/measure-lossy` | lossy-transcode detection — spectral cutoff, edge sharpness, spectral holes, upsampling; "is this FLAC really lossless" |
| `@audio/measure-correct` | measured response + target curve → correction EQ (Kirkeby-regularized inversion) as linear/minimum-phase FIR or parametric bands — room EQ, headphone EQ, speaker linearization |

```js
import { ir, latency, align, response, lossy, correct, snr, lsd } from '@audio/measure'
import chirp from '@audio/synth-chirp'

let sweep = chirp({ f0: 20, f1: 20000, duration: 1.5, fs })
let h = ir(recorded, { sweep, f0: 20, f1: 20000, fs, length: 1000 })       // impulse response
let { freqs, db } = response(h, { fs, n: 8192 })                          // frequency response

let lat = latency(recorded, reference, { fs })                            // { samples, seconds, confidence }
let al = align(a, b, { fs, apply: true })                                 // { delay, seconds, polarity, aligned? }

snr(clean, processed)   // dB; lsd(a, b) — log-spectral distance, dB
```

`ir(recorded, {sweep, f0=20, f1, fs=44100, length}) → Float32Array` — Farina exponential-sine-sweep deconvolution: inverse filter = time-reversed sweep with exp(−t/L) compensation, distortion products land at negative time and are trimmed. Self-deconvolution calibrated so an identity system yields δ = 1.0.

`latency(recorded, reference, {fs=44100}) → {samples, seconds, confidence}` — FFT cross-correlation peak.

`align(a, b, {fs=44100, apply=false}) → {delay, seconds, polarity: 1|-1, aligned?}` — signed cross-correlation peak gives delay + polarity of `b` relative to `a`; `apply: true` shifts/flips `b`.

`response(ir, {fs=44100, n=8192}) → {freqs, db}` — zero-padded FFT magnitude.

`lossy(data, {fs=44100}) → {cutoff, lossy, confidence, source, evidence, spectrum}` — spectral-cutoff + spectral-hole + upsampling evidence that a "lossless" file went through MP3/AAC/Vorbis/Opus; naturally band-limited recordings are reported with the numbers so a UI can show why (see `packages/measure-lossy`).

`await correct(measured, {fs, target='flat', fMin=20, fMax=20000, smoothOct=1/6, maxBoost=6, maxCut=20, regularization=0.1, mode='fir'|'parametric'|'both', taps=4095, minPhase=false}) → {correction, coefs?, bands?, preamp?, residual, rms}` — `measured` is an IR, a `{freqs, db}` response or `[{f, gain}]` points; `target` a `@audio/spectral-target` preset, points, or function (a Harman headphone target, say). FIR via `@audio/eq-fir`, parametric via `@audio/eq-fit`; `toWavIr()` exports the FIR for convolution hosts, `toEqualizerApo()` the bands (see `packages/measure-correct`).

`@audio/quality` exports `snr`, `segSnr`, `lsd`, `spectralSim`, `nrr`, `speechAttenuation`, `goertzelEnergy`, `chordBalance`, `chordRetention`, `modulationDepth` — reference-vs-output metrics for evaluating denoisers, stretchers, codecs, resamplers (see `packages/quality/README.md`). The Goertzel-family functions (`goertzelEnergy` etc.) take a positional sample rate.

Sweep generation = `@audio/synth-chirp`; deconvolution = inverse-sweep convolution via `fourier-transform` FFT. The practical-VST/recording surface: measure once, convolve forever.

# @audio/measure

> Practical recording measurement — capture what your room/gear actually does.

| Package | What |
|---|---|
| `@audio/measure-ir` | ESS sweep → impulse response (Farina 2000) — feeds `reverb-convolution` + `amp-cabinet` |
| `@audio/measure-latency` | loopback round-trip latency, sample-exact via FFT cross-correlation |
| `@audio/measure-align` | multi-mic delay + polarity alignment, optional correction apply |
| `@audio/measure-response` | frequency response of a device/chain from its impulse response |
| `@audio/quality` | objective SNR/LSD/spectral-similarity metrics vs. a reference signal |

```js
import { ir, latency, align, response, snr, lsd } from '@audio/measure'
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

`@audio/quality` exports `snr`, `segSnr`, `lsd`, `spectralSim`, `nrr`, `speechAttenuation`, `goertzelEnergy`, `chordBalance`, `chordRetention`, `modulationDepth` — reference-vs-output metrics for evaluating denoisers, stretchers, codecs, resamplers (see `packages/quality/README.md`). The Goertzel-family functions (`goertzelEnergy` etc.) take a positional sample rate.

Sweep generation = `@audio/synth-chirp`; deconvolution = inverse-sweep convolution via `fourier-transform` FFT. The practical-VST/recording surface: measure once, convolve forever.

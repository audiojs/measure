# @audio/measure-ir [![npm](https://img.shields.io/npm/v/@audio/measure-ir)](https://www.npmjs.com/package/@audio/measure-ir) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Impulse-response capture — exponential sine sweep deconvolution (Farina 2000), self-calibrated

```
npm install @audio/measure-ir
```

```js
import ir from '@audio/measure-ir'
```

Farina exponential-sine-sweep (ESS) deconvolution: the inverse filter is the time-reversed sweep with `exp(−t/L)` amplitude compensation for the sweep's 1/f energy density. Convolving the recording with it collapses the sweep to an impulse at t=0; harmonic distortion products land at negative time and are trimmed away — the ESS advantage over linear sweeps or MLS. Self-deconvolution of the sweep against its own inverse filter calibrates the output so an identity system (recorded === sweep) yields δ = 1.0.

> Farina, A. — *Simultaneous Measurement of Impulse Response and Distortion with a Swept-Sine Technique*, AES 108th Convention, 2000.

```js
let h = ir(recorded, { sweep, f0: 20, f1: 20000, fs, length: 1000 })
```

| Param | Default | |
|---|---|---|
| `sweep` | — | required — the exponential sine sweep that was played (`Float32Array`) |
| `f0` | `20` | sweep start frequency, Hz |
| `f1` | `fs/2 * 0.95` | sweep end frequency, Hz |
| `fs` | `44100` | sample rate |
| `length` | `recorded.length - sweep.length + 1` | samples of IR to return |

Returns a `Float32Array`: the impulse response, direct path at index 0, calibrated to unit gain. Throws `RangeError` if `opts.sweep` is omitted.

Also exports `convFFT(a, b)` (zero-padded FFT convolution) and `inverseSweep(sweep, {f0, f1, fs})` — the building blocks `@audio/measure-align` and `@audio/measure-latency` reuse for their own cross-correlation.

**Use when:** capturing the impulse response of a room, cabinet, or signal chain from a recorded exponential sweep — feeds `@audio/reverb-convolution` and `@audio/amp-cabinet`.

---

Part of [@audio/measure](https://github.com/audiojs/measure) — the measure family umbrella.

MIT © [audiojs](https://github.com/audiojs)

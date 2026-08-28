# @audio/measure-correct [![npm](https://img.shields.io/npm/v/@audio/measure-correct)](https://www.npmjs.com/package/@audio/measure-correct) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Response correction design — measured response + target curve → FIR and/or parametric correction EQ

```
npm install @audio/measure-correct
```

```js
import correct from '@audio/measure-correct'
```

Room/headphone/speaker linearization, REW/Dirac/Acourate class: given a measured response (an impulse response, a `{freqs, db}` curve, or `{f, gain}` points) and a target curve, designs a correction EQ that flattens the difference. The measured curve is fractional-octave smoothed, level-aligned to the target, then inverted with Kirkeby-regularized deviation (`correction = dev·|H|²/(|H|²+λ)` in linear magnitude — a deep null in the measured response gets rolled off toward 0 rather than boosted to cancel it, since a literal 1/H inverse blows up exactly where H is small) and clamped to boost/cut limits, tapering to 0 dB outside `[fMin, fMax]`. The correction renders as a linear-phase (or minimum-phase) FIR via [`@audio/eq-fir`](https://github.com/audiojs/eq/tree/main/packages/eq-fir)'s frequency-sampling design and/or as parametric bands via [`@audio/eq-fit`](https://github.com/audiojs/eq/tree/main/packages/eq-fit)'s Levenberg-Marquardt fit.

> Kirkeby, O. & Nelson, P.A. — *Digital Filter Design for Inversion Problems in Sound Reproduction*, J. Audio Eng. Soc. 47(7/8):583–595, 1999.
> Oppenheim, A.V. & Schafer, R.W. — *Discrete-Time Signal Processing*, 3rd ed., §12 (Homomorphic Filtering) — minimum-phase reconstruction from a magnitude spectrum via real-cepstrum folding.
> Precedents: REW ([Room EQ Wizard](https://www.roomeqwizard.com/)), [Dirac Live](https://www.dirac.com/), [Acourate](https://www.acourate.com/) — commercial/reference room-correction tools this module's shape follows (target curve, smoothing, boost/cut limits, band edges, min-phase option).
> Olive, S., Welti, T. & McMullin, E. — *A Statistical Model that Predicts Listeners' Preference Ratings of In-Room Loudspeaker Response*, AES 135th Convention, 2013 — the Harman target curve, one shape for `opts.target`'s `{freqs, db}` form.

```js
let ir = /* Float32Array impulse response from @audio/measure-ir */
let result = await correct(ir, { fs: 48000, target: 'flat', mode: 'fir' })
// result.coefs — Float64Array, linear-phase FIR, ready for @audio/eq-fir's firEq

import { apply } from '@audio/measure-correct'
await apply(myBuffer, result, { fs: 48000 })   // firEq(coefs) or eq-parametric(bands+preamp)
```

```js
// parametric — a real EQ's band list, plus an Equalizer APO export
let result = await correct(ir, { fs: 48000, target: 'flat', mode: 'parametric', bands: 8 })
let apo = await toEqualizerApo(result)   // 'Preamp: -5.0 dB\nFilter 1: ON PK Fc 80 Hz Gain -6.0 dB Q 3.82\n...'
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate, Hz |
| `target` | `'flat'` | `'flat'` \| `'speech'`\|`'music'`\|`'pink'`\|`'voice-music'` ([`@audio/spectral-target`](https://github.com/audiojs/spectral/tree/main/packages/spectral-target) presets) \| `{f, gain}[]` \| `f => dB` \| `{freqs, db}` |
| `fMin` / `fMax` | `20` / `20000` | Correction band, Hz — outside it, correction tapers to 0 dB over 1/3 octave |
| `smoothOct` | `1/6` | Fractional-octave smoothing of the measured curve. REW's own default for room EQ; use `1/12` for headphones |
| `maxBoost` / `maxCut` | `6` / `20` | Correction limits, dB |
| `regularization` | `0.1` | Kirkeby λ — 0 disables regularization (naive `target − measured` inversion) |
| `level` | `'auto'` | `'auto'` mean-matches the measured curve to the target's in-band level; a number is a fixed dB offset added to the measured curve instead |
| `mode` | `'fir'` | `'fir'` \| `'parametric'` \| `'both'` |
| `taps` | `4095` | FIR length (forced odd) |
| `bands` | `10` | Max parametric band count |
| `minPhase` | `false` | Convert the FIR to minimum phase (real-cepstrum folding) — same magnitude, near-zero group delay instead of `(taps−1)/2` samples |

Returns `{ freqs, measured, target, correction, coefs?, bands?, preamp?, residual, rms, maxBoost }` — see `index.d.ts` for the full shape. `measured` is the smoothed-and-level-aligned curve the correction was computed against; `residual` is `target − (measured + realized correction)`, predicted from the actual FIR (its own FFT magnitude) or parametric cascade ([`@audio/eq-fit`](https://github.com/audiojs/eq/tree/main/packages/eq-fit)'s `response()`, preamp excluded — preamp is a broadband headroom offset, not part of the corrected shape, matching `eq-fit`'s own `error` convention).

`correct()`, `apply()`, `toEqualizerApo()` and `toWavIr()` are all **async**: `mode: 'parametric'` dynamically imports `@audio/eq-fit` (an optional peer — install it to unlock parametric/both modes; `mode: 'fir'` never needs it and works standalone), and `apply()`/`toWavIr()` dynamically import `@audio/eq-fir`/`@audio/eq-parametric`/`@audio/encode-wav` only for the branch actually used.

Working math happens on an internal log-spaced grid (96 points/octave, ~10 Hz to Nyquist) rather than the linear FFT-bin grid `@audio/spectral-target`'s `smooth()`/`deviation()` use — a linear bin grid is too coarse in octave terms at low frequency (at 40 Hz, `n=8192`, `fs=48000`: ~4 bins/octave, too coarse for a clean 1/6-oct average) to resolve fractional-octave smoothing down to the bottom of the room-EQ or headphone-EQ band. `deviation()` is superseded (not reused) for this reason; `target − measured` and the taper-to-zero-at-the-band-edge shape are carried over from it, and its `target()` presets are reused directly for named `opts.target` values.

A deep, narrow (high-Q) dip is *not* fully flattened by design — regularization exists specifically to prevent the enormous, narrow-band boost that would take, since that boost doesn't generalize across a room's listening positions (matched by REW's and every serious room-correction tool's own advice against fully undoing narrow nulls). `maxBoost`/`maxCut` are hard limits regardless; `regularization` softens how much of the theoretical inverse gets used before those limits even apply.

**Use when:** designing a room, headphone, or speaker correction EQ from a captured measurement — feeds `@audio/eq-fir`'s `firEq`/`@audio/eq-parametric` for real-time application, or `toWavIr()`'s convolution-EQ WAV for Equalizer APO / Roon / CamillaDSP.

---

Part of [@audio/measure](https://github.com/audiojs/measure) — the measure family umbrella.

MIT © [audiojs](https://github.com/audiojs)

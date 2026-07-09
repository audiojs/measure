# @audio/quality

> Objective audio quality metrics — how close is the processed signal to the reference?

Reference-vs-output comparison for evaluating denoisers, stretchers, codecs, resamplers. Deterministic, no model weights.

```js
import { snr, segSnr, lsd, spectralSim, modulationDepth } from '@audio/quality'

snr(clean, processed)                   // global SNR, dB
segSnr(clean, processed)                // frame-averaged, PESQ-style clamp
lsd(a, b, { trim: 0.1 })                // log-spectral distance, dB — ~1 transparent, >5 degraded
spectralSim(a, b)                       // cosine similarity of magnitude spectra, 1 = identical
modulationDepth(out, [220, 440], 44100) // per-partial hop-rate beating ("crumble")
```

| fn | measures | notes |
|---|---|---|
| `snr(clean, out)` | global SNR (dB) | time-aligned inputs |
| `segSnr(clean, out, opts?)` | segmental SNR (dB) | per-frame, [-10, 35] clamp, silence-skipped |
| `lsd(a, b, opts?)` | log-spectral distance (dB) | `trim` crops edge artifacts (default 0) |
| `spectralSim(a, b, opts?)` | spectral cosine similarity | alignment-free |
| `nrr(noisy, out, from?, to?)` | noise-floor drop (dB) | pass a quiet-segment range |
| `speechAttenuation(clean, out, from?, to?)` | speech-energy loss (dB) | should be ≈0 |
| `goertzelEnergy(data, f, sr)` | single-frequency energy | Goertzel, 20% edge trim |
| `chordBalance(data, freqs, sr)` | min/max partial ratio | 1 = balanced |
| `chordRetention(data, ref, freqs, sr)` | chord energy kept | 1 = no loss |
| `modulationDepth(data, freqs, sr, opts?)` | AM depth per partial | catches tremolo LSD misses |

Consolidated from the [denoise](https://github.com/audiojs/denoise) and [stretch](https://github.com/audiojs/stretch) families' evaluation suites. FFT via [fourier-transform](https://github.com/scijs/fourier-transform). MIT.

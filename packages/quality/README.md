# @audio/quality

> Objective audio quality metrics — how close is the processed signal to the reference?

Reference-vs-output comparison for evaluating denoisers, stretchers, codecs, resamplers. Deterministic, no model weights.

```js
import { snr, segSnr, lsd, spectralSim, modulationDepth, stoi, estoi } from '@audio/quality'

snr(clean, processed)                   // global SNR, dB
segSnr(clean, processed)                // frame-averaged, PESQ-style clamp
lsd(a, b, { trim: 0.1 })                // log-spectral distance, dB — ~1 transparent, >5 degraded
spectralSim(a, b)                       // cosine similarity of magnitude spectra, 1 = identical
modulationDepth(out, [220, 440], 44100) // per-partial hop-rate beating ("crumble")
stoi(clean, processed, 16000)           // speech intelligibility, about 0 to 1; estoi for noise that comes and goes
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
| `stoi(clean, out, fs)` | speech intelligibility, about 0 to 1 | STOI; speech only, time-aligned, equal lengths |
| `estoi(clean, out, fs)` | speech intelligibility, about 0 to 1 | ESTOI; holds for a masker that comes and goes |

`stoi` and `estoi` rise with the share of words a listener gets right, but are not that share: how one maps to the other depends on the test. Speech only, the two signals time-aligned (384 ms envelopes are compared frame by frame), at any integer `fs` (resampled to the measure's 10 kHz). STOI ([Taal et al. 2011](https://doi.org/10.1109/TASL.2011.2114881)) takes the bands as independent; ESTOI ([Jensen, Taal 2016](https://doi.org/10.1109/TASLP.2016.2585878)) correlates whole spectra, so it holds under another talker or modulated noise, where STOI can rank conditions in reverse. Correlation with listening tests, each after a fitted monotone map: STOI 0.92 to 0.96 in its paper's three tests, ESTOI 0.89 to 0.98 in its paper's five; over 13 data sets from ten published tests, a few of them used to build the two, 0.80 and 0.86 on average and 0.35 and 0.43 for speech in strong reverberation ([van Kuyk et al.](https://arxiv.org/abs/1708.06027)). NaN when under about 0.4 s of speech is left or `clean` is silent; unequal lengths, several channels or a non-integer rate throw.

Consolidated from the [denoise](https://github.com/audiojs/denoise) and [stretch](https://github.com/audiojs/stretch) families' evaluation suites. FFT via [fourier-transform](https://github.com/scijs/fourier-transform). STOI and ESTOI ported from [pystoi](https://github.com/mpariente/pystoi) 0.4.1 (Manuel Pariente, MIT), resampler and silent-frame removal included, and held to it to 1e-9. MIT.

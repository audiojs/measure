# @audio/quality

> Objective audio quality metrics — how close is the processed signal to the reference?

Reference-vs-output comparison for evaluating denoisers, stretchers, codecs, resamplers. Deterministic, no model weights.

```js
import { snr, segSnr, lsd, spectralSim, modulationDepth, stoi, estoi, twof } from '@audio/quality'

snr(clean, processed)                   // global SNR, dB
segSnr(clean, processed)                // frame-averaged, PESQ-style clamp
lsd(a, b, { trim: 0.1 })                // log-spectral distance, dB — ~1 transparent, >5 degraded
spectralSim(a, b)                       // cosine similarity of magnitude spectra, 1 = identical
modulationDepth(out, [220, 440], 44100) // per-partial hop-rate beating ("crumble")
stoi(clean, processed, 16000)           // speech intelligibility, about 0 to 1; estoi for noise that comes and goes
twof(original, processed, 48000)        // perceived quality, a MUSHRA-like score: 100 as the original, 0 bad
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
| `twof(ref, out, fs)` | perceived quality, 0 to 100 | the 2f-model; music and other sound, time-aligned, equal lengths, levels matched |

`stoi` and `estoi` rise with the share of words a listener gets right, but are not that share: how one maps to the other depends on the test. Speech only, the two signals time-aligned (384 ms envelopes are compared frame by frame), at any integer `fs` (resampled to the measure's 10 kHz). STOI ([Taal et al. 2011](https://doi.org/10.1109/TASL.2011.2114881)) takes the bands as independent; ESTOI ([Jensen, Taal 2016](https://doi.org/10.1109/TASLP.2016.2585878)) correlates whole spectra, so it holds under another talker or modulated noise, where STOI can rank conditions in reverse. Correlation with listening tests, each after a fitted monotone map: STOI 0.92 to 0.96 in its paper's three tests, ESTOI 0.89 to 0.98 in its paper's five; over 13 data sets from ten published tests, a few of them used to build the two, 0.80 and 0.86 on average and 0.35 and 0.43 for speech in strong reverberation ([van Kuyk et al.](https://arxiv.org/abs/1708.06027)). NaN when under about 0.4 s of speech is left or `clean` is silent; unequal lengths, several channels or a non-integer rate throw.

`twof` is the 2f-model ([Kastner and Herre 2019](https://doi.org/10.1109/WASPAA.2019.8937179)): an estimate of the score listeners give in a MUSHRA test, 100 for a signal they cannot tell from the reference, from two measures of the ear model of ITU-R BS.1387 (how the envelopes' modulation changed, and how far the difference rises over what is just heard). In a review of objective measures against listening tests over audio coding and source separation ([Torcoli, Kastner and Herre 2021](https://doi.org/10.1109/TASLP.2021.3069302)) it followed the listeners closest of those compared. It was fitted to listening tests of separated sources; for how well speech is understood, use `stoi`. It hears levels (the same sound 6 dB quieter scores about 43: match the levels first), needs the two signals time-aligned, and reads full scale as 92 dB SPL. Any integer `fs` (resampled to the model's 48 kHz); float samples are taken as they are, not rounded to 16 bits as a WAV file would hold them. An MP3 (LAME) of a film scene with music scores 100 at 128 kbps, 99.7 at 64 and 64 at 32; of a sung phrase 100, 83 and 60.

The two measures are written from the equations of [Kabal's report](https://www.mmsp.ece.mcgill.ca/Documents/Reports/2002/KabalR2002v2.pdf) on BS.1387 and equal his PQevalAudio's, which the model's constants were fitted to, within 1e-9 on 45 pairs. That includes four band edges where PQevalAudio's table differs from the Recommendation's; with the Recommendation's values the score moves by 0.1 at most on those pairs. PQevalAudio hears 48 kHz only: sound at another rate is resampled first, and against PQevalAudio after MATLAB's `resample` (as the declipping survey fed it at 44.1 kHz) the score differs by at most 0.23 of 100 at 44.1 kHz, 0.26 at 16 kHz and 0.02 at 96 kHz on those pairs. CI makes the reference values again from pystoi and from the port of PQevalAudio on every push.

Consolidated from the [denoise](https://github.com/audiojs/denoise) and [stretch](https://github.com/audiojs/stretch) families' evaluation suites. FFT via [fourier-transform](https://github.com/scijs/fourier-transform). STOI and ESTOI ported from [pystoi](https://github.com/mpariente/pystoi) 0.4.1 (Manuel Pariente, MIT), resampler and silent-frame removal included, and held to it to 1e-9; `twof` resamples by the same filter. MIT.

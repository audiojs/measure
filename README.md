# @audio/measure

> Practical recording measurement — capture what your room/gear actually does. All planned.

| Package | What |
|---|---|
| `@audio/measure-ir` | ESS sweep → impulse response (Farina 2000) — feeds `reverb-convolution` + `amp-cabinet` |
| `@audio/measure-response` | frequency response of a device/chain |
| `@audio/measure-latency` | loopback round-trip latency |

Sweep generation = `@audio/synth-chirp`; deconvolution = inverse-sweep convolution (`eq-fir`/FFT machinery exists). The practical-VST/recording surface: measure once, convolve forever.

# @audio/measure-response [![npm](https://img.shields.io/npm/v/@audio/measure-response)](https://www.npmjs.com/package/@audio/measure-response) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Frequency response from an impulse response — zero-padded FFT magnitude

```
npm install @audio/measure-response
```

```js
import response from '@audio/measure-response'
```

Zero-pads the impulse response to `n` samples and takes its FFT magnitude in dB — the frequency response of whatever produced the IR. Pair with `@audio/measure-ir`: sweep the device, deconvolve to an IR, read the response.

```js
let { freqs, db } = response(h, { fs, n: 8192 })
```

| Param | Default | |
|---|---|---|
| `ir` | — | impulse response (`Float32Array`) |
| `fs` | `44100` | sample rate |
| `n` | `8192` | FFT size; doubled up to the next power of 2 ≥ `ir.length` |

Returns:

| Field | | |
|---|---|---|
| `freqs` | `Float32Array` | bin center frequencies, Hz — length `n/2 + 1` |
| `db` | `Float32Array` | magnitude, dB |

**Use when:** reading the frequency response of a room, cabinet, or chain after IR capture — EQ matching, cabinet comparison, room-mode inspection.

---

Part of [@audio/measure](https://github.com/audiojs/measure) — the measure family umbrella.

MIT © [audiojs](https://github.com/audiojs)

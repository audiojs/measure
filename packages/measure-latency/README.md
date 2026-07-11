# @audio/measure-latency [![npm](https://img.shields.io/npm/v/@audio/measure-latency)](https://www.npmjs.com/package/@audio/measure-latency) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Round-trip latency — FFT cross-correlation peak between reference and loopback

```
npm install @audio/measure-latency
```

```js
import latency from '@audio/measure-latency'
```

Plays a reference signal, records the loopback, and locates the cross-correlation peak between them via FFT — a single play-record pass gives sample-exact round-trip delay (driver + interface + cable).

```js
let { samples, seconds, confidence } = latency(recorded, reference, { fs })
```

| Param | Default | |
|---|---|---|
| `recorded` | — | the loopback recording (`Float32Array`) |
| `reference` | — | the signal that was played (`Float32Array`) |
| `fs` | `44100` | sample rate |

Returns:

| Field | | |
|---|---|---|
| `samples` | `number` | round-trip delay of `recorded` relative to `reference`, in samples |
| `seconds` | `number` | `samples / fs` |
| `confidence` | `number` | cross-correlation peak sharpness — peak magnitude over mean magnitude; higher means a more reliable peak |

**Use when:** calibrating a play-record loopback for latency compensation before other timing-sensitive measurements (IR capture, alignment).

---

Part of [@audio/measure](https://github.com/audiojs/measure) — the measure family umbrella.

MIT © [audiojs](https://github.com/audiojs)

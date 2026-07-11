# @audio/measure-align [![npm](https://img.shields.io/npm/v/@audio/measure-align)](https://www.npmjs.com/package/@audio/measure-align) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Multi-mic phase/time alignment — signed cross-correlation delay + polarity (Auto-Align class)

```
npm install @audio/measure-align
```

```js
import align from '@audio/measure-align'
```

Signed cross-correlation peak between two channels gives the delay and polarity of `b` relative to `a`; pass `apply: true` to also get `b` shifted into alignment and polarity-corrected.

```js
align(a, b, { fs })                       // { delay, seconds, polarity }
align(a, b, { fs, apply: true })           // + { aligned }
```

| Param | Default | |
|---|---|---|
| `a` | — | reference channel (`Float32Array`) |
| `b` | — | channel to align (`Float32Array`) |
| `fs` | `44100` | sample rate |
| `apply` | `false` | when `true`, also return `aligned`: `b` shifted by `delay` and polarity-flipped |

Returns:

| Field | | |
|---|---|---|
| `delay` | `number` | samples `b` lags `a` (signed) |
| `seconds` | `number` | `delay / fs` |
| `polarity` | `1 \| -1` | polarity of `b` relative to `a` |
| `aligned?` | `Float32Array` | present only when `apply: true` |

**Use when:** multi-mic recordings (drum overheads, DI + amp blend, room + close mics) need per-channel delay and polarity correction before summing — comb-filtering from misaligned mics is inaudible per-track and destructive on sum.

---

Part of [@audio/measure](https://github.com/audiojs/measure) — the measure family umbrella.

MIT © [audiojs](https://github.com/audiojs)

// Music-like signals made from seeds for the twof test: no recorded audio, the same samples on every run, at 48 kHz
// and on 16-bit steps, so a 16-bit WAV file holds them exactly.
// Run as a script, it writes each case's pair as 16-bit WAV, from which pqevalaudio.py makes pqevalaudio.json:
//   node packages/quality/test/music.js <dir> && python packages/quality/test/pqevalaudio.py <dir> <audio>/bench/rx > packages/quality/test/pqevalaudio.json
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rng } from './speech.js'

export const FS = 48000
const PI2 = 2 * Math.PI

/** `dur` s of notes: harmonic tones a semitone apart over three octaves from 110 Hz, each with an attack of 8 ms and a
 *  decay of its own, over a floor of noise 63 dB under the peak; the peak at 0.7 */
export function music(dur, seed) {
  let r = rng(seed), n = Math.round(dur * FS), x = new Float64Array(n)
  for (let t0 = 0; t0 < n;) {
    let len = Math.round((0.15 + 0.5 * r()) * FS), f = 110 * 2 ** (Math.floor(r() * 36) / 12), amp = 0.05 + 0.2 * r(), bright = 0.4 + 0.5 * r()
    for (let i = 0; i < len * 1.5 && t0 + i < n; i++) {
      let t = i / FS, v = 0
      for (let h = 1; h <= 12 && f * h < 20000; h++) v += bright ** (h - 1) * Math.sin(PI2 * f * h * t)
      x[t0 + i] += amp * Math.min(1, t / 0.008) * Math.exp(-3 * t * FS / len) * v
    }
    t0 += len
  }
  for (let i = 0; i < n; i++) x[i] += 0.0005 * (2 * r() - 1)
  let peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  return x.map(v => 0.7 * v / peak)
}

const power = x => x.reduce((s, v) => s + v * v, 0) / x.length
const white = (n, seed, amp) => { let r = rng(seed); return Float64Array.from({ length: n }, () => amp * (2 * r() - 1)) }
const DAMAGE = {
  same: x => x,
  // white noise `by` dB under the music
  noise: (x, by) => { let w = white(x.length, 100 + by, 1), g = Math.sqrt(power(x) / power(w) * 10 ** (-by / 10)); return x.map((v, i) => v + g * w[i]) },
  // two one-pole lowpasses at `by` Hz
  lowpass: (x, by) => { let a = Math.exp(-PI2 * by / FS), s = 0, s2 = 0; return x.map(v => { s = a * s + (1 - a) * v; return s2 = a * s2 + (1 - a) * s }) },
  clip: (x, by) => x.map(v => Math.max(-by, Math.min(by, v))),
  // a gain that wanders every 20 ms between 1 and 1 - `by`: what a spectral gate's "musical noise" does to a level
  gated: (x, by) => { let r = rng(9), g0 = 1, g1 = 1, B = 960; return x.map((v, i) => { if (i % B === 0) { g0 = g1; g1 = 1 - by * r() } return v * (g0 + (g1 - g0) * (i % B) / B) }) },
  tremolo: (x, by) => x.map((v, i) => v * (1 - 0.25 * (1 + Math.sin(PI2 * by * i / FS)))),
  gain: (x, by) => x.map(v => v * 10 ** (by / 20)),
}

// two pieces, each damaged every way; then one piece that starts and stops at full level, behind `lead` and before
// `tail` samples of silence, noise over the whole file: the leads put its first sample, and the tails its last, on
// either side of a frame's edge (1024 samples), where the frames counted change; and the piece rising from, or
// falling to, silence over 4 s, where the level that counts as data decides them
const KINDS = [['same'], ['noise', 50], ['noise', 30], ['noise', 10], ['lowpass', 8000], ['lowpass', 1000], ['clip', 0.5], ['clip', 0.1], ['gated', 0.4], ['tremolo', 6], ['gain', -6]]
const LEADS = [0, 300, 5119, 5120, 5121, 5122, 5123, 5124, 5125, 5126, 24100, 30000, 48000]
const ENDS = [[827, 3000], [828, 3000], [829, 3000], [830, 3000], [831, 3000], [0, 300], [0, 5000], [20000, 20000]]
export const CASES = [
  ...[['a', 5, 1], ['b', 4, 7]].flatMap(([piece, dur, seed]) => KINDS.map(([how, by]) => ({ name: `${piece}-${how}${by ?? ''}`, dur, seed, how, by }))),
  ...LEADS.map(lead => ({ name: `lead${lead}`, lead, tail: 0 })),
  ...ENDS.map(([lead, tail]) => ({ name: `lead${lead}-tail${tail}`, lead, tail })),
  // behind 300 samples: the level that counts (200 of 32768 over five samples) is reached in another frame than half of it would be
  { name: 'fade-in', lead: 300, tail: 0, fade: 1 }, { name: 'fade-out', lead: 300, tail: 0, fade: -1 },
]

const steps = x => Float32Array.from(x, v => Math.floor(v * 32768) / 32768)

/** A case's pair, { ref, out }: Float32Arrays at 48 kHz */
export function pair({ dur, seed, how, by, lead, tail, fade }) {
  if (how) { let x = music(dur, seed); return { ref: steps(x), out: steps(DAMAGE[how](x, by)) } }
  // music over a steady 1 kHz tone, so its first and last samples are loud: 2.5 s of it, or 5 s with the fade
  let x = music(fade ? 5 : 2.5, 3).map((v, i) => 0.6 * v + 0.2 * Math.cos(PI2 * 1000 * i / FS)), ref = new Float64Array(lead + x.length + tail)
  if (fade) x = x.map((v, i) => v * Math.min(1, (fade > 0 ? i : x.length - 1 - i) / (4 * FS)))
  ref.set(x, lead)
  let w = white(ref.length, 200 + lead + tail + (fade ?? 0), 0.02)
  return { ref: steps(ref), out: steps(ref.map((v, i) => v + w[i])) }
}

// 16-bit mono PCM WAV
function wav(x) {
  let b = Buffer.alloc(44 + 2 * x.length)
  b.write('RIFF', 0); b.writeUInt32LE(36 + 2 * x.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(FS, 24); b.writeUInt32LE(2 * FS, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(2 * x.length, 40)
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768))), 44 + 2 * i)
  return b
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let dir = process.argv[2]
  if (!dir) throw new Error('music.js <dir>: where to write the pairs')
  mkdirSync(dir, { recursive: true })
  for (let c of CASES) { let { ref, out } = pair(c); writeFileSync(`${dir}/${c.name}.ref.wav`, wav(ref)); writeFileSync(`${dir}/${c.name}.out.wav`, wav(out)) }
  console.error(`${CASES.length} pairs in ${dir}`)
}

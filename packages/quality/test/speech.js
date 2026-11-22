// Speech-like signals made from seeds for the stoi and estoi tests: no recorded audio, the same samples on every run.
// Run as a script, it writes each case's pair as 32-bit float WAV, from which pystoi-values.py makes pystoi.json:
//   node packages/quality/test/speech.js <dir> && python packages/quality/test/pystoi-values.py <dir> > packages/quality/test/pystoi.json
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fft, ifft } from 'fourier-transform'

const PI2 = 2 * Math.PI

// mulberry32: 32 bits of state, the same sequence in every engine
export function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const gauss = r => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(PI2 * r()) }

// vowels' first three formants, Hz: men's means in Peterson and Barney (1952)
const VOWELS = [[270, 2290, 3010], [390, 1990, 2550], [530, 1840, 2480], [660, 1720, 2410], [730, 1090, 2440], [570, 840, 2410], [440, 1020, 2240], [300, 870, 2240], [640, 1190, 2390]]

/** A talker, `dur` s at `fs` Hz: words of one or two syllables, each 0 to 45 dB down (the 40 dB of silence STOI drops falls
 *  within them), parted by pauses, at least a quarter second of silence at each end */
export function talker(fs, dur, seed) {
  let r = rng(seed), x = new Float64Array(Math.round(dur * fs)), t = Math.round(0.25 * fs), f0 = 90 + 120 * r()
  while (t < x.length - 0.95 * fs) {
    let g = 10 ** (-45 * r() / 20)
    for (let k = 1 + Math.floor(2 * r()); k > 0; k--) t = syllable(x, t, fs, g, f0 * (0.85 + 0.3 * r()), VOWELS[Math.floor(r() * VOWELS.length)], r)
    t += Math.round((0.05 + 0.25 * r()) * fs)
  }
  let peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  return x.map(v => 0.5 * v / peak)
}

// at gain g: half the time a fricative (noise's first difference, 30 to 90 ms), then a vowel (a glottal pulse train,
// its pitch falling a tenth, through three formant resonators, 90 to 240 ms), each under a sine envelope
function syllable(x, t, fs, g, f0, formants, r) {
  if (r() < 0.5) {
    let n = Math.round((0.03 + 0.06 * r()) * fs), w = 0
    for (let i = 0; i < n; i++) { let v = gauss(r); x[t + i] += 0.3 * g * (v - w) * Math.sin(Math.PI * i / n); w = v }
    t += n
  }
  let n = Math.round((0.09 + 0.15 * r()) * fs), e = new Float64Array(n)
  for (let i = 0, next = 0; i < n; i++) if (i >= next) { e[i] = 1; next += fs / (f0 * (1 - 0.1 * i / n)) }
  formants.forEach((f, k) => resonate(e, f, 60 + 30 * k, fs))
  for (let i = 0; i < n; i++) x[t + i] += g * e[i] * Math.sin(Math.PI * i / n) ** 2
  return t + n
}

// a two-pole resonator at f Hz, bandwidth bw Hz, unit gain at 0 Hz (Klatt 1980), in place
function resonate(x, f, bw, fs) {
  let c = -Math.exp(-PI2 * bw / fs), b = 2 * Math.exp(-Math.PI * bw / fs) * Math.cos(PI2 * f / fs), a = 1 - b - c, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) { let y = a * x[i] + b * y1 + c * y2; y2 = y1; y1 = y; x[i] = y }
}

const power = x => x.reduce((s, v) => s + v * v, 0) / x.length
const white = (n, seed) => { let r = rng(seed); return Float64Array.from({ length: n }, () => gauss(r)) }
// four other talkers at once
const babble = (fs, dur) => [11, 12, 13, 14].map(s => talker(fs, dur, s)).reduce((a, b) => a.map((v, i) => v + b[i]))
// noise with a falling spectrum (white through a pole at 0.9), its level swung fully on and off 4 times a second
function modulated(n, fs, seed) {
  let w = white(n, seed), y = 0
  return w.map((v, i) => (y = 0.9 * y + v) * (1 + Math.sin(PI2 * 4 * i / fs)))
}
// clean with noise under it at snr dB, by the whole signals' power
const mix = (s, noise, snr) => { let g = Math.sqrt(power(s) / power(noise) * 10 ** (-snr / 10)); return s.map((v, i) => v + g * noise[i]) }

// a fourth-order Butterworth lowpass at f Hz: two biquads (RBJ cookbook), Q 0.5412 and 1.3066
function lowpass(x, f, fs) {
  let y = Float64Array.from(x)
  for (let q of [0.5412, 1.3066]) {
    let w = PI2 * f / fs, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al
    let b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0, x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < y.length; i++) { let v = y[i], o = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o }
  }
  return y
}

// power spectral subtraction with the noise's own mean spectrum, twice over, kept no lower than -20 dB: the gated
// bins and musical noise a simple denoiser leaves; 32 ms frames, half overlapped, periodic Hann (it sums to one)
function subtract(x, noise, fs) {
  let N = 2 ** Math.round(Math.log2(0.032 * fs)), H = N / 2, half = N / 2 + 1, win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(PI2 * i / N))
  let frame = (s, p) => Float64Array.from(win, (w, i) => w * (s[p + i] || 0)), P = new Float64Array(half), count = 0
  for (let p = 0; p + N <= noise.length; p += H, count++) { let [re, im] = fft(frame(noise, p)); for (let k = 0; k < half; k++) P[k] += re[k] ** 2 + im[k] ** 2 }
  let y = new Float64Array(x.length)
  for (let p = 0; p + N <= x.length; p += H) {
    let [re, im] = fft(frame(x, p)), R = new Float64Array(half), I = new Float64Array(half)
    for (let k = 0; k < half; k++) { let e = re[k] ** 2 + im[k] ** 2, g = Math.sqrt(Math.max(1 - 2 * P[k] / count / e, 0.01)) || 0; R[k] = g * re[k]; I[k] = g * im[k] }
    let o = ifft(R, I)
    for (let i = 0; i < N; i++) y[p + i] += o[i]
  }
  return y
}

const RATES = [8000, 10000, 16000, 44100, 48000], SNRS = [-10, 0, 10, 20], DUR = 2.5

/** The cases: { name, fs } each, white, babble and modulated noise at four SNRs and three processed signals per rate */
export const CASES = RATES.flatMap(fs => [
  ...['white', 'babble', 'modulated'].flatMap(noise => SNRS.map(snr => ({ name: `${fs}-${noise}${snr}`, fs, noise, snr }))),
  ...['clipped', 'lowpassed', 'subtracted'].map(how => ({ name: `${fs}-${how}`, fs, how }))
])

let made = new Map() // the rate's talker and noises, one rate held at a time
/** A case's signals: { clean, out }, Float32Array each */
export function pair({ fs, noise, snr, how }) {
  if (!made.has(fs)) { let n = Math.round(DUR * fs); made = new Map([[fs, { s: talker(fs, DUR, 1), white: white(n, 2), babble: babble(fs, DUR), modulated: modulated(n, fs, 3) }]]) }
  let m = made.get(fs), s = m.s, out
  if (noise) out = mix(s, m[noise], snr)
  else if (how === 'clipped') out = s.map(v => Math.max(-0.05, Math.min(0.05, v)))
  else if (how === 'lowpassed') out = lowpass(mix(s, m.white, 10), 1000, fs)
  else { let g = Math.sqrt(power(s) / power(m.white)); out = subtract(mix(s, m.white, 0), m.white.map(v => g * v), fs) }
  return { clean: Float32Array.from(s), out: Float32Array.from(out) }
}

function wav(x, fs) {
  let b = Buffer.alloc(44 + 4 * x.length)
  b.write('RIFF', 0); b.writeUInt32LE(36 + 4 * x.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(fs, 24); b.writeUInt32LE(4 * fs, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34)
  b.write('data', 36); b.writeUInt32LE(4 * x.length, 40)
  x.forEach((v, i) => b.writeFloatLE(v, 44 + 4 * i))
  return b
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let dir = process.argv[2]
  if (!dir) throw new Error('usage: node speech.js <dir>')
  mkdirSync(dir, { recursive: true })
  for (let c of CASES) {
    let { clean, out } = pair(c)
    writeFileSync(`${dir}/${c.name}.clean.wav`, wav(clean, c.fs))
    writeFileSync(`${dir}/${c.name}.out.wav`, wav(out, c.fs))
  }
}

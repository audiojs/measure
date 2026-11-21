// Objective audio quality metrics — reference-vs-output comparison.
//   - snr / segSnr: global and segmental signal-to-noise ratio (dB)
//   - lsd: frame-averaged log-spectral distance (dB) — spectral colouration
//   - spectralSim: frame-averaged cosine similarity of magnitude spectra
//   - nrr / speechAttenuation: noise-suppression vs speech-retention (dB)
//   - goertzelEnergy / chordBalance / chordRetention / modulationDepth: per-partial
//     energy tracking — catches hop-rate beating ("crumble") that LSD misses
//   - stoi / estoi: speech intelligibility against the clean speech (Taal et al. 2011, Jensen and Taal 2016)
//
// All metrics expect Float32Array inputs; equal length unless noted. Consolidated
// from the denoise and stretch families' evaluation suites (one lsd, one source).

import { fft } from 'fourier-transform'

const PI2 = Math.PI * 2

let _hannCache = new Map()
function hannWindow(N) {
  let w = _hannCache.get(N)
  if (w) return w
  w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(PI2 * i / N))
  _hannCache.set(N, w)
  return w
}

const lin2db = x => 20 * Math.log10(Math.max(x, 1e-30))

// fft() returns zero-copy views into a per-size cache — copy magnitudes immediately.
let _scratch = new Map()
function magFrame(data, pos, win, N, half, magOut) {
  let f = _scratch.get(N)
  if (!f) { f = new Float64Array(N); _scratch.set(N, f) }
  let e = 0
  for (let i = 0; i < N; i++) {
    let v = (data[pos + i] || 0) * win[i]
    f[i] = v
    e += v * v
  }
  let [re, im] = fft(f)
  for (let k = 0; k <= half; k++) magOut[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  return e
}

// Trim edges (algorithm startup/tail artifacts) and crop to common length.
function align(a, b, trim) {
  let n = Math.min(a.length, b.length)
  let cut = Math.floor(n * trim)
  let len = n - 2 * cut
  return [a.subarray(cut, cut + len), b.subarray(cut, cut + len)]
}

// Global SNR (dB). Clean = reference, out = processed. SNR = 10·log10(∑clean² / ∑(clean-out)²)
export function snr(clean, out) {
  let n = Math.min(clean.length, out.length)
  let s = 0, e = 0
  for (let i = 0; i < n; i++) {
    let c = clean[i], d = c - out[i]
    s += c * c
    e += d * d
  }
  return e > 0 ? 10 * Math.log10(s / e) : Infinity
}

// Segmental SNR — average per-frame SNR clamped to [-10, 35] dB (PESQ-style).
// Drops silent frames (energy < floor) so silence doesn't bias the mean.
export function segSnr(clean, out, opts = {}) {
  let N = opts.frameSize || 512
  let hop = opts.hopSize || (N >> 1)
  let floor = opts.floor ?? 1e-5
  let n = Math.min(clean.length, out.length)
  let sum = 0, frames = 0
  for (let pos = 0; pos + N <= n; pos += hop) {
    let s = 0, e = 0
    for (let i = 0; i < N; i++) {
      let c = clean[pos + i], d = c - out[pos + i]
      s += c * c
      e += d * d
    }
    if (s < floor * N) continue
    let snr = 10 * Math.log10(s / Math.max(e, 1e-30))
    sum += Math.max(-10, Math.min(35, snr))
    frames++
  }
  return frames ? sum / frames : 0
}

// Frame-averaged log-spectral distance in dB. Lower is better.
// ~1 dB: transparent. 2–4 dB: audible colouration. >5 dB: degraded.
// `trim` crops that fraction off each edge before comparing (startup/tail artifacts);
// default 0 = compare everything (time-aligned use); stretch/shift evaluation
// typically passes ~0.1.
export function lsd(a, b, opts = {}) {
  let N = opts.frameSize || 1024
  let hop = opts.hopSize || (N >> 1)
  let trim = opts.trim ?? 0
  let floor = opts.floor ?? 1e-5

  let [x, y] = trim > 0 ? align(a, b, trim) : [a, b]
  let win = hannWindow(N)
  let half = N >> 1
  let mx = new Float64Array(half + 1), my = new Float64Array(half + 1)
  let n = Math.min(x.length, y.length)
  let sum = 0, frames = 0

  for (let pos = 0; pos + N <= n; pos += hop) {
    let ex = magFrame(x, pos, win, N, half, mx)
    let ey = magFrame(y, pos, win, N, half, my)
    if (ex < floor && ey < floor) continue

    // Per-frame peak-relative magnitude floor: prevents log amplification of
    // near-silent bins (critical for pure tones where one bin holds all energy).
    let peak = 0
    for (let k = 0; k <= half; k++) {
      if (mx[k] > peak) peak = mx[k]
      if (my[k] > peak) peak = my[k]
    }
    let mfloor = peak * 1e-3 + 1e-12

    let acc = 0
    for (let k = 0; k <= half; k++) {
      let d = 20 * Math.log10((mx[k] + mfloor) / (my[k] + mfloor))
      acc += d * d
    }
    sum += Math.sqrt(acc / (half + 1))
    frames++
  }
  return frames ? sum / frames : 0
}

// Frame-averaged cosine similarity of magnitude spectra. 1 = identical.
export function spectralSim(a, b, opts = {}) {
  let N = opts.frameSize || 1024
  let hop = opts.hopSize || (N >> 1)
  let trim = opts.trim ?? 0.1
  let floor = opts.floor ?? 1e-5

  let [x, y] = align(a, b, trim)
  let win = hannWindow(N)
  let half = N >> 1
  let mx = new Float64Array(half + 1), my = new Float64Array(half + 1)
  let sum = 0, frames = 0

  for (let pos = 0; pos + N <= x.length; pos += hop) {
    let ex = magFrame(x, pos, win, N, half, mx)
    let ey = magFrame(y, pos, win, N, half, my)
    if (ex < floor || ey < floor) continue

    let dot = 0, nx = 0, ny = 0
    for (let k = 0; k <= half; k++) {
      dot += mx[k] * my[k]
      nx += mx[k] * mx[k]
      ny += my[k] * my[k]
    }
    let denom = Math.sqrt(nx * ny)
    if (denom > 0) { sum += dot / denom; frames++ }
  }
  return frames ? sum / frames : 0
}

// Noise reduction ratio (dB): drop in noise-floor RMS after processing.
// Caller selects a quiet segment by index. Positive = suppression worked.
export function nrr(noisy, out, from = 0, to) {
  to = to ?? Math.min(noisy.length, out.length)
  let nIn = 0, nOut = 0, len = to - from
  for (let i = from; i < to; i++) { nIn += noisy[i] * noisy[i]; nOut += out[i] * out[i] }
  return lin2db(Math.sqrt(nIn / len)) - lin2db(Math.sqrt(nOut / len))
}

// Speech attenuation (dB): drop in clean-signal-active RMS — should be near 0.
// Pass a clean-segment index range so we measure speech retention.
export function speechAttenuation(clean, out, from = 0, to) {
  to = to ?? Math.min(clean.length, out.length)
  let cIn = 0, cOut = 0, len = to - from
  for (let i = from; i < to; i++) {
    cIn += clean[i] * clean[i]
    cOut += out[i] * out[i]
  }
  return lin2db(Math.sqrt(cIn / len)) - lin2db(Math.sqrt(cOut / len))
}

// Goertzel energy at a single frequency. Trims 20% edges to avoid artifacts.
export function goertzelEnergy(data, freq, sr) {
  let w = 2 * Math.PI * freq / sr, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  let start = Math.floor(data.length * 0.2), end = Math.floor(data.length * 0.8)
  for (let i = start; i < end; i++) { let s = data[i] + c * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (end - start)
}

// Ratio of min/max partial energies. 1.0 = perfectly balanced, 0 = one partial destroyed.
export function chordBalance(data, freqs, sr) {
  let energies = freqs.map(f => goertzelEnergy(data, f, sr))
  let mn = Math.min(...energies), mx = Math.max(...energies)
  return mx > 1e-10 ? mn / mx : 0
}

// Total chord energy preserved relative to reference. 1.0 = no loss.
export function chordRetention(data, ref, freqs, sr) {
  let refE = freqs.reduce((s, f) => s + goertzelEnergy(ref, f, sr), 0)
  let outE = freqs.reduce((s, f) => s + goertzelEnergy(data, f, sr), 0)
  return refE > 1e-10 ? outE / refE : 0
}

// Per-partial amplitude-modulation depth — captures hop-rate beating ("crumble")
// that LSD misses. 0 = stable, ~0.05 = transparent, ~0.3+ = obvious tremolo.
export function modulationDepth(data, freqs, sr, opts = {}) {
  let win = opts.envWindow || 2048
  let hop = opts.envHop || 256
  let trim = opts.trim ?? 0.1
  let cut = Math.floor(data.length * trim)
  let len = data.length - 2 * cut
  if (len < win * 2) return 0
  let frames = Math.floor((len - win) / hop) + 1
  if (frames < 8) return 0

  let hann = new Float64Array(win)
  let hannSum = 0
  for (let i = 0; i < win; i++) { hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (win - 1))); hannSum += hann[i] }

  // Two-pass: first measure each partial's mean amplitude, then only score those
  // above 5% of the loudest. Otherwise weak/absent partials score huge spurious
  // modulation from spectral-leakage noise.
  let envs = freqs.map(() => new Float64Array(frames))
  let means = new Float64Array(freqs.length)
  for (let fi = 0; fi < freqs.length; fi++) {
    let f = freqs[fi]
    let w = 2 * Math.PI * f / sr
    let env = envs[fi]
    let mean = 0
    for (let k = 0; k < frames; k++) {
      let re = 0, im = 0, base = cut + k * hop
      for (let i = 0; i < win; i++) {
        let s = data[base + i] * hann[i]
        let phase = w * i
        re += s * Math.cos(phase)
        im -= s * Math.sin(phase)
      }
      let mag = Math.sqrt(re * re + im * im) / hannSum
      env[k] = mag
      mean += mag
    }
    means[fi] = mean / frames
  }

  let maxMean = 0
  for (let i = 0; i < means.length; i++) if (means[i] > maxMean) maxMean = means[i]
  let floor = maxMean * 0.05

  let worst = 0
  for (let i = 0; i < freqs.length; i++) {
    if (means[i] < floor) continue
    let env = envs[i], mean = means[i]
    let acVar = 0
    for (let k = 0; k < frames; k++) { let d = env[k] - mean; acVar += d * d }
    let depth = Math.sqrt(acVar / frames) / mean
    if (depth > worst) worst = depth
  }
  return worst
}

// Speech intelligibility against the clean speech, a number from about 0 to 1 that rises with the share of words
// listeners understand (not that share itself).
// [1] C. H. Taal, R. C. Hendriks, R. Heusdens, J. Jensen, "An Algorithm for Intelligibility Prediction of
//     Time-Frequency Weighted Noisy Speech", IEEE Trans. Audio, Speech, Lang. Process. 19(7), 2011, sec. II: STOI.
// [2] J. Jensen, C. H. Taal, "An Algorithm for Predicting the Intelligibility of Speech Masked by Modulated Noise
//     Maskers", IEEE/ACM Trans. Audio, Speech, Lang. Process. 24(11), 2016, sec. II: ESTOI.
// Ported from pystoi 0.4.1 (github.com/mpariente/pystoi at 74872b0; Copyright (c) 2018 Pariente Manuel, MIT licence)
// and held to it by test.js; a step that follows its code rather than the papers names its file.

const FS = 10000                          // [1] sec. II, [2] sec. II-C: both signals at 10 kHz
const FRAME = 256, HOP = 128, NFFT = 512  // [1] sec. II: Hann frames of 256 samples, 50% overlap, zero-padded to 512
const BANDS = 15, LOW = 150               // [1] sec. II: 15 one-third octave bands, the lowest centred at 150 Hz
const N = 30                              // [1] eq. 2: 30 frames to a segment, 384 ms
const CLIP = 1 + 10 ** (15 / 20)          // [1] eq. 3: 1 + 10^(-β/20), β = -15 dB, the lower signal-to-distortion bound
const RANGE = 40                          // [1] sec. II: a frame 40 dB under the clean speech's loudest is silent
const EPS = Number.EPSILON                // pystoi/utils.py EPS, added where pystoi adds it

// MATLAB's hanning(256), as pystoi/utils.py takes it: np.hanning(258)[1:-1]
const WIN = Float64Array.from({ length: FRAME }, (_, n) => 0.5 - 0.5 * Math.cos(PI2 * (n + 1) / (FRAME + 1)))
// [1] eq. 1: band j sums the DFT bins EDGES[j] to EDGES[j + 1] - 1, the edges 150·2^((2j - 1)/6) Hz rounded to the
// nearest bin (pystoi/utils.py thirdoct); a band's upper edge is the next one's lower
const EDGES = Array.from({ length: BANDS + 1 }, (_, j) => Math.round(LOW * 2 ** ((2 * j - 1) / 6) * NFFT / FS))

/** STOI [1] of `out` against the clean speech, both mono at `fs` Hz and time-aligned */
export const stoi = (clean, out, fs) => intelligibility(clean, out, fs, false)

/** ESTOI [2]: STOI's bands judged together, for noise that comes and goes (a talker, a fluctuating masker) */
export const estoi = (clean, out, fs) => intelligibility(clean, out, fs, true)

function intelligibility(clean, out, fs, extended) {
  let name = extended ? 'estoi' : 'stoi'
  if (!Number.isInteger(fs) || fs <= 0) throw new RangeError(`${name}: fs must be a sample rate in Hz, got ${fs}`)
  if (!mono(clean) || !mono(out)) throw new TypeError(`${name}: one channel each: pass a Float32Array (a channel, or the channels' mean)`)
  if (clean.length !== out.length) throw new RangeError(`${name}: clean has ${clean.length} samples, out ${out.length}: align them and cut both to one length`)
  // no speech in the reference: nothing to understand, no measure (pystoi gives 0)
  if (!clean.some(v => v !== 0)) return NaN
  let [x, y] = speech(to10k(clean, fs), to10k(out, fs))
  let X = envelopes(x), Y = envelopes(y), M = X.length / BANDS
  // fewer than 30 frames of speech: no segment, no measure (pystoi/stoi.py warns and gives 1e-5)
  if (M < N) return NaN
  let S = M - N + 1, d = 0
  if (!extended) {
    let a = new Float64Array(N), b = new Float64Array(N)
    for (let m = 0; m < S; m++) for (let j = 0; j < BANDS; j++) {
      let o = j * M + m, ex = 0, ey = 0
      for (let n = 0; n < N; n++) { ex += X[o + n] ** 2; ey += Y[o + n] ** 2 }
      // [1] eq. 3: out's envelope scaled to the clean one's energy, then clipped to (1 + 10^(-β/20)) times the clean one
      let g = Math.sqrt(ex) / (Math.sqrt(ey) + EPS)
      for (let n = 0; n < N; n++) { a[n] = X[o + n]; b[n] = Math.min(g * Y[o + n], CLIP * X[o + n]) }
      // [1] eq. 5: their correlation coefficient (pystoi/stoi.py adds EPS to each norm)
      unit(a, 0, 1, N, EPS); unit(b, 0, 1, N, EPS)
      for (let n = 0; n < N; n++) d += a[n] * b[n]
    }
    return d / (S * BANDS) // [1] eq. 6: the mean over bands and segments
  }
  let A = new Float64Array(BANDS * N), B = new Float64Array(BANDS * N)
  for (let m = 0; m < S; m++) {
    for (let j = 0; j < BANDS; j++) for (let n = 0; n < N; n++) { A[j * N + n] = X[j * M + m + n]; B[j * N + n] = Y[j * M + m + n] }
    // [2] eq. 1-2: each band's envelope over the segment (a row) to zero mean and unit norm, then sec. II-A: each
    // frame's spectrum (a column) likewise
    for (let j = 0; j < BANDS; j++) { unit(A, j * N, 1, N); unit(B, j * N, 1, N) }
    for (let n = 0; n < N; n++) { unit(A, n, N, BANDS); unit(B, n, N, BANDS) }
    // [2] eq. 4: the mean over the segment's frames of their spectra's correlation
    let s = 0
    for (let i = 0; i < BANDS * N; i++) s += A[i] * B[i]
    d += s / N
  }
  return d / S // [2] eq. 5: the mean over segments
}

const mono = x => x != null && typeof x.length === 'number' && (x.length === 0 || typeof x[0] === 'number')

// n values of v from o at a stride: less their mean, over their norm (plus eps); left at zero when all are equal,
// where pystoi's ESTOI (utils.py row_col_normalize) adds noise of EPS and returns a random direction
function unit(v, o, step, n, eps = 0) {
  let mean = 0, norm = 0
  for (let i = 0; i < n; i++) mean += v[o + i * step]
  mean /= n
  for (let i = 0; i < n; i++) { let d = v[o + i * step] -= mean; norm += d * d }
  if (!(norm > 0)) return
  norm = Math.sqrt(norm) + eps
  for (let i = 0; i < n; i++) v[o + i * step] /= norm
}

// [1] sec. II: the frames where the clean speech is 40 dB under its loudest are dropped from both signals, the rest
// joined. Framing and join follow pystoi/utils.py remove_silent_frames: Hann frames of 256 at a hop of 128, frame k
// starting at k·128 < length - 256 (the last whole frame is left out, as there), the kept frames overlap-added.
function speech(x, y) {
  let K = Math.max(0, Math.ceil((x.length - FRAME) / HOP)), e = new Float64Array(K), top = -Infinity, keep = []
  for (let k = 0; k < K; k++) {
    let s = 0
    for (let i = 0; i < FRAME; i++) { let v = WIN[i] * x[k * HOP + i]; s += v * v }
    e[k] = 20 * Math.log10(Math.sqrt(s) + EPS)
    if (e[k] > top) top = e[k]
  }
  for (let k = 0; k < K; k++) if (top - RANGE - e[k] < 0) keep.push(k)
  let n = keep.length && (keep.length - 1) * HOP + FRAME, xs = new Float64Array(n), ys = new Float64Array(n)
  keep.forEach((k, j) => {
    for (let i = 0; i < FRAME; i++) { xs[j * HOP + i] += WIN[i] * x[k * HOP + i]; ys[j * HOP + i] += WIN[i] * y[k * HOP + i] }
  })
  return [xs, ys]
}

// [1] eq. 1: the one-third octave band envelopes, band-major (band j's frames at j·M to j·M + M - 1), of the Hann
// frames of 256 at a hop of 128 zero-padded to 512, framed as pystoi/utils.py stft frames (the last whole one left out)
function envelopes(x) {
  let M = Math.max(0, Math.ceil((x.length - FRAME) / HOP)), E = new Float64Array(BANDS * M), f = new Float64Array(NFFT)
  for (let m = 0; m < M; m++) {
    for (let i = 0; i < FRAME; i++) f[i] = WIN[i] * x[m * HOP + i]
    let [re, im] = fft(f)
    for (let j = 0; j < BANDS; j++) {
      let s = 0
      for (let k = EDGES[j]; k < EDGES[j + 1]; k++) s += re[k] * re[k] + im[k] * im[k]
      E[j * M + m] = Math.sqrt(s)
    }
  }
  return E
}

// To 10 kHz as pystoi/utils.py resample_oct does (its Octave-compatible filter, run by scipy.signal.resample_poly):
// up by p, a zero-phase Kaiser-windowed sinc lowpass at 1/(2·max(p, q)) of the upsampled rate with a transition a
// tenth of that and 60 dB of rejection, normalized to unit sum (times p), down by q; zeros beyond either end
let kernels = new Map()
function to10k(x, fs) {
  if (fs === FS) return x
  let g = gcd(FS, fs), p = FS / g, q = fs / g, h = kernel(p, q), half = (h.length - 1) / 2
  let n = Math.ceil(x.length * p / q), y = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    // y[j] = Σ h[t - i·p]·x[i], t = j·q + half: the filter centred on the output sample
    let t = j * q + half, i = Math.max(0, Math.ceil((t - 2 * half) / p)), end = Math.min(x.length - 1, Math.floor(t / p)), s = 0
    for (; i <= end; i++) s += h[t - i * p] * x[i]
    y[j] = s
  }
  return y
}

function kernel(p, q) {
  let key = p + ':' + q, h = kernels.get(key)
  if (h) return h
  let fc = 1 / (2 * Math.max(p, q)), L = Math.ceil((60 - 8) / (28.714 * (fc / 10))), beta = 0.1102 * (60 - 8.7), sum = 0
  h = new Float64Array(2 * L + 1)
  for (let i = 0; i <= 2 * L; i++) {
    let t = i - L, a = Math.PI * 2 * fc * t
    h[i] = i0(beta * Math.sqrt(1 - (t / L) ** 2)) * (t ? Math.sin(a) / a : 1)
    sum += h[i]
  }
  for (let i = 0; i <= 2 * L; i++) h[i] *= p / sum
  kernels.set(key, h)
  return h
}

// modified Bessel function of the first kind, order 0 (its power series): the Kaiser window's
function i0(x) {
  let s = 1, t = 1
  for (let k = 1; t > 1e-17 * s; k++) { t *= (x / (2 * k)) ** 2; s += t }
  return s
}

const gcd = (a, b) => b ? gcd(b, a % b) : a

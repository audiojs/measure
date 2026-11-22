// Objective audio quality metrics — reference-vs-output comparison.
//   - snr / segSnr: global and segmental signal-to-noise ratio (dB)
//   - lsd: frame-averaged log-spectral distance (dB) — spectral colouration
//   - spectralSim: frame-averaged cosine similarity of magnitude spectra
//   - nrr / speechAttenuation: noise-suppression vs speech-retention (dB)
//   - goertzelEnergy / chordBalance / chordRetention / modulationDepth: per-partial
//     energy tracking — catches hop-rate beating ("crumble") that LSD misses
//   - stoi / estoi: speech intelligibility against the clean speech (Taal et al. 2011, Jensen and Taal 2016)
//   - twof: perceived quality against the reference, a MUSHRA-like score (the 2f-model, Kastner and Herre 2019)
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
  let [x, y] = speech(resample(clean, fs, FS), resample(out, fs, FS))
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

// To another rate as pystoi/utils.py resample_oct does (its Octave-compatible filter, run by
// scipy.signal.resample_poly): up by p, a zero-phase Kaiser-windowed sinc lowpass at 1/(2·max(p, q)) of the upsampled
// rate with a transition a tenth of that and 60 dB of rejection, normalized to unit sum (times p), down by q; zeros
// beyond either end
let kernels = new Map()
function resample(x, fs, to) {
  if (fs === to) return x
  let g = gcd(to, fs), p = to / g, q = fs / g, h = kernel(p, q), half = (h.length - 1) / 2
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

// Perceived quality of music and other sound against its reference: the 2f-model [5], an estimate of the score
// listeners give in a MUSHRA test (0 to 100), from two measures of the FFT ear model of ITU-R BS.1387's Basic
// version [3]: the average modulation difference and the average distorted block.
// [3] ITU-R BS.1387-1 (2001), "Method for objective measurements of perceived audio quality".
// [4] P. Kabal, "An Examination and Interpretation of ITU-R BS.1387: Perceptual Evaluation of Audio Quality", TSP Lab
//     Technical Report, McGill University, 2002 (rev. 2003): [3] restated, with the choices it leaves open. Section
//     and equation numbers below are [4]'s.
// [5] T. Kastner, J. Herre, "An Efficient Model for Estimating Subjective Quality of Separated Audio Source Signals",
//     WASPAA 2019; the constants are AudioLabs' supplement of April 2020
//     (audiolabs-erlangen.de/resources/2019-WASPAA-SEBASS), fitted to the two measures as Kabal's PQevalAudio gives them.
// Written from [4]'s equations and held by test.js to PQevalAudio's numbers, which [5]'s constants belong to. Where
// PQevalAudio leaves [3] or [4] this follows it, and the place says so: four band edges, the frames counted.

const EAR_FS = 48000, EAR_N = 2048, EAR_HOP = 1024   // 2.1: frames of 2048 samples at 48 kHz, half overlapping
const EAR_RATE = EAR_FS / EAR_HOP                    // Eq. 29: frames a second
const EAR_BANDS = 109
// 2.6: the Basic version's bands, a quarter Bark wide from 80 Hz to 18 kHz (z = 7 asinh(f / 650), Eq. 9 to 12), as
// [3] prints them (Table 6): band i from EAR_EDGES[i] to EAR_EDGES[i + 1] Hz, centred at EAR_CENTRES[i]
const EAR_EDGES = [
  80, 103.445, 127.023, 150.762, 174.694, 198.849, 223.257, 247.95, 272.959, 298.317, 324.055, 350.207, 376.805,
  403.884, 431.478, 459.622, 488.353, 517.707, 547.721, 578.434, 609.885, 642.114, 675.161, 709.071, 743.884,
  779.647, 816.404, 854.203, 893.091, 933.119, 974.336, 1016.797, 1060.555, 1105.666, 1152.187, 1200.178, 1249.7,
  1300.816, 1353.592, 1408.094, 1464.392, 1522.559, 1582.668, 1644.795, 1709.021, 1775.427, 1844.098, 1915.121,
  1988.587, 2064.59, 2143.227, 2224.597, 2308.806, 2395.959, 2486.169, 2579.551, 2676.223, 2776.309, 2879.937,
  2987.238, 3098.35, 3213.415, 3332.579, 3455.993, 3583.817, 3716.212, 3853.348, 3995.399, 4142.547, 4294.979,
  4452.89, 4616.482, 4785.962, 4961.548, 5143.463, 5331.939, 5527.217, 5729.545, 5939.183, 6156.396, 6381.463,
  6614.671, 6856.316, 7106.708, 7366.166, 7635.02, 7913.614, 8202.302, 8501.454, 8811.45, 9132.688, 9465.574,
  9810.536, 10168.013, 10538.46, 10922.351, 11320.175, 11732.438, 12159.67, 12602.412, 13061.229, 13536.71,
  14029.458, 14540.103, 15069.295, 15617.71, 16186.049, 16775.035, 17385.42, 18000
]
const EAR_CENTRES = [
  91.708, 115.216, 138.87, 162.702, 186.742, 211.019, 235.566, 260.413, 285.593, 311.136, 337.077, 363.448,
  390.282, 417.614, 445.479, 473.912, 502.95, 532.629, 562.988, 594.065, 625.899, 658.533, 692.006, 726.362,
  761.644, 797.898, 835.17, 873.508, 912.959, 953.576, 995.408, 1038.511, 1082.938, 1128.746, 1175.995, 1224.744,
  1275.055, 1326.992, 1380.623, 1436.014, 1493.237, 1552.366, 1613.474, 1676.641, 1741.946, 1809.474, 1879.31,
  1951.543, 2026.266, 2103.573, 2183.564, 2266.34, 2352.008, 2440.675, 2532.456, 2627.468, 2725.832, 2827.672,
  2933.12, 3042.309, 3155.379, 3272.475, 3393.745, 3519.344, 3649.432, 3784.176, 3923.748, 4068.324, 4218.09,
  4373.237, 4533.963, 4700.473, 4872.978, 5051.7, 5236.866, 5428.712, 5627.484, 5833.434, 6046.825, 6267.931,
  6497.031, 6734.42, 6980.399, 7235.284, 7499.397, 7773.077, 8056.673, 8350.547, 8655.072, 8970.639, 9297.648,
  9636.52, 9987.683, 10351.586, 10728.695, 11119.49, 11524.47, 11944.149, 12379.066, 12829.775, 13296.85,
  13780.887, 14282.503, 14802.338, 15341.057, 15899.345, 16477.914, 17077.504, 17690.045
]
const EAR_LO = Float64Array.from(EAR_CENTRES, (_, i) => EAR_EDGES[i]), EAR_HI = Float64Array.from(EAR_CENTRES, (_, i) => EAR_EDGES[i + 1])
const EAR_FC = Float64Array.from(EAR_CENTRES)
// PQevalAudio's table (PQCB.m) differs from [3]'s in four entries: band 66 starts at 3853.817 (3853.348), bands 28
// and 70 end at 933.113 (933.119) and 4643.482 (4616.482), band 100 is centred at 13294.85 (13296.85). Kept, since
// [5]'s constants were fitted to its numbers
EAR_LO[66] = 3853.817; EAR_HI[28] = 933.113; EAR_HI[70] = 4643.482; EAR_FC[100] = 13294.85

// Eq. 13: a DFT bin's energy lies over its width, and band i takes the share within its edges: EAR_SHARE[i] is the
// band's first bin and its shares from there
const EAR_SHARE = Array.from({ length: EAR_BANDS }, (_, i) => {
  let df = EAR_FS / EAR_N, first = Math.round(EAR_LO[i] / df), u = []
  for (let k = first; k <= EAR_N / 2; k++) {
    let w = (Math.min(EAR_HI[i], (k + 0.5) * df) - Math.max(EAR_LO[i], (k - 0.5) * df)) / df
    if (w <= 0) break
    u.push(w)
  }
  return { first, u: Float64Array.from(u) }
})

// 2.2 to 2.5, one factor per bin on the DFT's power: the loudness scale (Eq. 165: a full-scale sine of 1019.5 Hz is
// 92 dB SPL; its peak over the Hann window of Eq. 1 falls between two bins, footnote 10) and the outer and middle
// ear's response (Eq. 6, 7)
const EAR_WIN = Float64Array.from({ length: EAR_N }, (_, n) => 0.5 - 0.5 * Math.cos(PI2 * n / (EAR_N - 1)))
const EAR_GAIN = (() => {
  let w = (EAR_N - 1) / EAR_FS, d = Math.abs(1019.5 - Math.round(1019.5 * EAR_N / EAR_FS) * EAR_FS / EAR_N) * w
  let peak = Math.sin(Math.PI * d) / (Math.PI * d * (1 - d * d)), level = 10 ** (92 / 20) / (peak * (EAR_N - 1) / 4)
  return Float64Array.from({ length: EAR_N / 2 + 1 }, (_, k) => {
    let f = k * EAR_FS / EAR_N / 1000
    return k ? (level * 10 ** ((-2.184 * f ** -0.8 + 6.5 * Math.exp(-0.6 * (f - 3.3) ** 2) - 0.001 * f ** 3.6) / 20)) ** 2 : 0
  })
})()
// Eq. 18: the ear's own noise in each band
const EAR_NOISE = EAR_FC.map(f => 10 ** (0.1456 * (f / 1000) ** -0.8))
// Eq. 22, 23: a band's energy spreads down the Bark scale by 27 dB a Bark, EAR_DOWN a band, and up by
// 24 + 230 / fc - 2 log10(E) dB a Bark, EAR_UP[l]·E^0.05 a band
const EAR_DZ = 1 / 4, EAR_DOWN = 10 ** (-2.7 * EAR_DZ), EAR_UP = EAR_FC.map(f => 10 ** ((-2.4 - 23 / f) * EAR_DZ))
// Eq. 20: what a flat spectrum of unit energy spreads to, each band's norm
const EAR_FLAT = spread(new Float64Array(EAR_BANDS).fill(1), new Float64Array(EAR_BANDS)).slice()
// Eq. 32, 33 and 55: a band's averaging over frames, a time constant of 8 ms plus (t100 - 8 ms)·100 / fc: t100 30 ms
// for forward masking (2.9.1), 50 ms for the modulation (4.2, "the same as used in the previous section")
const earDecay = t100 => EAR_FC.map(f => Math.exp(-1 / (EAR_RATE * (0.008 + 100 / f * (t100 - 0.008)))))
const EAR_MASK = earDecay(0.030), EAR_MOD = earDecay(0.050)
// Eq. 122: the just noticeable step in dB at an excitation of L dB, c0 to c4 then d1 (d2 / L)^g
const EAR_STEP = [-0.198719, 0.0550197, -0.00102438, 5.05622e-6, 9.01033e-11, 5.95072, 6.39468, 1.71332]

/**
 * The 2f-model's estimate [5] of the MUSHRA score of `out` against its reference, 0 to 100, both mono at `fs` Hz and
 * time-aligned, samples in -1..1 with full scale taken as 92 dB SPL
 */
export function twof(ref, out, fs) {
  if (!Number.isInteger(fs) || fs <= 0) throw new RangeError(`twof: fs must be a sample rate in Hz, got ${fs}`)
  if (!mono(ref) || !mono(out)) throw new TypeError(`twof: one channel each: pass a Float32Array (a channel, or the channels' mean)`)
  if (ref.length !== out.length) throw new RangeError(`twof: ref has ${ref.length} samples, out ${out.length}: align them and cut both to one length`)
  let m = earMeasures(resample(ref, fs, EAR_FS), resample(out, fs, EAR_FS))
  // [5], the supplement's constants; the score kept within the scale
  return m && Math.min(100, Math.max(0, 56.1345 / (1 + (-0.0282 * m.modDiff - 0.8628) ** 2) - 27.1451 * m.adb + 86.3515))
}

// The two measures of `out` against `ref` at 48 kHz: modDiff, the average modulation difference (AvgModDiff1B, 5.2),
// and adb, the average distorted block (ADBB, 5.6). NaN where there is too little sound for them.
function earMeasures(ref, out) {
  // 5.1: the data runs from the first to the last five samples of the reference whose magnitudes sum over 200 of
  // 32768. PQevalAudio counts the frames whose middle lies within it: from the frame whose first half holds the
  // first of those samples to the last frame whose first half ends by the last of them ([4] words it as the first
  // and last frames holding them), so a last frame is never under half a frame of signal (6.8)
  let n = ref.length, five = i => Math.abs(ref[i]) + Math.abs(ref[i + 1]) + Math.abs(ref[i + 2]) + Math.abs(ref[i + 3]) + Math.abs(ref[i + 4])
  let edge = 200 / 32768, lo = 0, hi = n - 1
  while (lo < n - 4 && !(five(lo) > edge)) lo++
  while (hi > 3 && !(five(hi - 4) > edge)) hi--
  let first = Math.floor(lo / EAR_HOP), last = Math.floor((hi + 1) / EAR_HOP) - 1
  // 5.2.1: the modulation's average leaves out the first half second of the file
  let from = Math.max(first, Math.ceil(0.5 * EAR_RATE))
  if (lo >= n - 4 || from > last) return NaN

  let R = ear(ref), T = ear(out), wsum = 0, msum = 0, steps = 0, blocks = 0
  for (let f = 0; f <= last; f++) {
    R.next(f * EAR_HOP); T.next(f * EAR_HOP)
    if (f < first) continue
    if (f >= from) {
      let m = 0, w = 0
      for (let k = 0; k < EAR_BANDS; k++) {
        m += Math.abs(T.mod[k] - R.mod[k]) / (1 + R.mod[k])            // Eq. 73
        w += R.loud[k] / (R.loud[k] + 100 * EAR_NOISE[k] ** 0.3)       // Eq. 78
      }
      msum += w * 100 / EAR_BANDS * m; wsum += w                       // Eq. 74, 77
    }
    // 5.6: each band's chance that the difference is heard, and its size in noticeable steps
    let unheard = 1, size = 0
    for (let k = 0; k < EAR_BANDS; k++) {
      let r = 10 * Math.log10(R.excitation[k]), t = 10 * Math.log10(T.excitation[k]), less = R.excitation[k] > T.excitation[k]
      let L = less ? 0.3 * r + 0.7 * t : t                             // Eq. 120
      let [c0, c1, c2, c3, c4, d1, d2, g] = EAR_STEP
      let s = L > 0 ? c0 + c1 * L + c2 * L ** 2 + c3 * L ** 3 + c4 * L ** 4 + d1 * (d2 / L) ** g : 1e30   // Eq. 122
      unheard *= 0.5 ** (((r - t) / s) ** (less ? 4 : 6))              // Eq. 123, 124: something taken away is heard less than something added
      size += Math.abs(Math.trunc(r - t)) / s                          // Eq. 125
    }
    if (1 - unheard > 0.5) { steps += size; blocks++ }                 // Eq. 127, 131: the frames where it is more likely heard than not
  }
  return { modDiff: msum / wsum, adb: !blocks ? 0 : steps ? Math.log10(steps / blocks) : -0.5 }   // Eq. 77, 132
}

// One signal through the ear model, a frame at each next(first sample): `excitation` per band (spread over frequency
// and time, 2.8, 2.9), `mod`, the modulation of its envelope, and `loud`, its average loudness (4.2)
function ear(x) {
  let frame = new Float64Array(EAR_N), E = new Float64Array(EAR_BANDS), es = new Float64Array(EAR_BANDS), ef = new Float64Array(EAR_BANDS)
  let excitation = new Float64Array(EAR_BANDS), was = new Float64Array(EAR_BANDS), loud = new Float64Array(EAR_BANDS)
  let slope = new Float64Array(EAR_BANDS), mod = new Float64Array(EAR_BANDS)
  return { excitation, mod, loud, next(at) {
    for (let i = 0; i < EAR_N; i++) frame[i] = at + i < x.length ? EAR_WIN[i] * x[at + i] : 0
    let [re, im] = fft(frame)
    for (let i = 0; i < EAR_BANDS; i++) {
      let { first, u } = EAR_SHARE[i], s = 0
      for (let j = 0; j < u.length; j++) { let k = first + j; s += u[j] * EAR_GAIN[k] * (re[k] * re[k] + im[k] * im[k]) }   // Eq. 8, 14
      E[i] = s + EAR_NOISE[i]                                          // Eq. 17 (Eq. 16's floor of 1e-12 lies far under this noise)
    }
    spread(E, es)
    for (let i = 0; i < EAR_BANDS; i++) {
      let e = es[i] /= EAR_FLAT[i], a = EAR_MASK[i], l = e ** 0.3      // Eq. 19; the 0.3 power: about loudness
      ef[i] = a * ef[i] + (1 - a) * e; excitation[i] = Math.max(ef[i], e)   // Eq. 30
      a = EAR_MOD[i]
      slope[i] = a * slope[i] + (1 - a) * EAR_RATE * Math.abs(l - was[i])   // Eq. 66
      loud[i] = a * loud[i] + (1 - a) * l                              // Eq. 65
      mod[i] = slope[i] / (1 + loud[i] / 0.3)                          // Eq. 67
      was[i] = l
    }
  } }
}

// Eq. 19 to 24 without the norm: each band's energy over its spreading function's area, spread to every band and
// summed in the 0.4 power domain
function spread(E, out) {
  out.fill(0)
  for (let l = 0; l < EAR_BANDS; l++) {
    let up = EAR_UP[l] * E[l] ** (0.2 * EAR_DZ)
    let area = (1 - EAR_DOWN ** (l + 1)) / (1 - EAR_DOWN) + (1 - up ** (EAR_BANDS - l)) / (1 - up) - 1   // Eq. 24
    let e = (E[l] / area) ** 0.4, d = EAR_DOWN ** 0.4, u = up ** 0.4
    for (let i = l, v = e; i >= 0; i--, v *= d) out[i] += v
    for (let i = l + 1, v = e * u; i < EAR_BANDS; i++, v *= u) out[i] += v
  }
  for (let i = 0; i < EAR_BANDS; i++) out[i] **= 2.5
  return out
}

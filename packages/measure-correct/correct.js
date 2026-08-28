// Response correction design — measured response (IR or magnitude) + target curve → a
// correction EQ, as FIR and/or parametric bands. REW/Dirac/Acourate-class room/headphone/
// speaker correction. Pipeline:
//   1. resolve measured + target onto one log-spaced working grid (fixed points/octave)
//   2. fractional-octave smooth the measured curve (psychoacoustic)
//   3. level-align measured to target (auto mean-match or a fixed dB offset)
//   4. deviation = target − measured; Kirkeby-regularized so deep nulls aren't boosted
//   5. clamp to boost/cut limits; taper to 0 dB outside [fMin, fMax]
//   6. FIR via @audio/eq-fir's frequency-sampling design and/or parametric via @audio/eq-fit
//   7. predict the realized response and report the residual against target
//
// Kirkeby, O. & Nelson, P.A. (1999) "Digital Filter Design for Inversion Problems in Sound
// Reproduction," J. Audio Eng. Soc. 47(7/8):583–595 — regularized inversion: a literal 1/H
// inverse filter blows up at a null in the measured response; scaling the naive correction
// by |H|²/(|H|²+λ) rolls it off exactly where H is small, trading correction depth for a
// realizable (bounded-gain) filter. λ = opts.regularization.
//
// Oppenheim, A.V. & Schafer, R.W., Discrete-Time Signal Processing, 3rd ed., §12
// ("Homomorphic Filtering") — minimum-phase reconstruction from a magnitude spectrum via
// real-cepstrum folding: the cepstrum of a causal min-phase sequence is itself causal, so
// zeroing a linear-phase filter's anti-causal cepstrum half and doubling the causal half
// reconstructs a minimum-phase filter with the same magnitude response. Used for opts.minPhase.
//
// Does NOT reuse @audio/spectral-target's deviation()/smooth(): both assume a linear FFT-bin
// grid (bin k ↔ k·fs/n), which is too coarse in octave terms at low frequency (at 40 Hz,
// n=8192, fs=48000: ~4 bins/octave — can't resolve a clean 1/6-oct average). This module
// works on a log-spaced grid instead (fixed points/octave everywhere from ~10 Hz to Nyquist),
// so fractional-octave smoothing is a fixed-width index window at every frequency, correctly
// resolving 1/6 oct (room EQ) and 1/12 oct (headphones) down to the bottom of the band. The
// target − measured idea and the taper-to-zero-at-the-band-edge shape are carried over from
// spectral-target's deviation()/taper(); the grid, smoothing, level alignment, regularized
// inversion and boost/cut limits are this module's own. spectral-target's target() presets
// (speech/music/pink/voice-music) are reused directly for opts.target.

import response from '@audio/measure-response'
import target from '@audio/spectral-target'
import { design as designFir } from '@audio/eq-fir'
import { cfft, cifft } from 'fourier-transform'

const POINTS_PER_OCT = 96      // log-grid resolution — fine enough for 1/12-oct smoothing
const TAPER_OCT = 1 / 3        // band-edge fade width (opts.fMin/fMax)
const RESPONSE_N = 16384       // FFT size floor for IR → magnitude (measure-response doubles up as needed)

// ── log-frequency grid ──────────────────────────────────────────────────

function buildGrid (fLo, fHi) {
	let n = Math.max(2, Math.round(Math.log2(fHi / fLo) * POINTS_PER_OCT))
	let grid = new Float64Array(n + 1)
	let step = Math.log2(fHi / fLo) / n
	for (let i = 0; i <= n; i++) grid[i] = fLo * 2 ** (i * step)
	grid[n] = fHi // exact endpoint, avoid float drift
	return grid
}

// Log-frequency linear interpolation of a sorted (freqs, db) curve at one frequency f.
// Edge policy mirrors @audio/spectral-target's renderAnchors: hold flat below the first
// point (never −Infinity), continue the last segment's slope above the last point.
// A segment's lower edge at exactly 0 Hz (measure-response always emits a DC bin at
// freqs[0] = 0) can't anchor a log-frequency ratio (log2(f/0) = Infinity) — held flat
// instead, same as "below the first point" would for any query short of the next point.
function interpAt (freqs, db, f, lo, hi) {
	let n = freqs.length
	if (n === 1 || f <= freqs[0]) return db[0]
	if (f >= freqs[n - 1]) {
		let f0 = freqs[n - 2], d0 = db[n - 2], f1 = freqs[n - 1], d1 = db[n - 1]
		if (f1 === f0 || f0 <= 0) return d1
		let slope = (d1 - d0) / Math.log2(f1 / f0)
		return d1 + slope * Math.log2(f / f1)
	}
	// binary search for the bracketing segment
	if (lo == null) lo = 0
	if (hi == null) hi = n - 1
	while (hi - lo > 1) {
		let mid = (lo + hi) >> 1
		if (freqs[mid] <= f) lo = mid; else hi = mid
	}
	let f0 = freqs[lo], f1 = freqs[hi]
	if (f1 === f0 || f0 <= 0) return db[lo]
	let t = Math.log2(f / f0) / Math.log2(f1 / f0)
	return db[lo] + t * (db[hi] - db[lo])
}

// Sample a sorted (freqs, db) curve at every grid frequency.
function sampleAt (freqs, db, grid) {
	let out = new Float64Array(grid.length)
	let lo = 0
	for (let i = 0; i < grid.length; i++) {
		let f = grid[i]
		// freqs is ascending and grid is ascending — walk lo forward instead of a fresh
		// binary search each time (grid queries are monotonic).
		while (lo < freqs.length - 2 && freqs[lo + 1] <= f) lo++
		out[i] = interpAt(freqs, db, f, lo, Math.min(lo + 1, freqs.length - 1))
	}
	return out
}

function sortPoints (points) {
	let pts = [...points].sort((a, b) => a.f - b.f)
	return [pts.map(p => p.f), pts.map(p => p.gain)]
}

// ── input resolution ────────────────────────────────────────────────────

function resolveCurve (input, opts, grid, what) {
	let { fs } = opts
	if (ArrayBuffer.isView(input)) { // IR: Float32Array | Float64Array
		let { freqs, db } = response(input, { fs, n: RESPONSE_N })
		return sampleAt(freqs, db, grid)
	}
	if (Array.isArray(input)) { // [{f, gain}] points
		if (!input.length) throw new RangeError(`correct: ${what} points array is empty`)
		let [freqs, db] = sortPoints(input)
		return sampleAt(freqs, db, grid)
	}
	if (input && typeof input === 'object' && input.freqs && input.db) { // {freqs, db}
		return sampleAt(input.freqs, input.db, grid)
	}
	throw new TypeError(`correct: ${what} must be an IR (Float32Array/Float64Array), {freqs, db}, or [{f, gain}] points`)
}

function resolveTarget (t, opts, grid) {
	let { fs } = opts
	if (t === 'flat') return new Float64Array(grid.length) // 0 dB everywhere
	if (typeof t === 'function') {
		let out = new Float64Array(grid.length)
		for (let i = 0; i < grid.length; i++) out[i] = t(grid[i])
		return out
	}
	if (typeof t === 'string') { // spectral-target preset
		let bins = 8193
		let curve = target(t, { fs, bins })
		let n = 2 * (bins - 1)
		let freqs = new Float64Array(bins)
		for (let k = 0; k < bins; k++) freqs[k] = k * fs / n
		return sampleAt(freqs, curve, grid)
	}
	return resolveCurve(t, opts, grid, 'target')
}

// ── fractional-octave smoothing on the log grid ─────────────────────────
// Fixed-width index window (the grid is uniform in log2(f)), summed via a prefix sum —
// O(n) total. The log-grid equivalent of spectral-target's smooth(); see file header.
function smoothLog (db, oct) {
	let half = Math.round((oct / 2) * POINTS_PER_OCT)
	if (half <= 0) return Float64Array.from(db)
	let n = db.length
	let prefix = new Float64Array(n + 1)
	for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + db[i]
	let out = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half)
		out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
	}
	return out
}

// ── band edges: raised-cosine taper to exactly 0 at and beyond [lo, hi] ─
// Mirrors @audio/spectral-target's taper()/rcos() shape, parametrized by opts.fMin/fMax
// instead of spectral-target's fixed [20 Hz, 0.45·fs] band.
function rcos (x) { return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x))) }

function bandGain (f, lo, hi) {
	if (f <= lo || f >= hi) return 0
	let g = 1
	let loEdge = lo * 2 ** TAPER_OCT
	if (f < loEdge) g = Math.min(g, rcos(Math.log2(f / lo) / TAPER_OCT))
	let hiEdge = hi / 2 ** TAPER_OCT
	if (f > hiEdge) g = Math.min(g, rcos(Math.log2(hi / f) / TAPER_OCT))
	return g
}

function bandMean (db, grid, lo, hi) {
	let sum = 0, cnt = 0
	for (let i = 0; i < grid.length; i++) {
		if (grid[i] >= lo && grid[i] <= hi) { sum += db[i]; cnt++ }
	}
	return cnt ? sum / cnt : 0
}

// ── minimum-phase conversion (real-cepstrum folding, Oppenheim & Schafer §12) ──

function toMinPhase (h) {
	let N = h.length
	let nfft = 1
	while (nfft < N * 16) nfft <<= 1 // generous oversampling for cepstral accuracy

	let re = new Float64Array(nfft), im = new Float64Array(nfft)
	re.set(h)
	cfft(re, im)

	let peak = 0
	for (let k = 0; k < nfft; k++) { let m = Math.hypot(re[k], im[k]); if (m > peak) peak = m }
	let eps = peak * 1e-8 + 1e-300
	let logmagRe = new Float64Array(nfft), logmagIm = new Float64Array(nfft)
	for (let k = 0; k < nfft; k++) logmagRe[k] = Math.log(Math.hypot(re[k], im[k]) + eps)

	cifft(logmagRe, logmagIm) // real cepstrum (imaginary part ~0, discarded)

	let half = nfft >> 1
	let cmin = new Float64Array(nfft)
	cmin[0] = logmagRe[0]
	for (let n = 1; n < half; n++) cmin[n] = 2 * logmagRe[n]
	cmin[half] = logmagRe[half]
	// n > half stays 0 — the anti-causal half is discarded (minimum-phase folding)

	let cmIm = new Float64Array(nfft)
	cfft(cmin, cmIm) // complex log-spectrum: real = min-phase log-magnitude, imag = min-phase

	let hRe = new Float64Array(nfft), hIm = new Float64Array(nfft)
	for (let k = 0; k < nfft; k++) {
		let mag = Math.exp(cmin[k])
		hRe[k] = mag * Math.cos(cmIm[k])
		hIm[k] = mag * Math.sin(cmIm[k])
	}
	cifft(hRe, hIm)

	return hRe.subarray(0, N).slice() // minimum-phase energy concentrates causally near n=0
}

/**
 * @param {Float32Array|Float64Array|{freqs,db}|Array<{f,gain}>} measured
 * @param {object} opts
 * @returns {Promise<object>} { freqs, measured, target, correction, coefs?, bands?, preamp?, residual, rms, maxBoost }
 */
export default async function correct (measured, opts = {}) {
	let {
		fs = 44100,
		target: targetOpt = 'flat',
		fMin = 20, fMax = 20000,
		smoothOct = 1 / 6,
		maxBoost = 6, maxCut = 20,
		regularization = 0.1,
		level = 'auto',
		mode = 'fir',
		taps = 4095,
		bands: nBands = 10,
		minPhase = false,
	} = opts

	if (!measured) throw new TypeError('correct: measured is required')
	fMax = Math.min(fMax, fs / 2 * 0.999)
	if (!(fMax > fMin)) throw new RangeError(`correct: fMax (${fMax}) must be greater than fMin (${fMin})`)

	let fLo = Math.min(10, fMin / 2)
	let fHi = fs / 2
	let grid = buildGrid(fLo, fHi)

	let measuredRaw = resolveCurve(measured, { ...opts, fs }, grid, 'measured')
	let targetRaw = resolveTarget(targetOpt, { ...opts, fs }, grid)

	let measuredSmoothed = smoothLog(measuredRaw, smoothOct)

	let offset = typeof level === 'number' ? level : bandMean(targetRaw, grid, fMin, fMax) - bandMean(measuredSmoothed, grid, fMin, fMax)
	let measuredAligned = new Float64Array(grid.length)
	for (let i = 0; i < grid.length; i++) measuredAligned[i] = measuredSmoothed[i] + offset

	// Kirkeby-regularized deviation (see file header): correction = dev · |H|²/(|H|²+λ)
	let correction = new Float32Array(grid.length)
	let peakBoost = 0
	for (let i = 0; i < grid.length; i++) {
		let dev = targetRaw[i] - measuredAligned[i]
		let hLin = 10 ** (measuredAligned[i] / 20)
		let h2 = hLin * hLin
		let factor = h2 / (h2 + regularization)
		let c = dev * factor
		c = Math.min(maxBoost, Math.max(-maxCut, c))
		c *= bandGain(grid[i], fMin, fMax)
		correction[i] = c
		if (c > peakBoost) peakBoost = c
	}

	let result = {
		freqs: Float32Array.from(grid),
		measured: Float32Array.from(measuredAligned),
		target: Float32Array.from(targetRaw),
		correction,
		maxBoost: peakBoost,
	}

	let realized = null

	if (mode === 'fir' || mode === 'both') {
		let points = new Array(grid.length)
		for (let i = 0; i < grid.length; i++) points[i] = { f: grid[i], gain: correction[i] }
		let coefs = designFir(points, { taps, fs })
		if (minPhase) coefs = toMinPhase(coefs)
		result.coefs = coefs

		let { freqs: rf, db: rdb } = response(coefs, { fs, n: RESPONSE_N }) // response() doubles n up to >= coefs.length itself
		realized = sampleAt(rf, rdb, grid)
	}

	if (mode === 'parametric' || mode === 'both') {
		let eqFit
		try {
			eqFit = await import('@audio/eq-fit')
		} catch (e) {
			throw new Error('correct: mode "parametric" requires @audio/eq-fit to be installed — ' + e.message)
		}
		let dbAt = f => interpAt(grid, correction, f)
		let fit = eqFit.default(dbAt, { fs, bands: nBands, fMin, fMax, maxGain: maxBoost })
		result.bands = fit.bands
		result.preamp = fit.preamp

		// preamp is a broadband headroom offset (AutoEQ convention: paired with turning the
		// listening volume back up on playback), not part of the corrected *shape* — excluded
		// here just like eq-fit's own `error` field excludes it. eqFit.response(bands, 0, fs)
		// reuses eq-fit's own cascade-magnitude helper (itself @audio/biquad's cascadeMagnitude).
		if (!realized) {
			let respFn = eqFit.response(fit.bands, 0, fs)
			realized = new Float64Array(grid.length)
			for (let i = 0; i < grid.length; i++) realized[i] = respFn(grid[i])
		}
	}

	if (!realized) realized = new Float64Array(grid.length) // no correction applied

	let residual = new Float32Array(grid.length)
	let sq = 0, cnt = 0
	for (let i = 0; i < grid.length; i++) {
		let r = targetRaw[i] - (measuredAligned[i] + realized[i])
		residual[i] = r
		if (grid[i] >= fMin && grid[i] <= fMax) { sq += r * r; cnt++ }
	}
	result.residual = residual
	result.rms = cnt ? Math.sqrt(sq / cnt) : 0

	return result
}

/** Apply a correct() result to a buffer: firEq (coefs) or eq-parametric (bands + preamp). */
export async function apply (data, result, { fs = 44100 } = {}) {
	if (result.coefs) {
		let { default: firEq } = await import('@audio/eq-fir')
		return firEq(data, { coefs: result.coefs })
	}
	if (result.bands && result.bands.length) {
		if (result.preamp) {
			let g = 10 ** (result.preamp / 20)
			for (let i = 0; i < data.length; i++) data[i] *= g
		}
		let { default: parametricEq } = await import('@audio/eq-parametric')
		return parametricEq(data, { bands: result.bands, fs })
	}
	throw new Error('apply: result has neither coefs nor bands')
}

/** Equalizer APO text from a parametric result — delegates to @audio/eq-fit. null for FIR-only results. */
export async function toEqualizerApo (result) {
	if (!result.bands) return null
	let eqFit = await import('@audio/eq-fit')
	return eqFit.toEqualizerApo(result)
}

/** Export the FIR coefficients as a 32-bit float mono WAV impulse (Equalizer APO / Roon / CamillaDSP convolution EQ). */
export async function toWavIr (result, { fs = 44100 } = {}) {
	if (!result.coefs) throw new Error('toWavIr: result.coefs required (mode "fir" or "both")')
	let { default: wav } = await import('@audio/encode-wav')
	let enc = await wav({ sampleRate: fs, bitDepth: 32 })
	enc.encode([Float32Array.from(result.coefs)])
	let bytes = enc.flush()
	enc.free()
	return bytes
}

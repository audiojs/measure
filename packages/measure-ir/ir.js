// Impulse-response capture via exponential sine sweep deconvolution (Farina, AES 2000).
// Inverse filter = time-reversed sweep with exp(−t/L) amplitude compensation; convolving
// the recording with it collapses the sweep to an impulse at t=0 while harmonic
// distortion products land at negative time and are trimmed away — the ESS advantage.
// Calibrated by self-deconvolution of the sweep, so an identity system yields δ = 1.0.

import { fft, ifft } from 'fourier-transform'

export function convFFT (a, b) {
	let n = a.length + b.length - 1
	let N = 1
	while (N < n) N <<= 1
	let A = new Float64Array(N); A.set(a)
	let B = new Float64Array(N); B.set(b)
	let fa = fft(A)
	let ar = Float64Array.from(fa[0]), ai = Float64Array.from(fa[1]) // fft reuses one scratch buffer — copy before the next call
	let [br, bi] = fft(B)
	let re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1)
	for (let k = 0; k <= N / 2; k++) {
		re[k] = ar[k] * br[k] - ai[k] * bi[k]
		im[k] = ar[k] * bi[k] + ai[k] * br[k]
	}
	return Float64Array.from(ifft(re, im)) // copy — ifft may also reuse scratch
}

/** Farina inverse filter for an exponential sweep */
export function inverseSweep (sweep, { f0 = 20, f1, fs = 44100 } = {}) {
	let n = sweep.length
	f1 ||= fs / 2 * 0.95
	let L = (n / fs) / Math.log(f1 / f0)
	let inv = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		// envelope decays over the inverse filter's own time axis: HF (first) at unity,
		// LF (last) at f0/f1 — compensates the sweep's 1/f energy density to a flat pulse
		inv[i] = sweep[n - 1 - i] * Math.exp(-(i / fs) / L)
	}
	return inv
}

/**
 * @param {Float32Array} recorded — system output for the played sweep
 * @param {object} opts — { sweep: Float32Array (the played signal), f0=20, f1, fs=44100,
 *   length (samples of IR to return, default recorded−sweep+1) }
 * @returns {Float32Array} impulse response, direct path at index 0, calibrated to unit gain
 */
export default function ir (recorded, { sweep, f0 = 20, f1, fs = 44100, length } = {}) {
	if (!sweep) throw new RangeError('ir: opts.sweep (the played sweep) is required')
	let inv = inverseSweep(sweep, { f0, f1, fs })

	let ref = convFFT(sweep, inv)
	let peakIdx = 0, peak = 0
	for (let i = 0; i < ref.length; i++) {
		let a = Math.abs(ref[i])
		if (a > peak) { peak = a; peakIdx = i }
	}
	let scale = peak > 0 ? 1 / ref[peakIdx] : 1

	let raw = convFFT(recorded, inv)
	let n = length ?? Math.max(1, recorded.length - sweep.length + 1)
	let out = new Float32Array(n)
	for (let i = 0; i < n && peakIdx + i < raw.length; i++) out[i] = raw[peakIdx + i] * scale
	return out
}

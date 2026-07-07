// Frequency response of a system from its impulse response — zero-padded FFT magnitude
// (pair with @audio/measure-ir: sweep the device, deconvolve, read the response).

import { fft } from 'fourier-transform'

/**
 * @param {Float32Array} ir — impulse response
 * @param {object} opts — { fs=44100, n=8192 (FFT size ≥ ir.length, power of 2) }
 * @returns {{ freqs: Float32Array, db: Float32Array }}
 */
export default function response (ir, { fs = 44100, n = 8192 } = {}) {
	while (n < ir.length) n <<= 1
	let buf = new Float64Array(n)
	buf.set(ir.subarray(0, Math.min(ir.length, n)))
	let [re, im] = fft(buf)
	let half = n / 2
	let freqs = new Float32Array(half + 1)
	let db = new Float32Array(half + 1)
	for (let k = 0; k <= half; k++) {
		freqs[k] = k * fs / n
		db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12)
	}
	return { freqs, db }
}

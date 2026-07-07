// Multi-mic phase/time alignment (Auto-Align class) — signed cross-correlation peak
// gives delay and polarity of b relative to a; optional application shifts/flips b.

import { convFFT } from '@audio/measure-ir'

/**
 * @param {Float32Array} a — reference channel
 * @param {Float32Array} b — channel to align
 * @param {object} opts — { fs=44100, apply=false }
 * @returns {{ delay: number (samples b lags a), seconds: number, polarity: 1|-1,
 *   aligned?: Float32Array }}
 */
export default function align (a, b, { fs = 44100, apply = false } = {}) {
	let rev = new Float64Array(a.length)
	for (let i = 0; i < a.length; i++) rev[i] = a[a.length - 1 - i]
	let xc = convFFT(b, rev)
	let peakIdx = 0, peak = 0
	for (let i = 0; i < xc.length; i++) {
		if (Math.abs(xc[i]) > Math.abs(peak)) { peak = xc[i]; peakIdx = i }
	}
	let delay = peakIdx - (a.length - 1)
	let polarity = peak >= 0 ? 1 : -1
	let out = { delay, seconds: delay / fs, polarity }
	if (apply) {
		let aligned = new Float32Array(b.length)
		for (let i = 0; i < b.length; i++) {
			let j = i + delay
			aligned[i] = (j >= 0 && j < b.length ? b[j] : 0) * polarity
		}
		out.aligned = aligned
	}
	return out
}

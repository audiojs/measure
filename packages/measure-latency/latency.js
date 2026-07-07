// Round-trip latency measurement — FFT cross-correlation peak between the played
// reference and the loopback recording (recording setups, driver/interface delays).

import { convFFT } from '@audio/measure-ir'

/**
 * @param {Float32Array} recorded
 * @param {Float32Array} reference — the signal that was played
 * @param {object} opts — { fs=44100 }
 * @returns {{ samples: number, seconds: number, confidence: number }}
 */
export default function latency (recorded, reference, { fs = 44100 } = {}) {
	let rev = new Float64Array(reference.length)
	for (let i = 0; i < reference.length; i++) rev[i] = reference[reference.length - 1 - i]
	let xc = convFFT(recorded, rev)
	let peakIdx = 0, peak = -Infinity, sum = 0
	for (let i = 0; i < xc.length; i++) {
		let a = Math.abs(xc[i])
		sum += a
		if (a > peak) { peak = a; peakIdx = i }
	}
	let samples = peakIdx - (reference.length - 1)
	return { samples, seconds: samples / fs, confidence: peak / (sum / xc.length + 1e-12) }
}

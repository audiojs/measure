/** Exponential-sine-sweep (ESS) deconvolution — Farina 2000, self-calibrated. */
export interface IROptions {
  /** the exponential sine sweep that was played */
  sweep: Float32Array
  /** sweep start frequency, Hz, default 20 */
  f0?: number
  /** sweep end frequency, Hz, default fs/2 * 0.95 */
  f1?: number
  /** sample rate, default 44100 */
  fs?: number
  /** samples of IR to return, default recorded.length - sweep.length + 1 */
  length?: number
}

/**
 * Deconvolve a recorded ESS sweep into an impulse response: direct path at index 0,
 * calibrated to unit gain. Throws RangeError if options.sweep is omitted.
 */
export default function ir(recorded: Float32Array, options: IROptions): Float32Array

/** Zero-padded FFT convolution of two real signals. */
export function convFFT(a: Float32Array | Float64Array, b: Float32Array | Float64Array): Float64Array

/** Farina inverse filter for an exponential sweep: time-reversed sweep with exp(-t/L) amplitude compensation. */
export function inverseSweep(
  sweep: Float32Array | Float64Array,
  options?: { f0?: number; f1?: number; fs?: number }
): Float64Array

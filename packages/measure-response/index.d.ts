/** Frequency response from an impulse response — zero-padded FFT magnitude. */
export interface ResponseOptions {
  /** sample rate, default 44100 */
  fs?: number
  /** FFT size, default 8192 — doubled up to the next power of 2 >= ir.length */
  n?: number
}

export interface ResponseResult {
  /** bin center frequencies, Hz */
  freqs: Float32Array
  /** magnitude, dB */
  db: Float32Array
}

/** Zero-padded FFT magnitude of an impulse response. Pair with @audio/measure-ir. */
export default function response(ir: Float32Array, options?: ResponseOptions): ResponseResult

/** Multi-mic phase/time alignment — signed cross-correlation delay + polarity (Auto-Align class). */
export interface AlignOptions {
  /** sample rate, default 44100 */
  fs?: number
  /** also return `aligned`: b shifted by delay and polarity-flipped, default false */
  apply?: boolean
}

export interface AlignResult {
  /** samples b lags a (signed) */
  delay: number
  /** delay / fs */
  seconds: number
  /** polarity of b relative to a */
  polarity: 1 | -1
  /** b shifted by delay and polarity-flipped — present only when options.apply is true */
  aligned?: Float32Array
}

/** Signed cross-correlation peak between a and b gives delay + polarity of b relative to a. */
export default function align(a: Float32Array, b: Float32Array, options?: AlignOptions): AlignResult

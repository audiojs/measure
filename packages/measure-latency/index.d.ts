/** Round-trip latency — FFT cross-correlation peak between reference and loopback. */
export interface LatencyOptions {
  /** sample rate, default 44100 */
  fs?: number
}

export interface LatencyResult {
  /** round-trip delay of recorded relative to reference, in samples */
  samples: number
  /** samples / fs */
  seconds: number
  /** cross-correlation peak sharpness: peak magnitude / mean magnitude — higher is a more reliable peak */
  confidence: number
}

/** FFT cross-correlation peak between a played reference and its loopback recording. */
export default function latency(
  recorded: Float32Array,
  reference: Float32Array,
  options?: LatencyOptions
): LatencyResult

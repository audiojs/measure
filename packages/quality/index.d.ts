/** Objective audio quality metrics — reference-vs-output comparison. */

export interface SegSnrOptions {
  /** frame size, default 512 */
  frameSize?: number
  /** hop size, default frameSize/2 */
  hopSize?: number
  /** per-frame energy floor below which a frame is skipped as silent, default 1e-5 */
  floor?: number
}

export interface LsdOptions {
  /** frame size, default 1024 */
  frameSize?: number
  /** hop size, default frameSize/2 */
  hopSize?: number
  /** fraction trimmed off each edge before comparing, default 0 */
  trim?: number
  /** per-frame energy floor below which a frame is skipped, default 1e-5 */
  floor?: number
}

export interface SpectralSimOptions {
  /** frame size, default 1024 */
  frameSize?: number
  /** hop size, default frameSize/2 */
  hopSize?: number
  /** fraction trimmed off each edge before comparing, default 0.1 */
  trim?: number
  /** per-frame energy floor below which a frame is skipped, default 1e-5 */
  floor?: number
}

export interface ModulationDepthOptions {
  /** envelope-follower window, default 2048 */
  envWindow?: number
  /** envelope-follower hop, default 256 */
  envHop?: number
  /** fraction trimmed off each edge, default 0.1 */
  trim?: number
}

/** Global SNR, dB: 10*log10(sum(clean^2) / sum((clean-out)^2)). Infinity if out === clean exactly. */
export function snr(clean: Float32Array, out: Float32Array): number

/** Segmental SNR, dB: per-frame SNR clamped to [-10, 35], silent frames skipped (PESQ-style). */
export function segSnr(clean: Float32Array, out: Float32Array, options?: SegSnrOptions): number

/** Frame-averaged log-spectral distance, dB. ~1 dB transparent, 2-4 dB audible colouration, >5 dB degraded. */
export function lsd(a: Float32Array, b: Float32Array, options?: LsdOptions): number

/** Frame-averaged cosine similarity of magnitude spectra. 1 = identical. */
export function spectralSim(a: Float32Array, b: Float32Array, options?: SpectralSimOptions): number

/** Noise-floor RMS drop, dB, over [from, to). Positive = suppression worked. */
export function nrr(noisy: Float32Array, out: Float32Array, from?: number, to?: number): number

/** Clean-signal RMS drop, dB, over [from, to). Should be near 0. */
export function speechAttenuation(clean: Float32Array, out: Float32Array, from?: number, to?: number): number

/** Single-frequency energy via the Goertzel algorithm, 20% edges trimmed. Positional sample rate. */
export function goertzelEnergy(data: Float32Array, freq: number, sr: number): number

/** Ratio of min/max partial energies across freqs. 1 = balanced, 0 = one partial destroyed. Positional sample rate. */
export function chordBalance(data: Float32Array, freqs: number[], sr: number): number

/** Chord energy retained relative to a reference. 1 = no loss. Positional sample rate. */
export function chordRetention(data: Float32Array, ref: Float32Array, freqs: number[], sr: number): number

/** Per-partial AM depth — catches hop-rate beating ("crumble") that lsd misses. 0 = stable, ~0.3+ = obvious tremolo. Positional sample rate. */
export function modulationDepth(
  data: Float32Array,
  freqs: number[],
  sr: number,
  options?: ModulationDepthOptions
): number

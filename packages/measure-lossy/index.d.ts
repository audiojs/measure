/** Lossy-transcode detection — spectral-cutoff estimation + source classification (Spek / aucdtect class). */
export interface LossyOptions {
	/** sample rate, Hz, default 44100 */
	fs?: number
	/** Welch/STFT analysis window, samples, default 4096 */
	frameSize?: number
	/** frame hop, samples, default frameSize / 2 */
	hop?: number
	/** bins at or below this level (dB) count as "empty", default -90 */
	floorDb?: number
	/** dB drop that counts as a spectral cutoff, default 20 */
	minDrop?: number
	/** analyse at most this many seconds, evenly sampled across the file, default 120 */
	maxSeconds?: number
}

/** Best-guess encoder/quality label, or 'lossless' / 'upsampled' / 'unknown'. See lossy.js SOURCE_TABLE. */
export type LossySource =
	| 'mp3-64' | 'mp3-96' | 'mp3-128' | 'mp3-160' | 'mp3-192' | 'mp3-256' | 'mp3-320'
	| 'aac-96' | 'aac-128' | 'aac-256'
	| 'ogg-q3' | 'ogg-q5' | 'ogg-q6'
	| 'opus-64' | 'opus-96' | 'opus-128'
	| 'lossless' | 'upsampled' | 'unknown'

export interface LossyEvidence {
	/** dB drop from the reference band to the cutoff bin */
	cutoffDb: number
	/** MP3 sfb21 (~16 kHz) scalefactor-band starvation notch detected */
	sfb21: boolean
	/** slope at the cutoff edge, dB/octave — encoder lowpass: steep (> 60); natural roll-off: gentle */
	cutoffSharpness: number
	/** persistent 4-16 kHz spectral holes per second ("swiss cheese" — low-bitrate MP3 signature) */
	holes: number
	/** cutoff sits at a clean fraction of fs — sample-rate upsample, not a codec lowpass */
	upsampled: boolean
	/** cutoff / (fs / 2) */
	bandwidthRatio: number
}

export interface LossySpectrum {
	/** Hz per bin, length frameSize / 2 + 1 */
	freqs: Float32Array
	/** LTAS magnitude, dB, same length as freqs */
	db: Float32Array
}

export interface LossyResult {
	/** estimated content bandwidth, Hz — NaN or fs/2 when no cutoff is found */
	cutoff: number
	/** verdict: likely a lossy-sourced or upsampled file */
	lossy: boolean
	/** heuristic score, 0-1 — not a calibrated probability */
	confidence: number
	/** best-guess source encoder/quality — 'unknown' when nothing matches within 500 Hz */
	source: LossySource
	evidence: LossyEvidence
	spectrum: LossySpectrum
}

/**
 * Is this "lossless" file really lossless, or an upsampled/transcoded lossy source?
 * Estimates the spectral cutoff (LTAS + max-hold, Welch via @audio/spectral-ltas)
 * and classifies it against known encoder lowpass tables. Mono `Float32Array`, or
 * `Float32Array[]` per channel (mixed down internally).
 */
export default function lossy(data: Float32Array | Float32Array[], options?: LossyOptions): LossyResult

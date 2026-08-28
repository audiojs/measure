/**
 * Response correction design — measured response (IR or magnitude) + target curve →
 * correction EQ (FIR and/or parametric), Kirkeby-regularized so nulls aren't over-boosted.
 * REW/Dirac/Acourate-class room/headphone/speaker correction.
 */

/** A magnitude-response control point: gain in dB at a given frequency. */
export interface CurvePoint { f: number; gain: number }

/** Explicit per-bin frequencies + dB — the @audio/measure-response result shape. */
export interface CurveData {
	freqs: Float32Array | Float64Array
	db: Float32Array | Float64Array
}

/** Named psychoacoustic/content target presets, rendered by @audio/spectral-target. */
export type TargetPreset = 'flat' | 'speech' | 'music' | 'pink' | 'voice-music'

/** One fitted parametric band — same shape as @audio/eq-fit's FitBand / @audio/eq-parametric's ParametricBand. */
export interface CorrectBand {
	type: 'peak' | 'lowshelf' | 'highshelf'
	fc: number
	Q: number
	gain: number
}

export interface CorrectOptions {
	/** sample rate, Hz. Default 44100 */
	fs?: number
	/**
	 * target curve: a named preset, custom `{f, gain}[]` control points, a `f => dB`
	 * function, or `{freqs, db}` (e.g. a measured Harman headphone target). Default 'flat'
	 */
	target?: TargetPreset | CurvePoint[] | ((f: number) => number) | CurveData
	/** lowest corrected frequency, Hz — below it, correction tapers to 0 dB over 1/3 octave. Default 20 */
	fMin?: number
	/** highest corrected frequency, Hz — above it, correction tapers to 0 dB over 1/3 octave. Default 20000 */
	fMax?: number
	/** fractional-octave smoothing of the measured curve before correction. REW default 1/6 for room EQ; use 1/12 for headphones. Default 1/6 */
	smoothOct?: number
	/** maximum boost, dB, after Kirkeby regularization. Default 6 */
	maxBoost?: number
	/** maximum cut, dB. Default 20 */
	maxCut?: number
	/**
	 * Kirkeby & Nelson (1999) regularization constant λ: correction = dev·|H|²/(|H|²+λ) in
	 * linear magnitude, so deep nulls in the measured response aren't boosted toward
	 * maxBoost. 0 disables regularization (naive target − measured inversion). Default 0.1
	 */
	regularization?: number
	/**
	 * level alignment before computing deviation: `'auto'` mean-matches the measured
	 * curve's in-band level to the target's; a number is a fixed dB offset added to the
	 * measured curve instead (e.g. a known calibration offset). Default 'auto'
	 */
	level?: 'auto' | number
	/** which correction(s) to produce. Default 'fir' */
	mode?: 'fir' | 'parametric' | 'both'
	/** FIR length in taps (forced odd — see @audio/eq-fir). Default 4095 */
	taps?: number
	/** max parametric band count (fewer if @audio/eq-fit's tolerance is met early). Default 10 */
	bands?: number
	/**
	 * convert the FIR from linear-phase to minimum-phase via real-cepstrum folding
	 * (Oppenheim & Schafer §12) — same magnitude response, near-zero group delay instead
	 * of (taps−1)/2 samples. Requires mode 'fir' or 'both'. Default false
	 */
	minPhase?: boolean
}

export interface CorrectResult {
	/** working-grid frequencies, Hz (log-spaced, ~10 Hz to Nyquist) */
	freqs: Float32Array
	/** measured curve, dB: fractional-octave smoothed and level-aligned to target */
	measured: Float32Array
	/** target curve, dB, sampled onto `freqs` */
	target: Float32Array
	/** designed correction, dB per `freqs` entry — after regularization, boost/cut limits and band-edge taper */
	correction: Float32Array
	/** linear-phase (or, if `minPhase`, minimum-phase) FIR coefficients. Present for mode 'fir' | 'both' */
	coefs?: Float64Array
	/** fitted parametric bands, sorted by `fc`. Present for mode 'parametric' | 'both' */
	bands?: CorrectBand[]
	/** headroom make-up gain, dB (≤ 0), paired with `bands`. Present for mode 'parametric' | 'both' */
	preamp?: number
	/** target − (measured + realized correction), dB per `freqs` entry */
	residual: Float32Array
	/** RMS of `residual` over [fMin, fMax], dB */
	rms: number
	/** peak positive correction actually applied, dB (≤ opts.maxBoost) */
	maxBoost: number
}

/**
 * Design a correction EQ from a measured response and a target curve.
 * `measured` is an impulse response (`Float32Array`/`Float64Array`, using `opts.fs`), the
 * `@audio/measure-response` shape `{freqs, db}`, or `{f, gain}[]` control points (e.g. a
 * captured headphone/speaker magnitude curve).
 *
 * Always async: `mode: 'parametric'` dynamically imports `@audio/eq-fit` (an optional
 * peer — install it to unlock parametric/both modes; 'fir' mode never needs it).
 */
export default function correct(
	measured: Float32Array | Float64Array | CurveData | CurvePoint[],
	opts?: CorrectOptions
): Promise<CorrectResult>

/**
 * Apply a correct() result to a buffer in place: `firEq` with `result.coefs` (FIR/both
 * modes) or `@audio/eq-parametric` with `result.bands` + `result.preamp` (parametric/both —
 * FIR takes priority when both are present). Dynamically imports `@audio/eq-fir` or
 * `@audio/eq-parametric` as needed. Throws if `result` has neither `coefs` nor `bands`.
 */
export function apply<T extends Float32Array | Float64Array>(
	data: T,
	result: CorrectResult,
	opts?: { fs?: number }
): Promise<T>

/**
 * Equalizer APO / AutoEQ `ParametricEQ.txt` text for a parametric result — delegates to
 * `@audio/eq-fit`'s `toEqualizerApo`. `null` when `result.bands` is absent (FIR-only mode).
 */
export function toEqualizerApo(result: CorrectResult): Promise<string | null>

/**
 * Export `result.coefs` as a 32-bit float mono WAV impulse — loadable as a convolution EQ
 * in Equalizer APO, Roon, or CamillaDSP. Requires mode 'fir' or 'both'.
 */
export function toWavIr(result: CorrectResult, opts?: { fs?: number }): Promise<Uint8Array>

// Lossy-transcode detection — is this "lossless" file really lossless, or an
// upsampled/transcoded MP3/AAC/Vorbis/Opus source?
//
// Method (Spek / aucdtect / lossless-audio-checker class — visual spectrogram-cutoff
// inspection turned into a numeric estimator):
//   1. LTAS (Welch, @audio/spectral-ltas) over the analysed span, plus a per-frame
//      max-hold spectrum (highest level ever seen per bin — catches sparse transients
//      the averaged LTAS smears down).
//   2. Cutoff: highest frequency where the smoothed LTAS drops >= minDrop dB relative
//      to the band 2 kHz below and stays down to Nyquist (sustained, not a notch).
//      Max-hold re-runs the same test and arbitrates: it sits at-or-above the LTAS
//      curve everywhere, so it only ever raises the estimate — confirming a true
//      brick-wall filter (transients obey it too) or overriding a spurious LTAS-only
//      "cutoff" caused by sparse high-frequency content averaging low.
//      Edge sharpness (dB/oct over the transition) separates an encoder's steep
//      lowpass (psychoacoustic codecs: >60 dB/oct) from a microphone/tape's gentle
//      natural roll-off.
//   3. Spectral holes: per-frame "swiss cheese" gaps in 4-16 kHz, MP3's classic
//      low-bitrate bit-starvation signature (Hennequin et al. 2017; Yang et al. 2008).
//   4. sfb21 signature: a narrow notch centred near 16 kHz independent of the overall
//      cutoff — MP3's last long-block scalefactor band is chronically bit-starved even
//      well above the nominal lowpass (the classic "fake lossless" tell used by
//      lossless-audio-checker / "Fakin' the Funk").
//   5. Upsample check: cutoff sitting at a clean fraction of fs (8/11.025/12/16/22.05/
//      24/32 kHz half-rates) with a near-ideal brick wall — a resampled-then-padded
//      source, not a bitrate-driven codec lowpass.
//
// Citations:
//   - T. Beck (ff123) et al., aucdtect / lossless-audio-checker heuristics —
//     https://github.com/lifestream1/lossless-audio-checker (spectrogram-cutoff +
//     sfb21 heuristics distilled into a batch tool).
//   - "Fakin' the Funk" write-ups (Chris's / hydrogenaudio "guessers") — the
//     original visual spectrogram-cutoff method this package numerically reproduces.
//   - R. Hennequin, J. Royo-Letelier, M. Moussallam, "Codec-independent lossy audio
//     compression detection", ICASSP 2017 — spectral-hole / frame-periodicity idea.
//   - D. Yang et al., "Detecting MP3 compression history", 2008 — MDCT/scalefactor-band
//     starvation as compression-history evidence.
//   - ISO/IEC 11172-3 (MPEG-1 Layer III) and the LAME encoder's built-in lowpass
//     table (`lame.h` / `bitrate.c` defaults) for the bitrate -> cutoff mapping below.
//
// Honesty: a naturally band-limited recording (cassette dub, a narrow-band mic, an
// aggressive de-esser) can look exactly like a lossy cutoff to a purely spectral
// test. `evidence` exposes every number so a caller/UI can judge, and `confidence`
// is a heuristic score, not a calibrated probability.

import ltas from '@audio/spectral-ltas'
import { fft } from 'fourier-transform'

// bitrate/quality -> cutoff (Hz), source encoders' own lowpass filters.
// MP3: LAME's internal table (lame/bitrate.c `default_lowpass_freq`, kbps -> Hz),
// stereo/joint-stereo defaults. AAC-LC: typical FDK/Apple/Fraunhofer TNS-band cutoffs.
// Vorbis: aoTuVb/libvorbis -q lowpass floors. Opus: SILK/CELT band-limit by bitrate
// (bitrate < 128 kbps commonly runs a bandwidth-limited mode below fullband).
//
// `source` is a best-effort label, not a certified match — real encoders vary by
// version, preset, and bitrate-control mode (CBR/ABR/VBR). This package's own test
// corpus (test.js), built with @audio/encode-mp3's bundled wasm-media-encoders/LAME
// in bitrate-only CBR mode, measures its 64 kbps fixture at ~16.5 kHz — a full table
// row higher than the classic default_lowpass_freq figure below — and 96 kbps and up
// land within a few hundred Hz of fs/2 (no measurable lowpass at all against this
// signal). Treat `cutoff`/`evidence` as the ground truth; `source` as a rough guess.
const SOURCE_TABLE = [
	{ name: 'mp3-64', hz: 12500 },
	{ name: 'mp3-96', hz: 15500 },
	{ name: 'mp3-128', hz: 16500 },
	{ name: 'mp3-160', hz: 17800 },
	{ name: 'mp3-192', hz: 18800 },
	{ name: 'mp3-256', hz: 19700 },
	{ name: 'mp3-320', hz: 20500 },
	{ name: 'aac-96', hz: 15000 },
	{ name: 'aac-128', hz: 16800 },
	{ name: 'aac-256', hz: 19500 },
	{ name: 'ogg-q3', hz: 15500 },
	{ name: 'ogg-q5', hz: 18000 },
	{ name: 'ogg-q6', hz: 19500 },
	{ name: 'opus-64', hz: 13500 },
	{ name: 'opus-96', hz: 20000 },
	{ name: 'opus-128', hz: 20000 },
]

// Common "half original sample rate" targets an upsampled source lands on.
const UPSAMPLE_TARGETS = [4000, 5512.5, 6000, 8000, 9600, 11025, 12000, 16000]

// No codec's lowpass — nor any format worth "detecting as lossy" here — sits
// below this for full-band material (even 32-64 kbps mono speech codecs target
// well above telephone bandwidth, ~3.4 kHz). Floors the edge search so a strong
// bass fundamental 2 kHz below a candidate bin can't masquerade as a "reference
// level" for a bogus low-frequency cutoff.
const MIN_CUTOFF_HZ = 6000

const hann = N => {
	const w = new Float64Array(N)
	for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))
	return w
}

const lin2db = x => 20 * Math.log10(Math.max(x, 1e-30))

// Boxcar-smooth a dB-per-bin curve (radius in bins) — damps comb-filter ripple and
// single-bin FFT noise ahead of edge-finding, without blurring a genuine encoder
// transition band (a few hundred Hz to ~1 kHz wide, much larger than the ~100 Hz
// smoothing radius used below).
function smooth (db, radiusBins) {
	const n = db.length
	if (radiusBins < 1) return db
	const prefix = new Float64Array(n + 1)
	for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + db[i]
	const out = new Float32Array(n)
	for (let i = 0; i < n; i++) {
		const lo = Math.max(0, i - radiusBins), hi = Math.min(n - 1, i + radiusBins)
		out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1)
	}
	return out
}

// Median level over a frequency band (Hz) — robust to a single strong harmonic
// line skewing the read. A fixed offset (e.g. "2 kHz below") can, in real music,
// coincide with a bass fundamental; the median of a band around it shrugs that
// off where a point read or a mean would not.
function bandLevel (db, centerHz, halfWidthHz, binHz) {
	const c = centerHz / binHz
	const lo = Math.max(0, Math.round(c - halfWidthHz / binHz))
	const hi = Math.min(db.length - 1, Math.round(c + halfWidthHz / binHz))
	if (hi <= lo) return db[Math.max(0, Math.min(db.length - 1, Math.round(c)))]
	const slice = Array.from(db.subarray(lo, hi + 1)).sort((a, b) => a - b)
	return slice[slice.length >> 1]
}

// Median of db[loBin..hiBin] inclusive — same robustness, for a bin range.
function medianRange (db, loBin, hiBin) {
	loBin = Math.max(0, loBin); hiBin = Math.min(db.length - 1, hiBin)
	if (hiBin <= loBin) return db[Math.max(0, Math.min(db.length - 1, loBin))]
	const slice = Array.from(db.subarray(loBin, hiBin + 1)).sort((a, b) => a - b)
	return slice[slice.length >> 1]
}

const REF_BAND_HZ = 300 // half-width of the "2 kHz below" reference band
const SHARP_THRESH = 60 // dB/oct — encoder lowpass vs natural roll-off (method note 2)
const HOLES_THRESH = 2 // holes/sec — calibrated against the mp3-64 test corpus (see test.js)

// Highest frequency where the (smoothed) db curve drops >= minDrop dB relative to
// the band 2 kHz below, sustained (median of the tail) all the way to Nyquist.
// Returns { bin, drop, ref } — bin = half (Nyquist), drop = 0 when no such edge exists.
// `startBin` resumes the scan partway up (used to extend an already-found edge).
function findEdge (db, binHz, minDrop, startBin = 0) {
	const half = db.length - 1
	const refOffsetBins = Math.max(1, Math.round(2000 / binHz))
	const minBin = Math.round(MIN_CUTOFF_HZ / binHz)
	for (let k = Math.max(refOffsetBins, minBin, startBin); k <= half; k++) {
		const ref = bandLevel(db, (k - refOffsetBins) * binHz, REF_BAND_HZ, binHz)
		const cur = db[k]
		if (ref - cur < minDrop) continue
		const tailLevel = medianRange(db, k, half)
		if (ref - tailLevel >= minDrop) return { bin: k, drop: ref - cur, ref }
	}
	return { bin: half, drop: 0, ref: bandLevel(db, (half - refOffsetBins) * binHz, REF_BAND_HZ, binHz) }
}

// dB/oct slope over a one-octave band centred on `f` (half-octave either side),
// capped at Nyquist — a filter this close to fs/2 has no measurable band beyond it.
function edgeSharpness (db, binHz, f, nyquist) {
	if (f <= 0) return 0
	const lo = f / Math.SQRT2, hi = Math.min(f * Math.SQRT2, nyquist)
	if (hi <= lo) return 0
	const dLo = bandLevel(db, lo, 50, binHz), dHi = bandLevel(db, hi, 50, binHz)
	return (dLo - dHi) / (Math.log2(hi / lo) || 1)
}

// Narrow notch centred near 16 kHz, independent of the overall cutoff — MP3's
// chronically bit-starved sfb21 (long-block scalefactor band ~15.8-16.5 kHz, per
// ISO/IEC 11172-3 Table B.8 layer-III band boundaries).
function detectSfb21 (db, binHz, nyquist) {
	if (nyquist < 17500) return false // no headroom above sfb21 to see the notch recover
	const lo = bandLevel(db, 14500, 150, binHz)
	const mid = bandLevel(db, 16000, 150, binHz)
	return (lo - mid) >= 8
}

export default function lossy (data, opts = {}) {
	const fs = opts.fs || 44100
	const frameSize = opts.frameSize || 4096
	const hop = opts.hop || frameSize >> 1
	const floorDb = opts.floorDb ?? -90
	const minDrop = opts.minDrop ?? 20
	const maxSeconds = opts.maxSeconds ?? 120

	const mono = downmix(data)
	const half = frameSize >> 1
	const binHz = fs / frameSize
	const freqs = new Float32Array(half + 1)
	for (let k = 0; k <= half; k++) freqs[k] = k * binHz

	const analysed = pickSpan(mono, fs, maxSeconds)

	if (analysed.length < frameSize) {
		return emptyResult(freqs, fs)
	}

	// LTAS (Welch), reused from @audio/spectral-ltas — the mean magnitude spectrum.
	const ltasMag = ltas(analysed, { frameSize, hop })
	const ltasDb = new Float32Array(half + 1)
	for (let k = 0; k <= half; k++) ltasDb[k] = lin2db(ltasMag[k])

	// Max-hold spectrum + spectral-hole tracking, one shared per-frame pass.
	const { maxDb, holesPerSec } = frameScan(analysed, fs, frameSize, hop, floorDb)

	// Smoothed working curves for edge-finding (~100 Hz boxcar — see `smooth`).
	const smoothRadius = Math.max(1, Math.round(100 / binHz))
	const ltasSmooth = smooth(ltasDb, smoothRadius)
	const maxSmooth = smooth(maxDb, smoothRadius)

	// Cutoff: LTAS edge is primary — it's what a spectrogram-cutoff read (Spek/
	// aucdtect) actually looks at. Max-hold is the tie-breaker, not a second vote:
	// it sits at-or-above the LTAS curve at every bin (max over frames >= mean), so
	// it is only consulted to check whether the LTAS edge is a real brick wall
	// (transients obey it too — `hardWall`) or just a statistical dip (sparse HF
	// content averaging low while transients keep punching through). Only in the
	// latter case does the search resume, from the LTAS edge onward, on the
	// max-hold curve — so max-hold can extend the estimate toward Nyquist but can
	// never reset a genuine low cutoff back up because one transient (a click, a
	// cymbal hit) briefly leaked past the filter.
	const edgeLtas = findEdge(ltasSmooth, binHz, minDrop)
	let cutoffBin = edgeLtas.bin, cutoffDb = edgeLtas.drop
	if (cutoffBin < half) {
		const maxTail = medianRange(maxSmooth, cutoffBin, half)
		const hardWall = (edgeLtas.ref - maxTail) >= minDrop / 2
		if (!hardWall) {
			const edgeMax = findEdge(maxSmooth, binHz, minDrop, cutoffBin)
			cutoffBin = edgeMax.bin
			cutoffDb = edgeMax.bin < half ? edgeMax.drop : cutoffDb
		}
	}
	const cutoff = cutoffBin >= half ? fs / 2 : freqs[cutoffBin]
	const sharpness = edgeSharpness(ltasSmooth, binHz, cutoff, fs / 2)
	const sfb21 = detectSfb21(ltasSmooth, binHz, fs / 2)
	const bandwidthRatio = cutoff / (fs / 2)

	// Upsample vs codec-lowpass ambiguity: both can land a cutoff anywhere in
	// ~11-20 kHz, so a frequency match alone isn't enough — mp3-64 in this
	// package's own test corpus measures ~16.5 kHz (see test.js), which would
	// collide with a "16 kHz source" target. Gate on cutoff/Nyquist ratio too:
	// no codec table entry measured here sits below ~35% of Nyquist, so that
	// band is reserved for genuine sample-rate bandlimiting.
	const upsampled = cutoff < 0.35 * fs &&
		UPSAMPLE_TARGETS.some(target => Math.abs(cutoff - target) / target < 0.05)

	const isLossy = (cutoff < 0.44 * fs && sharpness > SHARP_THRESH) || holesPerSec > HOLES_THRESH || upsampled

	let confidence
	if (upsampled) {
		confidence = 0.9
	} else {
		const cutoffMargin = clamp01((0.44 * fs - cutoff) / (0.44 * fs))
		const sharpMargin = clamp01((sharpness - SHARP_THRESH) / SHARP_THRESH)
		const holeMargin = clamp01(holesPerSec / (HOLES_THRESH * 3))
		// Any one strong signal (a clear edge, a steep edge, or dense holes) is
		// enough to be confident — requiring all three at once (a product) makes
		// otherwise-obvious calls (a codec cutoff just under the 0.44·fs gate,
		// but with a textbook-steep edge) score as near-zero confidence.
		confidence = isLossy
			? clamp01(Math.max(cutoffMargin, sharpMargin, holeMargin))
			: clamp01(1 - Math.max(cutoffMargin, holeMargin * 0.5))
	}

	const source = classify(cutoff, isLossy, holesPerSec, upsampled, fs)

	return {
		cutoff,
		lossy: isLossy,
		confidence,
		source,
		evidence: { cutoffDb, sfb21, cutoffSharpness: sharpness, holes: holesPerSec, upsampled, bandwidthRatio },
		spectrum: { freqs, db: ltasDb },
	}
}

function clamp01 (x) { return x < 0 ? 0 : x > 1 ? 1 : x }

function classify (cutoff, isLossy, holesPerSec, upsampled, fs) {
	if (upsampled) return 'upsampled'
	// !isLossy already implies holesPerSec <= HOLES_THRESH (or it would've tripped
	// the verdict) — "no holes" per the method note means "not enough to register",
	// not literally zero (natural FFT/frame noise never quite reaches zero).
	if (!isLossy) return cutoff >= 0.45 * fs && holesPerSec < HOLES_THRESH ? 'lossless' : 'unknown'
	let best = null, bestDist = Infinity
	for (const s of SOURCE_TABLE) {
		const d = Math.abs(cutoff - s.hz)
		if (d < bestDist) { bestDist = d; best = s }
	}
	return best && bestDist <= 500 ? best.name : 'unknown'
}

// Downmix Float32Array[] (multichannel) or pass through a mono Float32Array.
function downmix (data) {
	if (data instanceof Float32Array) return data
	const chans = data
	const n = chans[0]?.length || 0
	if (chans.length === 1) return chans[0]
	const mono = new Float32Array(n)
	for (const ch of chans) for (let i = 0; i < n; i++) mono[i] += ch[i] / chans.length
	return mono
}

// Analyse at most maxSeconds of audio, evenly sampled across the file (so a
// silent/fading intro or outro doesn't stand in for the whole take).
function pickSpan (mono, fs, maxSeconds) {
	const maxLen = Math.floor(maxSeconds * fs)
	if (mono.length <= maxLen) return mono
	const CHUNKS = 8
	const chunkLen = Math.floor(maxLen / CHUNKS)
	const out = new Float32Array(chunkLen * CHUNKS)
	const stride = (mono.length - chunkLen) / (CHUNKS - 1)
	for (let c = 0; c < CHUNKS; c++) {
		const start = Math.round(c * stride)
		out.set(mono.subarray(start, start + chunkLen), c * chunkLen)
	}
	return out
}

// Single per-frame pass: max-hold spectrum (highest level ever seen per bin) +
// spectral-hole density (Hennequin et al. 2017 / Yang et al. 2008 class: bins that
// dip far below their neighbours' interpolation and persist across frames).
function frameScan (data, fs, frameSize, hop, floorDb) {
	const half = frameSize >> 1
	const binHz = fs / frameSize
	const win = hann(frameSize)
	const buf = new Float64Array(frameSize)
	const maxMag = new Float64Array(half + 1)

	// hole scan band: 4-16 kHz (method note 3)
	const loBin = Math.max(2, Math.round(4000 / binHz))
	const hiBin = Math.min(half - 2, Math.round(16000 / binHz))
	const nbr = Math.max(2, Math.round(150 / binHz)) // neighbour-interpolation offset
	const streak = new Int16Array(half + 1)
	let holeEvents = 0
	let frames = 0
	const mag = new Float64Array(half + 1)

	for (let pos = 0; pos + frameSize <= data.length; pos += hop) {
		for (let i = 0; i < frameSize; i++) buf[i] = data[pos + i] * win[i]
		const [re, im] = fft(buf)
		for (let k = 0; k <= half; k++) {
			const m = Math.sqrt(re[k] * re[k] + im[k] * im[k])
			mag[k] = m
			if (m > maxMag[k]) maxMag[k] = m
		}
		for (let k = loBin; k <= hiBin; k++) {
			const expected = (lin2db(mag[k - nbr]) + lin2db(mag[k + nbr])) / 2
			const isHole = mag[k] > 0 && lin2db(mag[k]) <= expected - 25 && expected > floorDb
			if (isHole) {
				streak[k]++
				if (streak[k] === 3) holeEvents++
			} else streak[k] = 0
		}
		frames++
	}

	const maxDb = new Float32Array(half + 1)
	for (let k = 0; k <= half; k++) maxDb[k] = lin2db(maxMag[k])
	const seconds = frames ? (frames * hop + frameSize) / fs : 0
	return { maxDb, holesPerSec: seconds > 0 ? holeEvents / seconds : 0 }
}

function emptyResult (freqs, fs) {
	return {
		cutoff: NaN,
		lossy: false,
		confidence: 0,
		source: 'unknown',
		evidence: { cutoffDb: 0, sfb21: false, cutoffSharpness: 0, holes: 0, upsampled: false, bandwidthRatio: NaN },
		spectrum: { freqs, db: new Float32Array(freqs.length) },
	}
}

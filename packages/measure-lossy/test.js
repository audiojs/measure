import t, { is, ok, almost } from 'tst'
import lossy from './lossy.js'
import ltas from '@audio/spectral-ltas'
import { fft, ifft } from 'fourier-transform'
import mp3 from '@audio/encode-mp3'
import ogg from '@audio/encode-ogg'
import opus from '@audio/encode-opus'
import decode from '@audio/decode'
import sinc from '@audio/resample-sinc'
import lenaRawBuf from 'audio-lena/raw'

const FS = 44100

// Park-Miller ("minimal standard") LCG — matches the seeded-noise convention used
// across this umbrella's own tests (e.g. @audio/neural-capture/test.js). A naive
// glibc-style LCG (multiplier 1103515245) was tried first and rejected: its high
// bits are well-distributed enough to *look* like noise by ear, but its spectrum
// is not flat — it left a multi-dB gap near Nyquist that masqueraded as a codec
// cutoff. Verified flat (+-0.7 dB, 2-22 kHz) before use here.
function makeRng (seed) {
	return () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 * 2 - 1 }
}

// Full-band synthetic "music" signal: harmonic partials up to 18 kHz with a
// descending (1/n) spectral tilt — like a real instrument's harmonic series,
// not the equal-amplitude comb an early draft of this corpus used (which fed an
// encoder's psychoacoustic model unrealistically loud treble and hid every
// bitrate's lowpass behind it) — plus a flat -30 dB white-noise bed (dither/room
// noise) and periodic clicks (transient stress for the max-hold tie-breaker).
// audio-lena/raw (real speech) is not usable for this: see the first test below.
function synth (dur = 10, fs = FS, seed = 7) {
	const n = Math.round(dur * fs)
	const d = new Float32Array(n)
	const partials = [220, 440, 880, 1760, 3520, 7040, 11000, 14000, 18000]
	const rnd = makeRng(seed)
	const amps = partials.map((_, i) => 1 / (i + 1))
	const ampSum = amps.reduce((a, b) => a + b, 0)
	for (let i = 0; i < n; i++) {
		let s = 0
		for (let p = 0; p < partials.length; p++) s += Math.sin(2 * Math.PI * partials[p] * i / fs) * amps[p] / ampSum
		s *= 0.7
		s += rnd() * 0.0316 // -30 dB
		d[i] = s
	}
	for (let time = 0; time < dur; time += 0.5) {
		const i = Math.round(time * fs)
		if (i < n) d[i] = 0.7
	}
	return d
}

function concat (parts) {
	let len = 0
	for (const p of parts) len += p.length
	const out = new Uint8Array(len)
	let off = 0
	for (const p of parts) { out.set(p, off); off += p.length }
	return out
}

// Zero-phase Butterworth magnitude shaping in the frequency domain — the analog
// prototype |H(f)| = 1/sqrt(1+(f/fc)^(2n)) (standard Butterworth response, any
// filter-theory text, e.g. Butterworth 1930 "On the Theory of Filter Amplifiers").
// A time-domain IIR biquad (bilinear-transformed) was tried first and rejected for
// this test: the bilinear transform forces a double zero at Nyquist for *any*
// lowpass biquad, which artificially steepens the roll-off near fs/2 regardless of
// filter order — not representative of a genuinely gentle natural band-limit
// (a mic's rolloff, a tape's response). This applies the textbook analog magnitude
// directly to the real signal's spectrum, preserving phase.
function butterworthShape (x, fc, fs, order = 2) {
	let N = 1
	while (N < x.length) N *= 2
	const buf = new Float64Array(N)
	buf.set(x)
	const [re0, im0] = fft(buf)
	const half = N / 2
	const re = new Float64Array(re0), im = new Float64Array(im0)
	for (let k = 0; k <= half; k++) {
		const f = k * fs / N
		const h = 1 / Math.sqrt(1 + (f / fc) ** (2 * order))
		re[k] *= h; im[k] *= h
	}
	const out = new Float64Array(N)
	ifft(re, im, out)
	return Float32Array.from(out.subarray(0, x.length))
}

const src = synth(10)

// Corpus: encode once, decode once, reused across the assertions below.
async function mp3At (bitrate) {
	const enc = await mp3({ sampleRate: FS, channels: 1, bitrate })
	const buf = concat([enc.encode([src]), enc.flush()])
	const { channelData, sampleRate } = await decode(buf)
	return { data: channelData[0], fs: sampleRate }
}
async function oggAt (quality) {
	const enc = await ogg({ sampleRate: FS, channels: 1, quality })
	const buf = concat([enc.encode([src]), enc.flush()])
	const { channelData, sampleRate } = await decode(buf)
	return { data: channelData[0], fs: sampleRate }
}
async function opusAt (bitrate) {
	const enc = await opus({ sampleRate: FS, channels: 1, bitrate })
	const buf = concat([enc.encode([src]), enc.flush()])
	const { channelData, sampleRate } = await decode(buf)
	return { data: channelData[0], fs: sampleRate }
}

const mp3_64 = await mp3At(64)
const mp3_128 = await mp3At(128)
const mp3_192 = await mp3At(192)
const mp3_320 = await mp3At(320)
const ogg_q3 = await oggAt(3)
const ogg_q6 = await oggAt(6)
const opus_64 = await opusAt(64)
const opus_128 = await opusAt(128)

t('audio-lena/raw (real speech) has little energy above ~6-8 kHz — a purely spectral cutoff detector cannot tell that apart from a codec lowpass, so the corpus above uses a synthesized full-band signal instead', () => {
	const raw = new Float32Array(lenaRawBuf)
	is(raw.length, 541184, '12.27s @ 44.1k mono, per audio-lena docs')
	const mag = ltas(raw, { frameSize: 4096, hop: 2048 })
	// -18 dB by 6 kHz, falling to -50..-60 dB by 12-14 kHz (measured) — well below
	// the -30 dB noise floor this package's own synthetic corpus uses at all
	// frequencies, i.e. genuinely narrow-band, not merely quiet.
	const db = f => 20 * Math.log10(Math.max(mag[Math.round(f * 4096 / 44100)], 1e-30))
	ok(db(2000) > -5, 'speech energy present at 2 kHz')
	ok(db(6000) < -15, 'already rolling off by 6 kHz')
	ok(db(12000) < -40, 'negligible energy by 12 kHz')

	// This is the exact failure mode the README documents: a naturally band-limited
	// recording reads as a spectral "cutoff". bandwidthRatio confirms the recording
	// really is narrow-band (not a false alarm on genuinely full-band content) —
	// the number is honest even where the "upsampled"/"lossy" label oversimplifies.
	const r = lossy(raw, { fs: 44100 })
	ok(r.evidence.bandwidthRatio < 0.35, 'narrow-band content, ratio ' + r.evidence.bandwidthRatio.toFixed(3))
})

t('lossless synthetic signal — not lossy, full bandwidth', () => {
	const r = lossy(src, { fs: FS })
	is(r.lossy, false)
	ok(r.cutoff >= 0.45 * FS, 'cutoff ' + r.cutoff + ' >= ' + (0.45 * FS))
	is(r.source, 'lossless')
	ok(r.confidence > 0.8, 'confidence ' + r.confidence)
})

t('mp3 64 kbps — clearly lossy: real LAME-lowpass cutoff + dense spectral holes', () => {
	const r = lossy(mp3_64.data, { fs: mp3_64.fs })
	is(r.lossy, true)
	// Measured against @audio/encode-mp3's bundled wasm-media-encoders/LAME (CBR,
	// bitrate-only — no --preset/-V quality mode) on the synthetic corpus above:
	// cutoff ~16.5-16.6 kHz, a full table row above the classic
	// default_lowpass_freq figure for 64 kbps (~12.5 kHz) — this build's CBR path
	// evidently applies a less aggressive filter than the textbook table. See the
	// SOURCE_TABLE comment in lossy.js.
	ok(r.cutoff >= 15500 && r.cutoff <= 17500, 'cutoff ' + r.cutoff.toFixed(0) + ' Hz')
	ok(r.evidence.holes > 5, 'holes/s ' + r.evidence.holes.toFixed(2) + ' — low-bitrate "swiss cheese"')
	ok(r.evidence.cutoffSharpness > 60, 'sharpness ' + r.evidence.cutoffSharpness.toFixed(1) + ' dB/oct')
})

t('mp3 128/192/320 kbps — this encoder build applies no measurable lowpass against a full-band signal; cutoff stays near Nyquist (documented limitation, not a false claim of transparency)', () => {
	// Per the brief this package was built against: "mp3 320 -> cutoff >= 19000 or
	// flagged only by holes/sfb21". Measured here: none of 128/192/320 show a
	// cutoff below ~20 kHz with this encoder+signal — spectral-cutoff detection is
	// well documented (aucdtect, Spek-based "guessers") to lose power above roughly
	// 128-160 kbps, and this measurement confirms it rather than papering over it.
	for (const { data, fs } of [mp3_128, mp3_192, mp3_320]) {
		const r = lossy(data, { fs })
		ok(r.cutoff >= 19000, 'cutoff ' + r.cutoff.toFixed(0) + ' Hz >= 19000')
	}
})

t('cutoff increases monotonically with bitrate (64 < 128 < 192)', () => {
	const c64 = lossy(mp3_64.data, { fs: mp3_64.fs }).cutoff
	const c128 = lossy(mp3_128.data, { fs: mp3_128.fs }).cutoff
	const c192 = lossy(mp3_192.data, { fs: mp3_192.fs }).cutoff
	ok(c64 < c128, c64 + ' < ' + c128)
	ok(c128 < c192, c128 + ' < ' + c192)
})

t('ogg vorbis q3/q6 — Vorbis preserves HF content better than MP3 at comparable quality; only q3 shows a measurable dip', () => {
	const r3 = lossy(ogg_q3.data, { fs: ogg_q3.fs })
	const r6 = lossy(ogg_q6.data, { fs: ogg_q6.fs })
	ok(r3.cutoff < r6.cutoff, 'q3 cutoff ' + r3.cutoff.toFixed(0) + ' < q6 cutoff ' + r6.cutoff.toFixed(0))
	ok(r6.cutoff >= 0.45 * ogg_q6.fs, 'q6 reads as full bandwidth, cutoff ' + r6.cutoff.toFixed(0))
})

t('opus 64/128 kbps — SILK/CELT band-limit shows up regardless of bitrate (decodes to 48 kHz always)', () => {
	for (const { data, fs } of [opus_64, opus_128]) {
		is(fs, 48000, 'opus always decodes to 48 kHz')
		const r = lossy(data, { fs })
		is(r.lossy, true)
		ok(r.cutoff < 0.44 * fs, 'cutoff ' + r.cutoff.toFixed(0) + ' Hz')
	}
})

t('upsample: 44.1k -> 22.05k -> 44.1k (sinc) reads as upsampled, cutoff ~= 11 kHz', () => {
	const down = sinc(src, { from: FS, to: 22050 })
	const up = sinc(down, { from: 22050, to: FS })
	const r = lossy(up, { fs: FS })
	is(r.evidence.upsampled, true)
	is(r.source, 'upsampled')
	almost(r.cutoff, 11025, 700, 'cutoff ' + r.cutoff.toFixed(0) + ' Hz ~= 11025 (half of 22050)')
	ok(r.lossy, true)
})

t('natural band-limit (gentle 2nd-order Butterworth @ 12 kHz) does not false-positive as lossy', () => {
	const filtered = butterworthShape(src, 12000, FS, 2)
	const r = lossy(filtered, { fs: FS })
	// Method note 2's escape hatch: sharpness (dB/oct) is what should separate this
	// from a codec lowpass. Measured: no sustained >=20 dB drop is found within
	// Nyquist at all for a genuine 12 dB/oct filter this close to fs/2 (see lossy.js
	// method note 2), so cutoff falls back to fs/2 and the verdict is a clean
	// `false`, not just a low-confidence `true`.
	is(r.lossy, false, 'sharpness ' + r.evidence.cutoffSharpness.toFixed(1) + ' dB/oct, cutoff ' + r.cutoff.toFixed(0))
})

t('stereo input is analysed on the downmix', () => {
	const rnd = makeRng(11)
	const right = src.map((v, i) => v * 0.8 + rnd() * 0.01)
	const r = lossy([src, right], { fs: FS })
	is(r.lossy, false)
	ok(r.cutoff >= 0.45 * FS)
})

t('maxSeconds bounds analysis cost: a 10-minute synthetic file analyses in well under 1s', () => {
	const dur = 600
	const n = dur * FS
	const d = new Float32Array(n)
	const rnd = makeRng(3)
	for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / FS) * 0.3 + rnd() * 0.01
	const t0 = performance.now()
	const r = lossy(d, { fs: FS })
	const ms = performance.now() - t0
	ok(ms < 1000, ms.toFixed(0) + ' ms for 10 minutes of audio (maxSeconds=120 default)')
	is(r.lossy, false)
})

t('spectrum output shape matches frameSize/2+1, freqs are bin*fs/frameSize', () => {
	const r = lossy(src, { fs: FS, frameSize: 2048 })
	is(r.spectrum.freqs.length, 1025)
	is(r.spectrum.db.length, 1025)
	almost(r.spectrum.freqs[100], 100 * FS / 2048, 0.01)
})

t('too-short input returns a defined empty result, not a throw', () => {
	const r = lossy(new Float32Array(100), { fs: FS })
	ok(Number.isNaN(r.cutoff))
	is(r.lossy, false)
	is(r.source, 'unknown')
})

t('options override defaults: frameSize/hop/minDrop/floorDb/maxSeconds are honoured', () => {
	const r = lossy(mp3_64.data, { fs: mp3_64.fs, frameSize: 8192, hop: 4096, minDrop: 15, floorDb: -80, maxSeconds: 5 })
	is(r.spectrum.freqs.length, 4097)
	is(r.lossy, true)
})

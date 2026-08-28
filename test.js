import test, { almost, ok, is } from 'tst'
import { ir, latency, align, response } from './index.js'
import chirp from '@audio/synth-chirp'

const fs = 44100

test('ir — ESS deconvolution recovers a known multi-tap system', () => {
	let sweep = chirp({ f0: 20, f1: 20000, duration: 1.5, fs })
	// known system: taps at 0 (1.0), 220 (0.5), 800 (−0.25)
	let TAPS = [[0, 1], [220, 0.5], [800, -0.25]]
	let recorded = new Float32Array(sweep.length + 1000)
	for (let [d, g] of TAPS) for (let i = 0; i < sweep.length; i++) recorded[i + d] += g * sweep[i]
	let h = ir(recorded, { sweep, f0: 20, f1: 20000, fs, length: 1000 })
	for (let [d, g] of TAPS) almost(h[d], g, 0.03, 'tap @' + d + ' = ' + h[d].toFixed(3))
	let stray = 0
	for (let i = 0; i < 1000; i++) if (i > 12 && Math.abs(i - 220) > 12 && Math.abs(i - 800) > 12) stray = Math.max(stray, Math.abs(h[i]))
	ok(stray < 0.05, 'noise floor ' + stray.toFixed(3))
})

test('ir — identity system yields unit impulse', () => {
	let sweep = chirp({ f0: 20, f1: 20000, duration: 1, fs })
	let h = ir(Float32Array.from(sweep), { sweep, f0: 20, f1: 20000, fs, length: 256 })
	almost(h[0], 1, 0.01, 'δ height ' + h[0].toFixed(4))
})

test('latency — detects an exact 1234-sample loopback delay', () => {
	let refSig = chirp({ f0: 200, f1: 4000, duration: 0.25, fs })
	let rec = new Float32Array(refSig.length + 4000)
	for (let i = 0; i < refSig.length; i++) rec[i + 1234] = 0.6 * refSig[i]
	let r = latency(rec, refSig, { fs })
	is(r.samples, 1234)
	ok(r.confidence > 20, 'confident peak')
})

test('align — recovers delay and inverted polarity, applies correction', () => {
	let a = chirp({ f0: 300, f1: 3000, duration: 0.3, fs })
	let b = new Float32Array(a.length)
	for (let i = 0; i < a.length - 300; i++) b[i + 300] = -0.8 * a[i]
	let r = align(a, b, { fs, apply: true })
	is(r.delay, 300)
	is(r.polarity, -1)
	// aligned b should now correlate positively with a at lag 0
	let dot = 0
	for (let i = 0; i < a.length; i++) dot += a[i] * r.aligned[i]
	ok(dot > 0, 'aligned in phase')
})

test('response — one-pole IR matches its analytic magnitude', () => {
	let a = 0.9, n = 4096
	let h = new Float32Array(n)
	for (let i = 0; i < n; i++) h[i] = (1 - a) * a ** i
	let { freqs, db } = response(h, { fs, n: 8192 })
	let analytic = f => {
		let w = 2 * Math.PI * f / fs
		return 20 * Math.log10((1 - a) / Math.hypot(1 - a * Math.cos(w), a * Math.sin(w)))
	}
	for (let f of [100, 1000, 8000]) {
		let k = Math.round(f * 8192 / fs)
		almost(db[k], analytic(freqs[k]), 0.5, f + ' Hz: ' + db[k].toFixed(2) + ' vs ' + analytic(freqs[k]).toFixed(2))
	}
})

// ── @audio/quality ──
import { snr, segSnr, lsd, spectralSim, modulationDepth } from '@audio/quality'

test('quality — identical signals score perfect', () => {
  let x = new Float32Array(44100)
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5
  is(snr(x, x), Infinity, 'snr Infinity')
  ok(segSnr(x, x) >= 35 - 1e-9, 'segSnr at clamp ceiling')
  ok(lsd(x, x) < 1e-9, 'lsd 0')
  ok(Math.abs(spectralSim(x, x) - 1) < 1e-9, 'spectralSim 1')
})

test('quality — added noise degrades snr/lsd monotonically', () => {
  let n = 44100
  let clean = new Float32Array(n), noisy = new Float32Array(n), noisier = new Float32Array(n)
  let rnd = (s => () => (s = s * 16807 % 2147483647) / 2147483647 - 0.5)(1)
  for (let i = 0; i < n; i++) {
    clean[i] = Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5
    let e = rnd()
    noisy[i] = clean[i] + e * 0.01
    noisier[i] = clean[i] + e * 0.1
  }
  ok(snr(clean, noisy) > snr(clean, noisier), 'more noise = lower snr')
  ok(lsd(clean, noisy) < lsd(clean, noisier), 'more noise = higher lsd')
  ok(snr(clean, noisy) > 25, 'light noise still high snr')
})

test('quality — modulationDepth flags tremolo', () => {
  let n = 44100 * 2, sr = 44100
  let steady = new Float32Array(n), trem = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = Math.sin(2 * Math.PI * 440 * i / sr)
    steady[i] = s * 0.5
    trem[i] = s * 0.5 * (1 + 0.5 * Math.sin(2 * Math.PI * 8 * i / sr))
  }
  ok(modulationDepth(steady, [440], sr) < 0.02, 'steady tone ~0')
  ok(modulationDepth(trem, [440], sr) > 0.2, 'tremolo detected')
})

// -- 2026-08 atoms: lossy (transcode detection) + correct (response correction); depth lives in each package's suite --
import { lossy, correct } from './index.js'
import { peaking, process as biquadProcess } from '@audio/biquad'

test('lossy — full-band synthetic reads lossless; a brick-walled copy reads lossy with the cutoff located', () => {
  let n = 4 * fs, full = new Float32Array(n)
  let seed = 7, rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * 2 - 1
  for (let i = 0; i < n; i++) full[i] = 0.3 * rnd()
  let a = lossy(full, { fs })
  ok(!a.lossy && a.cutoff > 0.45 * fs, 'white noise: lossless verdict, cutoff ' + a.cutoff.toFixed(0))
  // hard lowpass at 16 kHz in the frequency domain (an encoder-style wall)
  let cut = 16000, r = lossy(brickwall(full, cut), { fs })
  ok(r.lossy && Math.abs(r.cutoff - cut) < 1000, 'walled: lossy verdict, cutoff ' + r.cutoff.toFixed(0))
  function brickwall (x, fc) { // overlap-add STFT zeroing above fc
    let N = 4096, hop = N / 2, out = new Float32Array(x.length), win = new Float32Array(N)
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)
    for (let pos = 0; pos + N <= x.length; pos += hop) {
      let re = new Float64Array(N), im = new Float64Array(N)
      for (let i = 0; i < N; i++) re[i] = x[pos + i] * win[i]
      fftInPlace(re, im, false)
      let kc = Math.round(fc / fs * N)
      for (let k = kc; k <= N - kc; k++) { re[k] = 0; im[k] = 0 }
      fftInPlace(re, im, true)
      for (let i = 0; i < N; i++) out[pos + i] += re[i] / N * win[i]
    }
    return out
  }
  function fftInPlace (re, im, inv) { // radix-2, in place
    let n = re.length
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] } }
    for (let len = 2; len <= n; len <<= 1) {
      let ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang)
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
        let ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi
        let t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t } }
    }
  }
})

test('correct — flattens a peaked room response with a linear-phase FIR within the boost limit', async () => {
  // room = +8 dB bell at 120 Hz (Q 3) applied to an impulse
  let ir = new Float32Array(8192); ir[0] = 1
  biquadProcess(ir, peaking(120, 3, fs, 8))
  let r = await correct(ir, { fs, target: 'flat', mode: 'fir', taps: 4095, maxBoost: 6 })
  ok(r.coefs instanceof Float64Array && r.coefs.length === 4095, 'FIR designed')
  ok(r.rms < 1, 'in-band residual rms ' + r.rms.toFixed(2) + ' dB')
  let atPeak = r.correction[r.freqs.findIndex(f => f >= 120)]
  ok(atPeak < -5 && atPeak > -9, 'correction at 120 Hz ' + atPeak.toFixed(1) + ' dB')
  ok(r.maxBoost <= 6 + 1e-6, 'boost clamp')
})

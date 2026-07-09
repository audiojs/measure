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

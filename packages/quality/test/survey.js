// twof on pairs of 16-bit WAV files at 48 kHz (<name>.ref.wav, <name>.out.wav): the declipping survey's 70 clipped SQAM
// pairs as survey.py writes them, or music.js's. Equal within 1e-9 to the 2f score of PQevalAudio's two measures
// (<measures.json>: survey.py's output, or pqevalaudio.json), and within `bound` of 100 (0.1) of a second
// implementation's, seabass-2f (seabass-values.py's output). Exit 1 otherwise.
//   node packages/quality/test/survey.js <pairs> <measures.json> <seabass.json> [bound]
import { readFileSync } from 'node:fs'
import { twof } from '../index.js'

const [dir, a, b, bound = 0.1] = process.argv.slice(2), json = f => JSON.parse(readFileSync(f, 'utf8')).cases, port = json(a), second = json(b)
const wav = f => { let d = readFileSync(f), at = d.indexOf('data', 12) + 8; return Float64Array.from({ length: (d.length - at) >> 1 }, (_, i) => d.readInt16LE(at + 2 * i) / 32768) }
// the model's line, Kastner and Herre 2019
const score = ([m, adb]) => Math.min(100, Math.max(0, 56.1345 / (1 + (-0.0282 * m - 0.8628) ** 2) - 27.1451 * adb + 86.3515))
let names = Object.keys(port), worst = [0, 0], lo = Infinity, hi = -Infinity
for (let name of names) {
	let v = twof(wav(`${dir}/${name}.ref.wav`), wav(`${dir}/${name}.out.wav`), 48000)
	worst = [Math.max(worst[0], Math.abs(v - score(port[name]))), Math.max(worst[1], Math.abs(v - second[name]))]
	lo = Math.min(lo, v); hi = Math.max(hi, v)
}
console.log(`${names.length} pairs scoring ${lo.toFixed(1)} to ${hi.toFixed(1)}: largest difference from PQevalAudio ${worst[0].toExponential(1)}, from seabass-2f ${worst[1].toFixed(4)}`)
process.exit(names.length && worst[0] <= 1e-9 && worst[1] <= +bound ? 0 : 1)

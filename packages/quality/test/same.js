// The largest difference between the numbers of two reference files (pystoi.json, pqevalaudio.json): the committed
// one and one made again by its "made" command. Exit 1 past `bound` (1e-9, the tests' own), or where a number is missing.
//   node packages/quality/test/same.js <committed.json> <made.json> [bound]
import { readFileSync } from 'node:fs'

let [a, b] = process.argv.slice(2, 4).map(f => JSON.parse(readFileSync(f))), bound = +(process.argv[4] ?? 1e-9), worst = 0, n = 0, missing = []
const walk = (x, y, path) => {
  if (typeof x === 'number') { if (typeof y !== 'number') return missing.push(path); n++; worst = Math.max(worst, Math.abs(x - y)); return }
  if (x && typeof x === 'object') for (let k in x) walk(x[k], y?.[k], `${path}.${k}`)
}
for (let k of ['cases', 'rates']) if (a[k]) { walk(a[k], b[k], k); walk(b[k], a[k], k) }
console.log(`${n / 2} numbers, largest difference ${worst.toExponential(1)}${missing.length ? `, missing: ${missing.slice(0, 5).join(', ')}` : ''}`)
process.exit(worst <= bound && !missing.length && n ? 0 : 1)

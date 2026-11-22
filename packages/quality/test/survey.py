# The port twof's reference values come from, held to MATLAB's own: the declipping survey of Zaviska, Rajmic, Ozerov and
# Rencker (IEEE JSTSP 15(1), 2021) published the PEAQ grades P. Kabal's PQevalAudio gave its 70 clipped inputs (ten
# EBU SQAM excerpts, each clipped to 1, 3, 5, 7, 10, 15 and 20 dB SDR). audiojs/audio's bench/rx/peaq.py, run as its
# header says, must give them again: this exits 1 unless 68 of the 70 grades are within 1e-4 and all within 2e-3 (its
# header: 44 within 1e-6, 58 within 1e-5, 68 within 1e-4, the largest 1.4e-3).
# It then writes each pair at 48 kHz on 16-bit steps (scipy's resample_poly, 160/147) to <pairs>, and prints the port's
# two measures of each, [AvgModDiff1B, ADBB], for survey.js to hold twof to on recorded instruments.
#   python packages/quality/test/survey.py <survey> <audio>/bench/rx <pairs> > <survey.json>
# <survey>: Sounds/*.wav and Numerical_results/PEAQ_declippingResults.mat of github.com/rajmic/declipping2020_codes
# (at 9b6c0e3); the sounds are EBU's (SQAM, Tech 3253) and stay there: none is committed here.
import sys, os, json, math
import numpy as np
from scipy.io import loadmat, wavfile
from scipy.signal import resample_poly

data, port, pairs = sys.argv[1:4]
sys.path.insert(0, port)
from peaq import odg

os.makedirs(pairs, exist_ok=True)
SDRS = [1, 3, 5, 7, 10, 15, 20]
published = loadmat(os.path.join(data, 'PEAQ_declippingResults.mat'))['PEAQ_clipped']  # sounds by name × SDRS
names = sorted(f[:-4] for f in os.listdir(data) if f.endswith('.wav'))
assert published.shape == (len(names), len(SDRS)) == (10, 7)
sdr = lambda x, y: 20 * math.log10(np.linalg.norm(x) / np.linalg.norm(x - y))

def level(x, db):
    """The survey's Tools/clip_sdr.m: the threshold in (0, 0.99 max|x|) that leaves `db` dB SDR"""
    a, b = 0.0, 0.99 * np.abs(x).max()
    for _ in range(200):
        m = (a + b) / 2
        if sdr(x, np.clip(x, -m, m)) < db: a = m
        else: b = m
    return (a + b) / 2

steps = lambda v: np.floor(np.clip(resample_poly(v, 160, 147), -1, 32767 / 32768) * 32768).astype(np.int16)
cases, off = {}, []
for i, name in enumerate(names):
    fs, w = wavfile.read(os.path.join(data, name + '.wav'))
    assert fs == 44100 and w.dtype == np.int16 and w.ndim == 1
    x = w / 32768
    for j, db in enumerate(SDRS):
        t = level(x, db); y = np.clip(x, -t, t)
        off.append(abs(odg(x, y, 44100)[0] - published[i, j]))
        r, o = steps(x), steps(y)
        wavfile.write(os.path.join(pairs, f'{name}-{db}.ref.wav'), 48000, r)
        wavfile.write(os.path.join(pairs, f'{name}-{db}.out.wav'), 48000, o)
        movs = odg(r / 32768, o / 32768, 48000)[1]
        cases[f'{name}-{db}'] = [float(movs['AvgModDiff1B']), float(movs['ADBB'])]

off = np.array(off)
grades = {'cases': len(off), 'within 1e-6': int((off < 1e-6).sum()), 'within 1e-5': int((off < 1e-5).sum()), 'within 1e-4': int((off < 1e-4).sum()), 'largest': float(off.max())}
print(json.dumps({'grades against the survey\'s': grades, 'cases': cases}, indent=1))
print(grades, file=sys.stderr)
sys.exit(0 if grades['within 1e-4'] >= 68 and grades['largest'] < 2e-3 else 1)

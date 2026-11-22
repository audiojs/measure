# The two ear-model measures of the pairs music.js writes, as P. Kabal's PQevalAudio computes them: the values
# test.js holds twof to. Computed by audiojs/audio's bench/rx/peaq.py, a numpy port of PQevalAudio that its header
# holds to the published numbers of the declipping survey of Zaviska et al. (2021); only its outputs are used here.
#   node packages/quality/test/music.js <dir> && python packages/quality/test/pqevalaudio.py <dir> <audio>/bench/rx > packages/quality/test/pqevalaudio.json
import sys, os, glob, json, platform
import numpy as np
from scipy.io import wavfile

d, port = sys.argv[1], sys.argv[2]
sys.path.insert(0, port)
from peaq import odg

# "rates": the same samples read as sound at another rate, which the port brings to 48 kHz as MATLAB's resample does
# (the survey's numbers were made so at 44.1 kHz); twof resamples by another filter, and is held near these
RATES = [44100, 16000, 96000]
measures = lambda x, y, fs: [float(m[k]) for m in [odg(x / 32768, y / 32768, fs, pcm16=False)[1]] for k in ('AvgModDiff1B', 'ADBB')]

cases, rates = {}, {fs: {} for fs in RATES}
for f in sorted(glob.glob(os.path.join(d, '*.ref.wav'))):
    name = os.path.basename(f)[:-len('.ref.wav')]
    fs, x = wavfile.read(f)
    _, y = wavfile.read(os.path.join(d, name + '.out.wav'))
    assert fs == 48000 and x.dtype == np.int16 and y.dtype == np.int16
    cases[name] = measures(x, y, fs)
    for r in RATES: rates[r][name] = measures(x, y, r)

head = {'made': 'node packages/quality/test/music.js <dir> && python packages/quality/test/pqevalaudio.py <dir> <audio>/bench/rx > packages/quality/test/pqevalaudio.json',
        'reference': "PQevalAudio (P. Kabal, v1r0), as ported in audiojs/audio bench/rx/peaq.py; each case: [AvgModDiff1B, ADBB]",
        'numpy': np.__version__, 'python': platform.python_version()}
rows = lambda c, pad: ',\n'.join(f'{pad}{json.dumps(k)}: {json.dumps(v)}' for k, v in c.items())
print('{\n' + ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in head.items()) + ',\n  "cases": {\n' + rows(cases, '    ') + '\n  },\n  "rates": {\n' +
      ',\n'.join(f'    "{r}": {{\n{rows(c, "      ")}\n    }}' for r, c in rates.items()) + '\n  }\n}')

# pystoi's STOI and ESTOI of the pairs speech.js writes: the values test.js holds stoi and estoi to.
#   node packages/quality/test/speech.js <dir> && python packages/quality/test/pystoi.py <dir> > packages/quality/test/pystoi.json
# pip install pystoi==0.4.1 (github.com/mpariente/pystoi at 74872b0, MIT; it brings numpy and scipy)
import sys, os, glob, json, platform
from importlib.metadata import version
import numpy as np
from scipy.io import wavfile
from pystoi import stoi

assert version('pystoi') == '0.4.1', 'pystoi 0.4.1 is the reference'
d, cases = sys.argv[1], {}
for f in sorted(glob.glob(os.path.join(d, '*.clean.wav'))):
    name = os.path.basename(f)[:-len('.clean.wav')]
    fs, x = wavfile.read(f)
    _, y = wavfile.read(os.path.join(d, name + '.out.wav'))
    x, y = x.astype(np.float64), y.astype(np.float64)
    # ESTOI adds noise of EPS before it normalizes (utils.py row_col_normalize): seeded, a run gives the same file
    np.random.seed(0)
    cases[name] = [stoi(x, y, fs), stoi(x, y, fs, extended=True)]

head = {'made': 'node packages/quality/test/speech.js <dir> && python packages/quality/test/pystoi.py <dir> > packages/quality/test/pystoi.json',
        'pystoi': '0.4.1 (74872b0)', 'numpy': np.__version__, 'scipy': version('scipy'), 'python': platform.python_version()}
print('{\n' + ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in head.items()) + ',\n  "cases": {\n' +
      ',\n'.join(f'    {json.dumps(k)}: {json.dumps(v)}' for k, v in cases.items()) + '\n  }\n}')

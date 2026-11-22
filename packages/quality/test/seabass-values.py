# A second implementation's 2f score of each pair survey.py writes: seabass-2f 0.1.0 (Karn Watcharasupat,
# github.com/kwatcharasupat/2f-model), its own Python port of PQevalAudio, called as a black box.
#   pip install seabass-2f==0.1.0 && python packages/quality/test/seabass-values.py <pairs> > <seabass.json>
import sys, os, glob, json, warnings
warnings.filterwarnings('ignore')
from importlib.metadata import version
from seabass.core.models.mms import estimated_mean_mushra_score_file

assert version('seabass-2f') == '0.1.0'
cases = {}
for ref in sorted(glob.glob(os.path.join(sys.argv[1], '*.ref.wav'))):
    cases[os.path.basename(ref)[:-len('.ref.wav')]] = float(estimated_mean_mushra_score_file(ref[:-len('.ref.wav')] + '.out.wav', ref))
print(json.dumps({'seabass-2f': '0.1.0', 'cases': cases}, indent=1))

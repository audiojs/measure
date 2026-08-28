// stat manifest — lossy-transcode detection over the mono-folded take.

import lossyFn from './lossy.js'

export const lossy = {
	stat: 'lossy',
	compute: (channels, { sampleRate, ...opts }) => lossyFn(channels, { fs: sampleRate, ...opts }),
}

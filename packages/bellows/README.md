# bellowsjs

A browser-native audio engine for synthesis, samples, sequencing, analysis, and I/O. One clock, one DSP kernel in an AudioWorklet, seeded and reproducible everywhere.

BELLOWS ships synthesis engines across the whole field (virtual analog, FM, additive, wavetable, granular, physical modeling, west coast, formant, drums, harmonic-plus-noise), a soundfont core (SF2, SFZ), a theory layer with arbitrary tuning, generative sequencing (Euclidean, Markov, L-systems, cellular automata), time-domain and spectral effects, analysis (pitch, onset, key, EBU R128 loudness), and offline rendering that matches realtime exactly.

```js
import { play } from 'bellowsjs';
play('pluck', 'C4');
```

This version is a name claim while 0.1.0 is finalized. The full library, its documentation, and a live workbench are landing at the repository below.

- Repository: https://github.com/virgilvox/bellowsjs
- License: Apache-2.0

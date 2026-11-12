# Third-party notices

bellowsjs is licensed under MIT (see LICENSE). Parts of it are ported from, or learned
from, the software below, which is distributed under its own license. The notice for each is
reproduced here because the build strips source comments from the executable bundles, so the
headers in the source files do not reach their code. Each bundle (`dist/bellows.js`,
`dist/bellows.standalone.js`, `dist/worklet.js`) opens instead with a one-line banner naming
bellowsjs's license and CHIMERA's copyright and MIT license and pointing here; the shipped
source maps quote the sources whole, headers included.

## CHIMERA

CHIMERA, a physical-model voice synthesizer by Jameson Hodge.
https://github.com/jamesondh/chimera-vocal-synth

Copyright (c) 2026 Jameson Hodge

Everything below was taken from CHIMERA at commit `1d3ea49`. Where a TypeScript original is
named, it is the engine CHIMERA deleted in commit `cd247a6`, readable at `cd247a6^:src/engine`.

### Ported from CHIMERA

These files are translations of CHIMERA's code. Each one starts with a header naming the
CHIMERA file it came from and what was changed.

| bellows file | CHIMERA source |
| --- | --- |
| `src/dsp/glottal.ts` | `crates/chimera/src/sources/glottis.rs`, the drift in `math.rs`, the voice mapping in `voice/human_voice.rs` (TypeScript original `sources/glottis.ts`) |
| `src/lyrics/ipa.ts` | `crates/chimera/src/phonetics/ipa.rs` (`phonetics/ipa.ts`) |
| `src/lyrics/arpabet.ts` | `crates/chimera/src/phonetics/english.rs` (`phonetics/english.ts`) |
| `src/lyrics/letter-to-sound.ts` | `crates/chimera/src/phonetics/english.rs` (`phonetics/english.ts`) |
| `src/lyrics/english.ts` | `crates/chimera/src/phonetics/english.rs` and `syllables.rs` (`phonetics/english.ts`, `phonetics/syllables.ts`) |
| `src/lyrics/syllabify.ts` | `crates/chimera/src/phonetics/syllables.rs` (`phonetics/syllables.ts`) |
| `src/lyrics/read.ts` | `crates/chimera/src/phonetics/syllables.rs` (`phonetics/syllables.ts`) |
| `src/lyrics/durations.ts` | the consonant durations of `crates/chimera/src/phonetics/inventory.rs` (`phonetics/inventory.ts`) |
| `src/lyrics/types.ts` | the Segment and Syllable model of `crates/chimera/src/phonetics/mod.rs` and the FrontEnd trait of `syllables.rs` (`phonetics/syllables.ts`, `phonetics/planner.ts`) |
| `src/dsp/area-rate.ts` | the area rate limit, `crates/chimera/src/voice/human_airway.rs:151-156, 190-262`, applied to the junction airway's grid sections and their sub-section minima |
| `src/engines/vocal-geometry.ts` | the midsagittal geometry, `crates/chimera/src/anatomy/human.rs` 276-278 (body constants), 421-439 (NEUTRAL), 507-519 (constants), 644-692 (landmarks, area law, template-to-body map), 725-1263 (`compute`: jaw, velum, outer wall, lips, tongue, inner wall, grid rays, contact model, lip contact, area laws, spike clamp, lateral channel, centreline), 1266-1282 (`epilarynx_area`), 1287-1374 (`resample` with sub-section minima), 1398-1490 (`project_on`, `point_along`, `signed_gap`, `closest_approach`); `anatomy/geom.rs` (polar, rotate_about, ray_polyline, crossing_t, ray_crossings, bezier3, bezier2, arc, catmull_rom, tangent_angle); `math.rs` 89-158. Changes: preallocated point lists, results in scratch fields, a body set in place, drawing-only outputs left out |

In the repository only, `test/lyrics/chimera-golden.test.ts` carries cases converted from
CHIMERA's golden fixtures (`crates/chimera/tests/golden/phonetics-*.json`), and the lyric
tests beside it quote CHIMERA's behaviour to show where the port differs. Tests are not
published to npm.

### Techniques learned from CHIMERA and reimplemented

These files contain no CHIMERA code. They follow an approach, a rule or a set of values found
in CHIMERA, written again in bellows' own idiom, and they say so in their headers.

| bellows file | what follows CHIMERA |
| --- | --- |
| `src/lyrics/sing.ts` | the sung timing rules: vowel on the beat, onsets borrowing from the previous note, proportional consonant squeeze (`phonetics/sing.rs`) |
| `src/dsp/critdamp.ts` | critically damped tracking of articulation targets (`control/articulators.rs`) |
| `src/engines/vocal.ts` | the articulators and their speeds (`control/articulators.rs`), the contact rule (`voice/human_voice.rs:520-552`), the sung breath (`phonetics/planner.rs:376-379`), the vibrato bloom (`phonetics/sing.rs`), the voice's wiring of planner, geometry and airway |
| `src/engines/vocal-planner.ts` | the gestural planner: vowel overlap ramps, a consonant's dominant, secondary, velar-place and alveolar-fronting gestures with their lead, early and release-hold times and speeds by manner, the affricate split, the tap, the nasal velum gesture, the glottal and voiceless abduction rules and the end of the breath group, and the blend of gestures with the rest posture (`phonetics/planner.rs:24, 88-108, 196-390, 532-577`, `control/score.rs:273-430`, `voice/human_voice.rs:445`), planned online here |
| `src/engines/vocal-roof.ts` | the roof polylines (from `anatomy/human.rs`), the template-to-body transform (`human.rs:685`), the tip kept outside the tongue body (`human.rs:828`) |
| `src/engines/vocal-drive.ts` | CHIMERA's section counts (`voice/human_airway.rs:75-80`), the area rate law on each keyframe (`human_airway.rs:190-262`), the jet rule of the smallest sub-section minimum (`airway/network.rs:919-930`), the anatomical moving-wall flow (`airway/network.rs` node continuity) |
| `src/dsp/junction-airway.ts` | the airway's elements: trachea 12 k cm by 2.5 k^2 and the lungs' resistance, the nasal profile, the glottal port (kinetic 0.37, slit 1.4 k, depth 0.3 k) and the velum port (length 1.0 k, kinetic 0.3 and 0.8), perimeter and viscous factors and wall radiation 0.25 (`voice/human_airway.rs:84-123`); viscous resistance at 700 Hz, closed area 2e-4, Borda-Carnot loss with a 0.1 contraction loss, the 60 Hz moving-wall filter, the Flanagan radiators (`airway/network.rs:360, 417, 866, 919-930, 1067-1068`); the three turbulence sources, their placement and weights, the Reynolds law and the glottal band (`voice/human_airway.rs` `update_noise`, `:271`, `airway/network.rs:1097-1130`); the voicing gate (`sources/glottis.rs:170-176`); the effort mapping (`voice/human_voice.rs:317-350`); the output gain (`human_voice.rs:220`). The formulation (a waveguide at Courant number 1 with the flow solved in its junctions) and the Strouhal-scaled source spectrum are bellows' own |
| `src/dsp/airway-tube.ts` | the fixed tubes' wall and viscous elements (`airway/network.rs:860-1010`), lumped onto a few nodes here |
| `src/dsp/air.ts` | the physical constants and wall tissues (`physics.rs:5-35`) |
| `src/engines/vocal-tables.gen.ts` and `data/vocal/` | CHIMERA's articulator ranges and speeds, rest posture, inventory and calibrated targets, body constants and roofs, and tables measured on its geometry: the formant-tuning rows and the layout lengths (`data/vocal/README.md`) |
| `src/engines/vocal-phonemes.ts` | the phoneme classes checked against `phonetics/inventory.rs`, and the stop release rules, no aspiration after /s/, 12 ms when unaspirated, aspiration only before a vowel (`phonetics/planner.rs`) |

`src/lyrics/ipa-front-end.ts` and `src/lyrics/cmudict.ts` were written for bellows; they use
the ported tokenizer and syllabifier and read the dictionary formats CHIMERA reads.

Published research keeps its own credit, given in the files that use it: for the
articulatory voice, the digital waveguide (J. O. Smith, Physical Audio Signal Processing) and
the Kelly-Lochbaum scattering junction (Kelly and Lochbaum 1962) behind `src/dsp/junction-airway.ts`,
Jongman, Wayland and Wong (2000) for the fricative spectra its noise is calibrated against, Pink
Trombone (Neil Thapen) as the proof that such a tract runs in a browser, Story (2005) for the
parametric area model behind the design, Saitou, Unoki and Akagi (2005) for sung pitch with
overshoot and preparation (`src/dsp/pitchglide.ts`), Sundberg for the singer's formant and
Joliveau, Smith and Wolfe (2004) for first-resonance tuning on high notes (`src/engines/vocal.ts`),
Krug et al. (2021) for the onset rise after voiceless consonants; Klatt (1980) and Gold and
Rabiner (1968) behind the resonators and the higher-pole correction in `src/dsp/resonator.ts`;
Lisker and Abramson (1964) for voice onset times. The consonant
durations are CHIMERA's own values, not a published table; `src/lyrics/durations.ts` says how
they compare with Klatt's.

### No dictionary data

bellows ships no pronouncing dictionary: no CMUdict and no copy of CHIMERA's. `parseCmudict()`
reads a dictionary the caller loads, and `Bellows.dictionary` or the `dictionary` option of
`sing()` takes the resulting map. Without one, words go through letter-to-sound rules.

### License

MIT License

Copyright (c) 2026 Jameson Hodge

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

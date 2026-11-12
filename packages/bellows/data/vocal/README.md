# Source data of the vocal engine

These files are the fitted inputs `scripts/gen-vocal-tract.mjs` turns into
`src/engines/vocal-tables.gen.ts` (`npm run gen:vocal -w packages/bellows`, and
`npm run gen:vocal:check` to confirm the generated file is current). Nothing
here ships; the generated table does.

Everything is CHIMERA's data, or fitted to it: CHIMERA, a physical-model voice
synthesizer by Jameson Hodge, https://github.com/jamesondh/chimera-vocal-synth,
commit `1d3ea49`, MIT license (the notice is in `THIRD_PARTY_NOTICES.md`). The
data was extracted by running CHIMERA's own code with a scratch program
(`crates/chimera/examples/tract_dump.rs`, not upstream) in the integration's
scratch workspace, and fitted there with numpy and scipy; neither the extractor
nor the fit ships.

| file | what it is | how it was made |
| --- | --- | --- |
| `chimera-articulation.json` | CHIMERA's articulatory control as CHIMERA defines it: the 17 articulators with their ranges and natural frequencies (`control/articulators.rs:23`), the rest posture, the inventory of every consonant with its dominant articulators (`phonetics/inventory.rs`), the calibrated targets per body (`inventory.rs:259`, the vowel targets as `phonetics/planner.rs:74` reads them), and the planner's gesture rules with file and line | read from CHIMERA's source and tables at 1d3ea49 |
| `bodies.json` | per body CHIMERA's scale, pharynx factor, tongue radius and lip width (`anatomy/human.rs:276-278`), and the roof of the mouth (the velum from the uvula tip, then the hard palate to the incisors) as a polyline in body cm, which the contact rule projects onto | extracted from CHIMERA's geometry at 1d3ea49; the geometry itself is ported exactly in `src/engines/vocal-geometry.ts` |
| `tuning-table.json` | per body and vowel, the first resonance R1 of the posture, how far R1 moves per unit of opening (jaw +1, tongue body -1, lips +0.5), the vowel's jaw, and R1 at the largest opening (1.5) | finite differences through the earlier fitted map and waveguide tract's static response, in the prototype; kept for the junction airway (the geometry they describe is the same CHIMERA geometry) |
| `layout.json` | per body the shortest glottis-to-lips length any frame needs (CHIMERA's postures and every voiced frame of its telemetry for the comparison phrases), and the neutral posture's pharynx and total length, which set the section count and place the velum and the piriform fossa | measured over CHIMERA's postures and telemetry in the prototype |

The articulator map fitted to CHIMERA's geometry (and its 16-bit weights) and the jet ratios
were removed when the engine took CHIMERA's exact geometry instead (`docs/VOICE-2.md`, "The
junction airway"): the tables went from 114.6 KB to 38.9 KB.

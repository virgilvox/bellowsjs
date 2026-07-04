import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'presets',
  title: 'Instrument presets',
  blurb: 'Named, curated instruments: guitars to choirs in one lookup.',
  prev: 'engines',
  next: 'sequencing',
  body: `
By the end of this page you can pull a finished instrument sound by name instead of tuning raw engine parameters.

## What a preset is

A preset pins an engine id to curated parameters, an optional insert effect chain, a gain trim, and a suggested keyboard octave. It is data, not a new engine: you still create the sound with \`b.voice()\`.

\`\`\`js
import { Bellows, getPreset } from 'bellowsjs';

const b = await Bellows.boot({ seed: 'preset-demo' });
const p = getPreset('marimba');

const inst = b.voice(p.engineId, p.params);
if (p.fx) inst.fx(...p.fx);
inst.gain(p.gain ?? 0.8);

inst.note('C4', { dur: '2n', vel: 0.9 });
\`\`\`

\`getPreset(id)\` returns the full \`InstrumentPreset\` and throws on an unknown id. The \`fx\` entries are already in \`{ effectId, params }\` form, so they spread straight into \`instrument.fx()\`. \`octave\` is a suggested keyboard shift: \`bass-guitar\` carries \`-2\`, \`music-box\` carries \`+2\`, so center your note range accordingly.

## Browsing the bank

\`\`\`js
import { INSTRUMENT_PRESETS, presetsByFamily } from 'bellowsjs';

for (const [family, list] of presetsByFamily()) {
  console.log(family, list.map((p) => p.id).join(' '));
}
\`\`\`

\`INSTRUMENT_PRESETS\` is the whole bank as a flat array; \`presetsByFamily()\` groups it in display order. Eight families:

| family | examples |
|--------|----------|
| guitars | \`nylon-guitar\`, \`steel-guitar\`, \`twelve-string\`, \`bass-guitar\`, \`banjo\`, \`koto\`, \`harp\`, \`clavinet\` |
| strings | \`violin\`, \`viola\`, \`cello\`, \`double-bass\`, \`pizzicato-strings\` |
| winds | \`concert-flute\`, \`pan-flute\`, \`clarinet\`, \`recorder\`, \`ocarina\`, \`shakuhachi\` |
| brass | \`trumpet\`, \`trombone\`, \`brass-section\`, \`fm-horn\` |
| keys | \`dx-epiano\`, \`drawbar-organ\`, \`church-organ\`, \`harpsichord\`, \`celesta\`, \`music-box\` |
| mallets | \`marimba\`, \`vibraphone\`, \`glockenspiel\`, \`tubular-bells\`, \`kalimba\`, \`steel-drum\`, \`woodblock\`, \`timpani\` |
| voices | \`choir-aah\`, \`voice-ooh\`, \`whistle\` |
| synth | \`analog-lead\`, \`fat-saw-pad\`, \`acid-bass\`, \`sub-bass\`, \`west-coast-pluck\`, \`motion-pad\`, \`fm-bell-lead\` |

Every preset id, with its engine and effect chain, is listed exactly in [/llm.txt](/llm.txt).

## A small ensemble

\`\`\`js
function build(b, id) {
  const p = getPreset(id);
  const inst = b.voice(p.engineId, p.params);
  if (p.fx) inst.fx(...p.fx);
  inst.gain(p.gain ?? 0.8);
  return inst;
}

const cello = build(b, 'cello');
const harp = build(b, 'harp');

cello.note('C2', { dur: '1m', vel: 0.6 });
harp.chord(['E4', 'G4', 'C5'], { dur: '2n', vel: 0.5 });
\`\`\`

Wrap the three-step recipe once and presets become as cheap to use as raw engines. Presets stay ordinary instruments, so everything on [Playing notes](/docs/playing-notes) and [Effects](/docs/effects) applies unchanged.

## Presets on this site

The INSTRUMENT page in the header plays this exact bank: pick a family, pick a preset, and play it from your keyboard. Internally that page selects engines with ids of the form \`preset:<id>\`, which is site plumbing rather than library API; in your own code, use the \`getPreset\` recipe above.
`,
};

export default page;

import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'engines',
  title: 'Engines',
  blurb: 'The eighteen built-in instruments and how to shape them.',
  prev: 'playing-notes',
  next: 'presets',
  body: `
By the end of this page you can pick an engine for any musical job and reshape it while it plays.

## The mental model

An engine is a voice factory: it knows how to turn a frequency and a velocity into sound, and it exposes a flat set of numeric parameters. Every engine answers the same \`note\`, \`on\`, \`off\`, and \`param\` calls, so engines are interchangeable. A sequence written against one engine plays on any other; swapping the sound is a one-word edit.

\`\`\`js
const inst = b.voice('modal');   // was 'pluck'; the music does not care
inst.note('C4', { dur: '2n' });
\`\`\`

## The roster

Classic synthesis:

| id | what it is |
|----|------------|
| \`va\` | virtual analog: two-shape oscillator with detune and sub, ladder or SVF filter, twin envelopes, per-voice drift |
| \`fm\` | 2 to 6 operator FM with eight DX-style algorithms, feedback, per-operator ratio, level, and fixed frequency |
| \`additive\` | 32 sine partials, each with level, morph target, and detune; one decay shapes the bank |
| \`wavetable\` | mipmapped wavetable with position scanning, envelope-to-position, and an optional filter |

Physical modeling:

| id | what it is |
|----|------------|
| \`pluck\` | extended Karplus-Strong: damping, pick position, excitation type |
| \`string\` | waveguide string that can be plucked or bowed, with body resonance, vibrato, and bow noise |
| \`tube\` | waveguide tube: breath and noise, good for winds |
| \`modal\` | resonator banks in five materials: bar, membrane, bell, glass, wood |

Drums:

| id | what it is |
|----|------------|
| \`kick\` | pitch-swept sine with click and drive |
| \`snare\` | tone plus snap noise |
| \`hat\` | metallic noise burst, closed to open via \`decay\` |
| \`clap\` | multi-burst noise with spread |
| \`tom\` | swept drum with a noise component |

Special voices:

| id | what it is |
|----|------------|
| \`noise\` | filtered noise synth with key tracking, five colors |
| \`westcoast\` | wavefolder into a vactrol-style low-pass gate |
| \`formant\` | vowel synthesis with vibrato and breath |
| \`granular\` | 64-grain clouds over a buffer; see [Soundfonts and samples](/docs/soundfonts-and-samples) |
| \`harmonic\` | harmonic-plus-noise voice with brightness, even/odd balance, and portamento |

Sample-backed engines get ids of the form \`sampler:<bankId>\` and \`granular:<bankId>\` once you register audio with the kernel; the [Soundfonts and samples](/docs/soundfonts-and-samples) page covers them.

## Parameters

\`\`\`js
const synth = b.voice('va', { shape: 2, cutoff: 800, resonance: 0.4 });

synth.param('cutoff', 4000);          // now
synth.param('cutoff', 200, t + 0.5);  // at a scheduled time
\`\`\`

Set params at creation or live with \`param(name, value, at?)\`. Timed changes are sample accurate, so filter moves can sit exactly on the grid. Every engine's exact parameter list, with ranges, defaults, and curve hints, is in the generated reference at [/llm.txt](/llm.txt); the same data drives the LLM REF page in the site header. Ranges are enforced nowhere, so stay inside them.

## Swapping engines under a running sequence

\`\`\`js
const scale = b.scale('C minor');
const ids = ['pluck', 'modal', 'fm', 'westcoast'];
const voices = ids.map((id) => b.voice(id));

b.clock.at('8n', (t, step) => {
  const inst = voices[Math.floor(step / 8) % voices.length]; // new engine every bar
  inst.note({ degree: step % 7, octave: 3 }, { at: t, dur: '8n' }, scale);
});
b.start();
\`\`\`

The same line of degrees walks through four different instruments. This is the interchangeability promise made audible: notes are data, engines are renderers.

## Where next

Curated, named sounds built on these engines live on the [Presets](/docs/presets) page. To write your own engine, the contracts are small; see [Custom DSP](/docs/custom-dsp).
`,
};

export default page;

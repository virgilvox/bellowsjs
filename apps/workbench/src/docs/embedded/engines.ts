import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-engines',
  title: 'Engines',
  blurb: 'The ten ported voices, their Params structs, and what each one costs in flash.',
  prev: 'emb-how-silent',
  next: 'emb-effects',
  body: `
By the end of this page you can pick a C++ engine for a job, set every field it has, and know what including it costs before you build.

## The contract every engine shares

An engine is a plain class. No base class, no virtuals, no registry entry, nothing that self-registers. Every one of them answers the same five calls:

\`\`\`cpp
void Init(float sample_rate);              // some also take an Rng* and a Params
void NoteOn(float freq, float vel);        // freq in Hz, vel 0 to 1
void NoteOff();
void Process(float* l, float* r, int from, int to);
bool Active() const;
\`\`\`

Most also carry \`SetParams(const Params&)\` for changing the sound while it plays. Three do not: \`Snare\`, \`Hat\` and \`Pluck\` set their fields at \`Init\` and are re-inited to change them. Check the class before you reach for it.

Three things follow from the contract and are worth holding on to.

\`Process\` **adds into** the range \`[from, to)\`. It never clears and never writes outside the range, so several voices sum into one block by being called one after another. The caller owns the clear: \`Kernel::Process\` does it, and both platform adapters (\`BellowsAudioStream\` and \`DaisyAudio\`) do it before calling your render.

\`Params\` is a struct with named float fields, not a string map. The defaults in the struct are the browser library's defaults, and the two are compared numerically on every commit. The field names are the browser's names in snake case: \`pitchDecay\` there is \`pitch_decay\` here.

\`Init\` takes the sample rate, and everything derived from it (envelope coefficients, filter cutoffs, delay lengths) is computed there. Take that number from the SDK (\`bellows::TeensySampleRate()\`, \`hw.AudioSampleRate()\`) rather than writing 44100 or 48000 by hand.

The range column in the tables below is the browser's \`ParamSpec\` range, which is what each default was chosen against. The C++ struct enforces nothing. A few engines clamp internally where a bad value would break the DSP rather than just sound wrong: \`Va\` clamps \`shape\` to 0..3 and \`pan\` to -1..1, \`Pluck\` clamps \`decay\` to 0.05..20 and \`pick_pos\` to 0..0.95, \`Hat\` clamps its highpass to 0.45 of the sample rate. Everywhere else, out of range is your problem.

## Ten of eighteen, and which eight are missing

The browser has eighteen engine ids. Ten are ported:

| header | classes |
| --- | --- |
| \`bellows/engines/drums.h\` | \`Kick\`, \`Snare\`, \`Hat\` |
| \`bellows/engines/va.h\` | \`Va\` |
| \`bellows/engines/fm.h\` | \`Fm\` |
| \`bellows/engines/pluck.h\` | \`Pluck<kMinFreqHz, kSampleRate>\` |
| \`bellows/engines/tube.h\` | \`Tube<kMinFreqHz, kSampleRate>\` |
| \`bellows/engines/modal.h\` | \`Modal\` |
| \`bellows/engines/formant.h\` | \`Formant\` |
| \`bellows/engines/westcoast.h\` | \`WestCoast\` |

Not ported, with the reason:

| browser id | why not |
| --- | --- |
| \`additive\`, \`harmonic\` | double-precision phase accumulators, free on Cortex-M7 and six times the flash on a single-precision part |
| \`wavetable\` | 320 KB of generated mipmap, which needs a build step to put it in flash |
| \`granular\` | a buffer to graze on, which means host-side audio |
| \`string\` | 24 body-mode biquads and two delay lines per voice; medium difficulty, not started |
| \`noise\` | small and simply not done yet |
| \`clap\`, \`tom\` | \`drums.ts\` has five drums, \`drums.h\` has three |
| \`sampler:*\`, soundfonts | SF2 and SFZ parsing is host-side work. Parse on a computer and ship a flat binary bank to SD |

This matters when you read the browser docs, because those pages assume two things that stop being true here.

The first is that engines are interchangeable by editing one word. In the browser \`b.voice('modal')\` and \`b.voice('pluck')\` differ by a string, so a sequence written against one plays on any other. Here the engine is a type. Swapping it is a declaration change and a rebuild, and eight of the eighteen have no type to swap to.

The second is that everything in the roster exists. A preset built on \`additive\`, or a part written for \`string\`, has no counterpart on a board. The notes port (degrees, scales, patterns, seeds all cross exactly), the renderer may not.

## Kick

A sine whose pitch falls from \`click_tune\` times the note frequency down to it, through a tanh drive. For kick drums, and for any short pitched thump. It tunes from the note, so a kit is playable up and down the keyboard.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`click_tune\` | 6.0 | 1 to 16 | pitch multiplier at the attack |
| \`pitch_decay\` | 0.05 | 0.005 to 0.5 s | how fast it falls to the note |
| \`decay\` | 0.4 | 0.05 to 2 s | amplitude decay, 60 dB |
| \`drive\` | 2.0 | 0 to 10 | tanh drive |

\`\`\`cpp
#include "bellows/engines/drums.h"

static bellows::Kick kick;

bellows::Kick::Params p;
p.decay = 0.6f;
p.drive = 4.0f;
kick.Init(bellows::TeensySampleRate(), p);
kick.NoteOn(50.0f, 0.9f);
\`\`\`

\`NoteOff\` does not stop the voice, it shortens the tail to 30 ms. Every drum here decays to silence on its own and reports \`Active() == false\` once it is below -80 dB, so a pool reclaims it without anyone lifting a key.

## Snare

Two triangle oscillators at the note and 1.6 times it for the shell, plus white noise through an 1800 Hz highpass for the wires, crossfaded equal power by \`tone\`. Needs an \`Rng*\`, which it keeps by reference.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`tone\` | 0.5 | 0 to 1 | 0 is all shell, 1 is all noise |
| \`decay\` | 0.18 | 0.05 to 1 s | shell decay |
| \`snap\` | 0.15 | 0.02 to 1 s | noise decay |

\`\`\`cpp
static bellows::Rng rng;
static bellows::Snare snare;

rng.Init("kit/snare");
snare.Init(sr, &rng);
snare.NoteOn(180.0f, 0.8f);
\`\`\`

The \`Rng\` is held by pointer and must outlive the voice. Seeding it by label is what makes the board and the browser draw the same noise: \`Rng::Init("a::b")\` here is \`rng('a').fork('b')\` there.

## Hat

Six square oscillators at the 808 metallic ratios (1, 1.4831, 1.8004, 2.5459, 2.6303, 3.8971) summed into a highpass. Closed to open is the \`decay\` field, exactly as in the browser.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`decay\` | 0.08 | 0.02 to 2 s | 0.08 closed, 0.4 and up open |
| \`tone\` | 1.0 | 0.2 to 2 | scales the highpass, 7000 Hz at 1 |

\`\`\`cpp
static bellows::Hat hat;
bellows::Hat::Params p;
p.decay = 0.45f;              // open
hat.Init(sr, p);
hat.NoteOn(300.0f, 0.6f);
\`\`\`

## Va

Two band-limited oscillators plus a square sub, into a ladder or an SVF lowpass with its own ADSR, with a control-rate drift walk. The general-purpose subtractive voice: basses, leads, pads, anything an analog polysynth would cover. Nineteen fields, the most of anything in the library.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`shape\` | 0.0 | 0 to 3 | 0 saw, 1 square, 2 triangle, 3 sine |
| \`detune\` | 7.0 | 0 to 100 cents | oscillator 2 against oscillator 1 |
| \`sub\` | 0.0 | 0 to 1 | square one octave down |
| \`cutoff\` | 9000.0 | 20 to 20000 Hz | filter cutoff |
| \`resonance\` | 0.2 | 0 to 1 | filter resonance |
| \`filter_type\` | 0.0 | 0 to 1 | under 0.5 ladder, else SVF |
| \`env_amount\` | 0.0 | -6 to 6 oct | filter envelope depth |
| \`attack\` | 0.005 | 0 to 10 s | amp envelope |
| \`decay\` | 0.1 | 0 to 10 s | amp envelope |
| \`sustain\` | 0.8 | 0 to 1 | amp envelope |
| \`release\` | 0.2 | 0 to 10 s | amp envelope |
| \`f_attack\` | 0.003 | 0 to 10 s | filter envelope |
| \`f_decay\` | 0.15 | 0 to 10 s | filter envelope |
| \`f_sustain\` | 0.5 | 0 to 1 | filter envelope |
| \`f_release\` | 0.2 | 0 to 10 s | filter envelope |
| \`drift\` | 0.0 | 0 to 1 | per-voice random detune walk |
| \`pan\` | 0.0 | -1 to 1 | equal-power pan |
| \`vel_level\` | 0.5 | 0 to 1 | how much velocity moves level |
| \`vel_filter\` | 0.0 | 0 to 4 oct | how much velocity opens the filter |

\`\`\`cpp
#include "bellows/engines/va.h"

static bellows::Rng rng;
static bellows::Va bass;

bellows::Va::Params p;
p.shape = 1.0f;               // square
p.cutoff = 500.0f;
p.env_amount = 2.0f;          // two octaves of filter sweep
p.f_decay = 0.12f;
rng.Init("bass");
bass.Init(sr, &rng, p);
bass.NoteOn(55.0f, 0.9f);
\`\`\`

Filter coefficients and the drift walk refresh every sixteenth sample, not every sample. That is the control-rate split Mozzi argues for, and it is why a VA voice is affordable at all.

\`Va\` is the largest engine in the library at 28640 bytes, and 16392 of those are the band-limited step tables. See "What they cost" below before you decide that is a lot.

## Fm

Six phase-modulation operators over a table of algorithms: two operators get a serial and a parallel routing, four get the eight TX81Z algorithms, six get DX7 algorithms 1, 5, 16 and 32. For electric pianos, bells, basses, and anything with an inharmonic attack. Thirty fields, twelve global and eighteen per operator.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`ops\` | 4.0 | 2 to 6 | snaps to 2, 4 or 6 |
| \`algorithm\` | 1.0 | 1 to 8 | one based, clamped to the table for the op count |
| \`feedback\` | 0.0 | 0 to 1 | self modulation on the algorithm's feedback operator |
| \`brightness\` | 0.5 | 0 to 2 | velocity exponent on modulation depth; 0 ignores velocity |
| \`attack\` | 0.003 | 0 to 10 s | carrier envelope |
| \`decay\` | 0.3 | 0 to 10 s | carrier envelope |
| \`sustain\` | 0.7 | 0 to 1 | carrier envelope |
| \`release\` | 0.3 | 0 to 10 s | carrier envelope |
| \`m_attack\` | 0.002 | 0 to 10 s | modulator envelope |
| \`m_decay\` | 0.4 | 0 to 10 s | modulator envelope |
| \`m_sustain\` | 0.5 | 0 to 1 | modulator envelope |
| \`m_release\` | 0.2 | 0 to 10 s | modulator envelope |
| \`ratio[6]\` | 1, 1, 1, 1, 1, 1 | 0 to 16 | frequency ratio per operator |
| \`level[6]\` | 1, 0.6, 0.5, 0.4, 0.4, 0.3 | 0 to 1 | output level per operator |
| \`fixed_hz[6]\` | all 0 | 0 to 10000 Hz | fixed frequency; 0 means use the ratio |

\`\`\`cpp
#include "bellows/engines/fm.h"

static bellows::Fm keys;

bellows::Fm::Params p;
p.ops = 6.0f;
p.algorithm = 3.0f;
p.feedback = 0.4f;
p.ratio[1] = 3.5f;            // operator 2, inharmonic
p.level[1] = 0.45f;
keys.Init(sr, p);
keys.NoteOn(220.0f, 0.85f);
\`\`\`

Envelopes are grouped rather than per operator: every carrier shares \`attack\`/\`decay\`/\`sustain\`/\`release\`, every modulator shares the \`m_\` set, and which role an operator has follows the current algorithm's carrier mask. Operators evaluate from the highest index down so a modulator reaches its target within the same sample, the way the DX chips do it.

\`Fm\` uses \`SineOsc\` only, so it never touches the band-limited tables. It is 5384 bytes.

## Pluck

Extended Karplus-Strong. A burst of excitation into a delay line with a one-pole loop filter. For guitars, harps, koto, and every plucked thing. This is the one engine whose flash cost is small and whose RAM cost is a decision.

\`\`\`cpp
template <int kMinFreqHz = 20, int kSampleRate = BELLOWS_SAMPLE_RATE> class Pluck;
\`\`\`

\`kMinFreqHz\` is the lowest note the instance can hold, and it sizes both the delay line and the excitation buffer. That is the whole memory story. The period at the floor is \`kSampleRate / kMinFreqHz\` samples, the delay line holds four more than that plus the four the cubic reader needs, the excitation buffer holds twice the period, and one voice is therefore \`12 * period + 160\` bytes. That formula lands on both figures HARDWARE.md measured, 28960 for \`Pluck<20>\` and 7360 for \`Pluck<80>\`, each of which is the sketch row minus its 1028 bytes of harness.

| \`Pluck<n>\` at 48 kHz | one voice | eight voices |
| --- | --- | --- |
| \`Pluck<20>\` | 28960 B | 226 KB |
| \`Pluck<80>\` | 7360 B | 57.5 KB |
| \`Pluck<110>\` | 5392 B | 42.1 KB |

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`damp\` | 0.35 | 0 to 1 | loop filter, higher is duller |
| \`pick_pos\` | 0.28 | 0 to 0.95 | comb notch from where the string is struck |
| \`excite_type\` | 0.0 | 0 to 1 | 0 noise burst, 1 impulse |
| \`decay\` | 2.5 | 0.05 to 20 s | 60 dB decay while held |
| \`level\` | 0.9 | 0 to 1 | output level |

\`\`\`cpp
#include "bellows/engines/pluck.h"

// 110 Hz floor: two octaves below the part's lowest note, at a fifth
// of the RAM a 20 Hz floor would take.
using String = bellows::Pluck<110>;

static bellows::Rng rng;
static bellows::VoicePool<String, 4> strings;

rng.Init("melody/string");
for (int i = 0; i < 4; ++i) strings.at(i).Init(sr, &rng);
strings.NoteOn(60, 261.63f, 0.8f, frame);
\`\`\`

Pick the floor from the part, not from the keyboard. \`07_Workstation\` uses \`Pluck<110>\` because its melody never goes below 220 Hz, and for four voices that one number is the difference between 21 KB and 113 KB of strings.

A note above \`sr / 8\` or below \`MinFreq()\` is clamped rather than rejected. \`Freq()\` reads back what the voice actually settled on, which is the only way to find out whether the pitch you asked for fits the buffer you gave it.

## Tube

A cylindrical bore after the STK clarinet: a half-period delay line, an inverting two-point reflection filter, and a memoryless reed table driven by breath pressure plus noise. For clarinets and other winds. It sounds while the gate is held and releases on \`NoteOff\`, unlike the drums and the pluck.

Same template shape as \`Pluck\`, and half the memory for the same floor because the bore is a half period:

\`\`\`cpp
template <int kMinFreqHz = 20, int kSampleRate = BELLOWS_SAMPLE_RATE> class Tube;
\`\`\`

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`breath\` | 0.85 | 0 to 1 | pressure into the reed |
| \`noise\` | 0.1 | 0 to 1 | breath noise |
| \`level\` | 0.7 | 0 to 1 | output level |
| \`glide\` | 0.03 | 0 to 0.5 s | legato glide time, equal cents per second |
| \`legato_scratch\` | 0.15 | 0 to 1 | noise cue on a legato move |

\`\`\`cpp
#include "bellows/engines/tube.h"

static bellows::Rng rng;
static bellows::Tube<80> clarinet;

rng.Init("wind");
clarinet.Init(sr, &rng);
clarinet.NoteOn(220.0f, 0.7f);
// ... later, without re-attacking:
clarinet.Glide(246.94f);
\`\`\`

\`Glide(hz)\` is real legato: the breath envelope keeps running and the bore retunes once per block. The browser reaches this through \`setParam('freq', hz)\`; a named method is clearer and costs no string compare.

## Modal

Up to 24 exponentially decaying two-pole resonators excited by a short strike. For marimbas, bells, glass, gongs, and any struck object. The \`material\` field picks a mode table.

| \`material\` | what it is |
| --- | --- |
| 0 | bar, free-free transverse ratios |
| 1 | membrane, Bessel ratios |
| 2 | bell, with the minor third partial at 2.4 |
| 3 | glass |
| 4 | wood |

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`material\` | 0.0 | 0 to 4 | mode table, see above |
| \`decay\` | 2.0 | 0.05 to 30 s | scales every mode's T60 |
| \`brightness\` | 0.5 | 0 to 1 | tilts mode gains around the fundamental |
| \`strike_hardness\` | 0.6 | 0 to 1 | shorter and sharper strike pulse |
| \`level\` | 0.6 | 0 to 1 | output level |

\`\`\`cpp
#include "bellows/engines/modal.h"

static bellows::Rng rng;
static bellows::Modal bells;

bellows::Modal::Params p;
p.material = 2.0f;            // bell
p.decay = 6.0f;
p.strike_hardness = 0.8f;
rng.Init("bells");
bells.Init(sr, &rng, p);
bells.NoteOn(440.0f, 0.7f);
\`\`\`

Modes that would land above 0.45 of the sample rate are muted rather than aliased, so a high note thins out instead of turning to mush. The browser precomputes the strike pulse into a Float32Array at every note on, about 1.1 KB per voice at 48 kHz; here the raised cosine is evaluated as it is consumed, so a voice costs no strike buffer at all. The random draws happen in the same order, so the excitation is identical.

\`Modal\` needs no oscillator table. Five material tables in flash and the whole thing is 5944 bytes.

## Formant

Source-filter vocal synthesis: a band-limited saw or pulse with sine vibrato, mixed with breath noise, through five parallel bandpass formants. For choirs, vowel pads, and talk-box effects. The vowel tables are the bass rows of the Csound formant appendix.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`vowel\` | 0.0 | 0 to 4 | a, e, i, o, u; morphs continuously between neighbours |
| \`breath\` | 0.1 | 0 to 1 | noise mixed into the source |
| \`vibrato_rate\` | 5.0 | 0 to 12 Hz | vibrato speed |
| \`vibrato_depth\` | 0.25 | 0 to 2 semitones | vibrato depth |
| \`shape\` | 0.0 | 0 to 1 | under 0.5 saw source, else pulse |
| \`level\` | 1.0 | 0 to 2 | output level |

\`\`\`cpp
#include "bellows/engines/formant.h"

static bellows::Rng rng;
static bellows::Formant choir;

bellows::Formant::Params p;
p.vowel = 1.6f;               // between e and i
p.breath = 0.25f;
p.vibrato_depth = 0.4f;
rng.Init("choir");
choir.Init(sr, &rng, p);
choir.NoteOn(196.0f, 0.6f);
\`\`\`

Formant frequency interpolates in the log domain while bandwidth and level interpolate linearly, so a slow sweep of \`vowel\` sounds like a mouth moving rather than a filter being dragged.

At 28368 bytes this is the second most expensive engine here, behind \`Va\`, and for one reason: \`shape\` picks the oscillator waveform at run time, so the linker has to keep both residual tables.

## WestCoast

A triangle core into an iterated wavefolder into a vactrol-modelled low-pass gate. For Buchla-style bonks, percussive timbres that open and close, and anything where the brightness should follow the amplitude. The fold gain rides an envelope, so notes bloom and relax.

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`fold_amount\` | 0.35 | 0 to 1 | static fold gain |
| \`fold_stages\` | 2.0 | 1 to 6 | how many folder iterations |
| \`fold_env\` | 0.5 | 0 to 1 | how much of the fold gain follows the envelope |
| \`lpg_color\` | 0.7 | 0 to 1 | 0 is a plain VCA, 1 is all filter |
| \`lpg_decay\` | 0.5 | 0.02 to 5 s | vactrol fall time scale |
| \`level\` | 0.8 | 0 to 1 | output level |

\`\`\`cpp
#include "bellows/engines/westcoast.h"

static bellows::WestCoast bonk;

bellows::WestCoast::Params p;
p.fold_amount = 0.7f;
p.fold_stages = 4.0f;
p.lpg_color = 0.9f;
p.lpg_decay = 0.25f;
bonk.Init(sr, p);
bonk.NoteOn(110.0f, 0.9f);
\`\`\`

The vactrol is two cascaded one-poles whose fall time grows as the level drops, which is what gives a real one its habit of letting go quickly from bright and then crawling through the dark tail. The state ticks every sample; the coefficients and the output gain refresh every sixteenth.

## What they cost

Every row below is a sketch in \`packages/bellows-embedded/test/sketches/\` that constructs the engine and runs one block through it, compiled for Cortex-M7 with \`arm-none-eabi-g++\` 11.3.1 at \`-Os\` with \`--gc-sections\`, linked freestanding with no Arduino core. So these are whole-program figures for that program, not a floor, and each carries the same 1028 bytes of harness RAM. Reproduce them with \`packages/bellows-embedded/tools/size-report.sh\`.

| engine | sketch | flash | RAM | reaches the BLEP tables |
| --- | --- | --- | --- | --- |
| \`Kick\` | \`s1_kick\` | 3760 B | 1100 B | no |
| \`Tube<80>\` | \`s9g_tube\` | 5096 B | 2460 B | no |
| \`Fm\` | \`s9c_fm\` | 5384 B | 1536 B | no |
| \`Modal\` | \`s9d_modal\` | 5944 B | 1584 B | no |
| \`Pluck<20>\` | \`s3_pluck\` | 6728 B | 29988 B | no |
| \`Pluck<80>\` | \`s3b_pluck_small\` | not published | 8388 B | no |
| \`WestCoast\` | \`s9e_westcoast\` | 17656 B | 2564 B | ramp table only |
| \`Kick\` + \`Snare\` + \`Hat\` | \`s2_kit\` | 28248 B | 1532 B | both |
| \`Formant\` | \`s9f_formant\` | 28368 B | 1504 B | both |
| \`Va\` | \`s4_va\` | 28640 B | not published | both |

The last column is the whole shape of that table. The band-limited oscillator's residual tables are 16392 bytes of \`.rodata\`, they are what stops a saw aliasing across the keyboard, and they are **paid once**. One VA voice is 28640 bytes and eight VA voices plus an EQ and a 250 ms delay (\`p2_poly8\`) is 31136, because the second through eighth voices are code that already exists.

The same reading applies to RAM. \`p2_poly8\` is 100280 bytes of RAM. Subtract 1028 of harness and 96032 for the 250 ms stereo delay line and 3220 bytes are left for eight \`Va\` voices, an \`Eq3\` and the pool. A subtractive voice is a few hundred bytes; the delay line is the memory. (That subtraction is arithmetic over published figures, not a separate measurement.)

An engine that fixes its waveform at construction calls \`ProcessSaw()\`, \`ProcessTriangle()\` or \`ProcessSquare()\` rather than the switching \`Process()\`, so the linker can drop the table it never reads. That is why \`WestCoast\` is 17656 bytes and \`Formant\`, which chooses its shape from a parameter, is 28368.

Two knobs move these numbers and neither is a code change. \`-D BELLOWS_FAST_MATH=1\` swaps newlib's transcendentals for polynomials and takes \`s1_kick\` from 3760 to 936 bytes, \`s3_pluck\` from 6728 to 2468, and \`s4_va\` from 28640 to 20728. It is off by default because exact libm keeps renders closer to the browser. And the template floors on \`Pluck\` and \`Tube\` are the only lever on the RAM that matters.

## Where next

Engines make signal. [Effects](/docs/emb-effects) shape it, and that page is where the memory arithmetic gets serious. [Voices](/docs/emb-voices) is how you get more than one note at a time out of any of these.
`,
};

export default page;

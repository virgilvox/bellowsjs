import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-effects',
  title: 'Effects',
  blurb: 'The ported effects, their Params structs, the delay-line arithmetic, and how to write the mixer the library does not have.',
  prev: 'emb-engines',
  next: 'emb-voices',
  body: `
By the end of this page you can put an effect on a signal, work out what it will cost in RAM before you build, and write a send bus by hand.

## Effects process in place

An effect is a class with the same shape as an engine, minus the notes:

\`\`\`cpp
void Init(float sample_rate);              // some also take a Params
void SetParams(const Params& p);
void Process(float* l, float* r, int from, int to);
void Reset();
\`\`\`

\`Process\` reads \`[from, to)\` and writes the same range back. **In place, not into a destination.** There is no wet buffer, no return value, no second pair of pointers. Chaining is calling them in the order you want:

\`\`\`cpp
saturator_.Process(l, r, from, to);
eq_.Process(l, r, from, to);
limiter_.Process(l, r, from, to);
\`\`\`

That is the same contract the browser effects have. What it does not have is any of the routing around them, and that is deliberate: see "There is no mixer" below.

The other rule that shapes every class here is that **the caller owns large memory**. Anything with a delay line in it comes in two forms: a template with the size baked in, which puts its buffer in \`.bss\`, and an \`Ext\` form that takes a pointer and a length so you can put the buffer in \`EXTMEM\` on a Teensy 4.1 or \`DSY_SDRAM_BSS\` on a Daisy. The library never calls \`new\` and does not know those macros exist.

As on the engines page, the range column below is the browser's \`ParamSpec\` range. The struct enforces nothing.

## StereoDelay

Two independent delay lines with cross feedback and a one-pole damper in the loop. Cubic interpolated reads and a 150 ms smoother on each time, so sweeping a delay time pitch-bends the way a tape machine does instead of clicking.

\`\`\`cpp
template <uint32_t kMaxMs = 500, uint32_t kSampleRate = 48000> class StereoDelay;
class StereoDelayExt;   // caller-supplied buffers
\`\`\`

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`time_l\` | 0.35 | 0.001 s to \`kMaxMs\` | left delay time |
| \`time_r\` | 0.5 | 0.001 s to \`kMaxMs\` | right delay time |
| \`feedback\` | 0.4 | 0 to 0.99 | loop gain |
| \`cross_feedback\` | 0.0 | 0 to 1 | how much of each side feeds the other |
| \`damping\` | 8000.0 | 200 to 20000 Hz | lowpass in the feedback loop |
| \`mix\` | 0.35 | 0 to 1 | dry to wet |

\`\`\`cpp
#include "bellows/fx/delay.h"

static bellows::StereoDelay<500, 48000> echo;

bellows::StereoDelay<500, 48000>::Params p;
p.time_l = 0.375f;            // dotted eighth at 120 bpm
p.time_r = 0.5f;
p.feedback = 0.45f;
p.damping = 5000.0f;
p.mix = 1.0f;                 // on a send, the wet signal only
echo.Init(sr, p);
\`\`\`

A time longer than \`kMaxMs\` is clamped to \`kMaxMs\`, not to whatever the ring happens to hold. The browser hardcodes a 4 second maximum and pays for it whether you use it or not; here the maximum is the template parameter and you pay for what you asked for.

## Plate

The Dattorro figure-eight plate reverb: predelay, a bandwidth filter, four input diffusers, then a tank of two branches, each a modulated allpass, a delay, a damper, the decay gain, a second allpass and a final delay that crosses into the other branch. Seven taps per output channel. Thirteen delay elements in all, and the reason this page has a RAM section.

\`\`\`cpp
template <int kSampleRate = BELLOWS_SAMPLE_RATE, int kMaxPredelayMs = 250> class Plate;
class PlateExt;   // one caller-supplied float buffer, carved into thirteen
\`\`\`

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`decay\` | 0.5 | 0 to 0.98 | tank feedback, the reverb time |
| \`damping\` | 0.3 | 0 to 0.99 | high-frequency loss per pass |
| \`bandwidth\` | 0.9995 | 0 to 1 | input lowpass, 1 is fully open |
| \`predelay\` | 0.0 | 0 to \`kMaxPredelayMs\` | gap before the tank |
| \`mod_depth\` | 1.0 | 0 to 2 | allpass modulation, breaks up metallic ring |
| \`mix\` | 0.35 | 0 to 1 | dry to wet |

\`Init\` returns \`bool\` here, unlike every other effect. It is \`false\` when the buffer it was given cannot hold the thirteen elements at the requested rate and predelay, and \`Ready()\` reads the same answer back later. Check it. A plate that failed to carve its buffer passes audio through untouched rather than crashing, which is the failure you will not notice by ear.

\`\`\`cpp
#include "bellows/fx/plate.h"

// 50 ms of predelay: the practical owning size on a Teensy 4.1.
static bellows::Plate<48000, 50> room;

bellows::Plate<48000, 50>::Params p;
p.decay = 0.85f;
p.damping = 0.4f;
p.mix = 1.0f;
if (!room.Init(sr, p)) { /* buffer too small for this rate */ }
\`\`\`

## Chorus, Flanger, Tremolo, AutoPan, RingMod

Five independent classes in \`bellows/fx/modfx.h\`, no base class between them. Two carry delay memory and three carry none at all. The header deliberately does not include \`dsp/oscillators.h\` for the ring modulator's carrier, so a sketch that only wants a tremolo never pays the 16 KB for the band-limited tables.

\`Chorus<kSampleRate>\`: three taps at 10, 17.5 and 25 ms, each modulated up to 5 ms.

| field | default | range |
| --- | --- | --- |
| \`rate\` | 0.5 | 0.01 to 10 Hz |
| \`depth\` | 0.5 | 0 to 1 |
| \`mix\` | 0.5 | 0 to 1 |
| \`feedback\` | 0.0 | 0 to 0.5 |

\`Flanger<kSampleRate>\`: one sweeping tap between 0.5 and 10 ms.

| field | default | range |
| --- | --- | --- |
| \`rate\` | 0.25 | 0.01 to 10 Hz |
| \`depth\` | 0.7 | 0 to 1 |
| \`manual\` | 0.25 | 0 to 1 |
| \`feedback\` | 0.4 | 0 to 0.9 |
| \`mix\` | 0.5 | 0 to 1 |
| \`invert\` | \`false\` | bool |

\`Tremolo\`: amplitude modulation. \`shape\` is an \`LfoShape\` enum here rather than the browser's number, and \`phase\` at 0.5 gives anti-phase stereo.

| field | default | range |
| --- | --- | --- |
| \`rate\` | 4.0 | 0.05 to 40 Hz |
| \`depth\` | 0.8 | 0 to 1 |
| \`shape\` | \`LfoShape::kSine\` | sine, triangle, saw, square, sample and hold |
| \`phase\` | 0.0 | 0 to 1 |

\`AutoPan\`: the same modulator on position instead of level.

| field | default | range |
| --- | --- | --- |
| \`rate\` | 1.0 | 0.05 to 20 Hz |
| \`depth\` | 1.0 | 0 to 1 |
| \`shape\` | \`LfoShape::kSine\` | as above |

\`RingMod\`: multiply by a sine carrier.

| field | default | range |
| --- | --- | --- |
| \`freq\` | 440.0 | 1 to 8000 Hz |
| \`mix\` | 1.0 | 0 to 1 |

\`\`\`cpp
#include "bellows/fx/modfx.h"

static bellows::Chorus<48000> chorus;
static bellows::Tremolo trem;

bellows::Chorus<48000>::Params cp;
cp.rate = 0.3f;
cp.depth = 0.7f;
chorus.Init(sr, cp);

bellows::Tremolo::Params tp;
tp.rate = 5.5f;
tp.shape = bellows::LfoShape::kTriangle;
trem.Init(sr, tp);
\`\`\`

\`Tremolo\` and \`AutoPan\` take an optional \`Rng*\`, needed only by the sample-and-hold shape. The phaser and the frequency shifter from the same browser file are not ported.

## Eq6 and Eq3

\`Eq6\` is the port: six bands in series, band 0 a low shelf, bands 1 to 4 bells, band 5 a high shelf, one state-variable filter per channel per band. Its \`Params\` is an array of six \`Band\` structs rather than the browser's flat \`b0freq\`, \`b0gain\`, \`b0q\` naming.

| band | default freq | default Q | mode |
| --- | --- | --- | --- |
| 0 | 80 Hz | 0.707 | low shelf |
| 1 | 250 Hz | 1.0 | bell |
| 2 | 800 Hz | 1.0 | bell |
| 3 | 2500 Hz | 1.0 | bell |
| 4 | 6000 Hz | 1.0 | bell |
| 5 | 12000 Hz | 0.707 | high shelf |

Every band defaults to 0 dB gain and \`enabled = true\`. Gain ranges -24 to +24 dB, frequency 20 to 20000 Hz, Q 0.1 to 12. A band at exactly 0 dB is skipped, which is a bit-transparent bypass, and re-enabling one clears its filter state so stale energy cannot click in.

\`Eq3\` is a **deliberate reduction, not a port**: low shelf, one bell, high shelf, at different default frequencies. It exists because six bands is more tone control than a pedal usually needs and every band costs two filters. Do not expect it to match the browser.

| field | default | what it does |
| --- | --- | --- |
| \`low_freq\` | 120.0 | low shelf corner |
| \`low_gain\` | 0.0 | dB |
| \`mid_freq\` | 1000.0 | bell centre |
| \`mid_gain\` | 0.0 | dB |
| \`mid_q\` | 0.7 | bell width |
| \`high_freq\` | 6000.0 | high shelf corner |
| \`high_gain\` | 0.0 | dB |

\`\`\`cpp
#include "bellows/fx/eq.h"

static bellows::Eq3 eq;

bellows::Eq3::Params p;
p.low_gain = 2.0f;
p.mid_freq = 700.0f;
p.mid_gain = -3.0f;
eq.Init(sr, p);
\`\`\`

## Compressor, Limiter, Gate, EnvFollow

All three effects in \`bellows/fx/dynamics.h\` are stereo, in place, and driven by one mono sidechain, \`max(|l|, |r|)\`, so the stereo image does not wander when one channel dips. Detection runs in dB with a -96 dB floor and asymmetric one-pole smoothing.

\`Compressor<kMaxLookaheadMs = 10, kSampleRate>\`:

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`threshold_db\` | -18.0 | -60 to 0 dB | where reduction starts |
| \`ratio\` | 4.0 | 1 to 20 | reduction above threshold |
| \`knee_db\` | 6.0 | 0 to 24 dB | soft-knee width |
| \`attack\` | 0.01 | 0.0001 to 0.5 s | detector attack |
| \`release\` | 0.2 | 0.01 to 2 s | detector release |
| \`makeup_db\` | 0.0 | -1 to 24 dB | -1 selects auto makeup |
| \`lookahead\` | 0.0 | 0 to \`kMaxLookaheadMs\` | delay the audio, not the detector |
| \`mix\` | 1.0 | 0 to 1 | below 1 is parallel compression |

\`Latency()\` returns the lookahead in samples, which is what you need if something else in the chain has to stay phase aligned.

\`Limiter<kSampleRate, kTruePeak = false, kMaxBlock>\`: a lookahead brickwall with a fixed 5 ms window.

| field | default | range |
| --- | --- | --- |
| \`ceiling_db\` | -0.3 | -24 to 0 dB |
| \`release\` | 0.05 | 0.001 to 1 s |

True peak detection is a template parameter rather than a runtime field, because at \`false\` the 4x oversampler ceases to exist rather than sitting unused. Turning it on adds roughly 6 KB of scratch.

\`Gate\`:

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`threshold_db\` | -40.0 | -80 to 0 dB | opening level |
| \`attack\` | 0.001 | 0.0001 to 0.1 s | open time |
| \`hold\` | 0.05 | 0 to 1 s | minimum open time |
| \`release\` | 0.1 | 0.001 to 2 s | close time |
| \`range_db\` | -60.0 | -80 to 0 dB | attenuation when closed |

The gate has 3 dB of hysteresis: it opens at the threshold and only closes once it has stayed 3 dB below it for the hold time.

\`EnvFollow\` is not an effect at all, it is the detector on its own. \`Init(sample_rate, attack_sec, release_sec)\` then \`Process(x)\` per sample, which is what you want for driving an LED, a filter cutoff, or a duck.

\`\`\`cpp
#include "bellows/fx/dynamics.h"

static bellows::Compressor<10, 48000> comp;
static bellows::Limiter<48000> lim;

bellows::Compressor<10, 48000>::Params cp;
cp.threshold_db = -14.0f;
cp.ratio = 2.5f;
cp.attack = 0.02f;
comp.Init(sr, cp);
lim.Init(sr);                 // -0.3 dBFS ceiling
\`\`\`

The transient shaper from the same browser file is not ported.

## Saturator

Drive into a waveshaping curve, run above the host rate so the harmonics it makes past Nyquist get filtered out instead of folding back.

\`\`\`cpp
template <int kOversample = 4, int kMaxBlock = BELLOWS_BLOCK_SIZE> class Saturator;
\`\`\`

| field | default | range | what it does |
| --- | --- | --- | --- |
| \`drive\` | 2.0 | 0.1 to 20 | gain into the curve |
| \`curve\` | \`SatCurve::kTanh\` | tanh, soft, fold, cheby | the nonlinearity |
| \`tone\` | 0.0 | -1 to 1 | tilt around 700 Hz, up to 6 dB either way |
| \`output_db\` | 0.0 | -24 to 24 dB | output trim |
| \`mix\` | 1.0 | 0 to 1 | dry to wet |

Output level is compensated automatically: on every parameter change the unit measures what a half-scale sine keeps through the curve and scales the wet path so turning up \`drive\` changes the tone rather than the volume. \`output_db\` sits on top of that.

\`kOversample\` is the knob that matters and it is a template parameter, because this is the most expensive effect in the library and almost all of the cost is the oversampling. 4 matches the browser exactly and delays the wet path by 24 samples. 2 halves the filter work, delays by 16, and still pushes the first aliasing image above 24 kHz for anything short of extreme drive. 1 removes the oversampler, both dry-path delay lines and both block scratch buffers from the object entirely, leaving a memoryless shaper: cheapest, aliases, and perfectly usable on bass or on anything already band limited.

\`\`\`cpp
#include "bellows/fx/saturator.h"

static bellows::Saturator<2, 128> sat;   // half the cost of the browser's 4x

bellows::Saturator<2, 128>::Params p;
p.drive = 4.0f;
p.curve = bellows::SatCurve::kCheby;
p.tone = 0.3f;
p.mix = 0.5f;
sat.Init(sr, p);
\`\`\`

## The RAM story: it is the delay line

One number decides embedded memory in this library, and it is not the code. \`DelayLine<N>\` holds \`N + 4\` floats and nothing else. Four bytes each, exact, no power-of-two rounding, so:

\`\`\`
bytes = 4 * (seconds * sample_rate + 4) per line
\`\`\`

For the stereo delay that is two lines, and \`kCap = kMaxMs * kSampleRate / 1000 + 4\`:

| at 48 kHz | samples per side | both lines |
| --- | --- | --- |
| \`StereoDelay<100>\` | 4804 | 38432 B |
| \`StereoDelay<250>\` | 12004 | 96032 B |
| \`StereoDelay<500>\` | 24004 | 192032 B |
| \`StereoDelay<4000>\`, the browser's fixed maximum | 192004 | 1536032 B |

The last row is the point. A 4 second stereo delay wants 1.5 MB and overflows the 1 MB link script the size report uses. The browser pays that on every delay it makes; here it is a template parameter, so a 250 ms echo costs 96 KB and nothing else.

The others, all at 48 kHz:

| object | line memory |
| --- | --- |
| \`Chorus\` | 31 ms per channel, 11936 B for the pair |
| \`Flanger\` | 11 ms per channel, 4256 B for the pair |
| \`Tremolo\`, \`AutoPan\`, \`RingMod\` | none at all, a few dozen bytes each |
| \`Compressor<10>\` | 10 ms per channel, 3872 B for the pair |
| \`Limiter\` | a fixed 5 ms window per channel |
| \`Saturator<4>\` | two 24-sample dry lines plus block scratch |
| \`Plate<48000, 50>\` | thirteen elements, about 152 KB |
| \`Eq6\`, \`Eq3\` | none, two filters per band per channel |

The plate is worth its own paragraph because its numbers are large and its knob is not obvious. At 48 kHz the tank alone is 142.2 KB. A 250 ms predelay ceiling adds 46.9 KB on top, for 189.1 KB; dropping that ceiling to 50 ms takes the total to 151.6 KB. All thirteen lengths are odd and mutually prime by design, which is close to the worst case for power-of-two rounding, so sizing them exactly is worth more here than anywhere else in the library: it took the tank from 222684 to 156736 bytes.

Then the two figures that tie it together, both measured. In \`s5_all\`, the sketch that constructs and drives everything at once, the single \`StereoDelay\` buffer is 192152 of 223324 bytes, 86 percent, and everything backed by a delay line together is 99 percent. And \`07_Workstation\` uses 225508 bytes of RAM, of which one object, the 500 ms stereo delay, is 187 KB. Four plucked strings, the effect chain, the patterns and the send scratch come to under 40 KB together.

So the way to fit a patch on a board is to shorten a delay, raise a \`Pluck\` or \`Tube\` floor, or move a buffer to external memory with the \`Ext\` form. Nothing else you can do to the DSP will move the number.

## There is no mixer, and that is on purpose

The browser has \`b.bus()\`, \`inst.send()\`, \`inst.gain()\`, \`b.masterFx()\`. None of that is here. The embedded library is engines, effects and a kernel; routing is the application's business, and a mixer written for one patch is fifteen lines while a general one is a graph, a scheduler and a lot of flash.

Writing one by hand has exactly one rule you have to know:

**A voice advances its envelope when it renders.** So a part that has to reach two places (the dry mix and a send) is rendered **once** into a scratch buffer and added twice. Rendering it a second time would cost a second voice's worth of CPU and produce a different signal, because the second render starts where the first one left off.

Here is the whole mixer from \`07_Workstation\`, unedited:

\`\`\`cpp
void RenderSpan(float* l, float* r, int from, int n) {
  for (int i = 0; i < n; ++i) {
    send_l_[i] = 0.0f;
    send_r_[i] = 0.0f;
  }

  Mix(kick_,   0.55f, 0.0f,  l, r, from, n);
  Mix(snare_,  0.33f, 0.14f, l, r, from, n);
  Mix(hat_,    0.2f,  0.0f,  l, r, from, n);
  Mix(bass_,   0.4f,  0.0f,  l, r, from, n);
  Mix(melody_, 0.36f, 0.26f, l, r, from, n);

  delay_.Process(send_l_, send_r_, 0, n);
  for (int i = 0; i < n; ++i) {
    l[from + i] += send_l_[i];
    r[from + i] += send_r_[i];
  }

  eq_.Process(l, r, from, from + n);
  limiter_.Process(l, r, from, from + n);
}

template <class Part>
void Mix(Part& part, float dry, float send, float* l, float* r, int from, int n) {
  for (int i = 0; i < n; ++i) {
    dry_l_[i] = 0.0f;
    dry_r_[i] = 0.0f;
  }
  part.Process(dry_l_, dry_r_, 0, n);
  for (int i = 0; i < n; ++i) {
    l[from + i] += dry * dry_l_[i];
    r[from + i] += dry * dry_r_[i];
    send_l_[i]  += send * dry_l_[i];
    send_r_[i]  += send * dry_r_[i];
  }
}
\`\`\`

Reading it in order: clear the send bus, render each part once into a scratch and add it at two gains, run the bus through the delay at \`mix = 1\` so what comes back is the echo alone, add the bus in, then the master chain over the sum.

Four things worth copying out of it.

\`Mix\` is a template over the part type, so a \`Kick\`, a \`Va\` and a \`VoicePool<Pluck<110>, 4>\` all go through the same six lines without a base class or a virtual call. That is the same trick \`Bank\` uses.

Every part gets a fader because the drum engines have no level field. \`Kick::Params\` is tune, decay and drive; how loud it sits against a bass line is a property of the arrangement, not of the drum.

The scratch buffers are fixed-size members sized to \`BELLOWS_BLOCK_SIZE\`, and the render splits its span at that size so they cannot be overrun. Four buffers of one block is 2 KB at 128 frames, which is the whole overhead of having a mixer.

An effect on a send runs at \`mix = 1\`. The send amount does the blending. An effect as an insert keeps its own \`mix\`.

## Where next

[Voices](/docs/emb-voices) is the other half of a patch: how one \`Va\` becomes eight, how a note id finds its voice again, and how the kernel puts an event on the exact sample it was scheduled for.
`,
};

export default page;

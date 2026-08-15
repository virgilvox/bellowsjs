import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-program-shape',
  title: 'The shape of a program',
  blurb: 'The render signature, Init instead of constructors, the ordering rule in setup, and why there is no registry.',
  prev: 'emb-getting-started',
  next: 'emb-output',
  body: `
Every sketch in this package has the same shape, and most of that shape is there for a reason you can measure. This page is the contract: what a render is, who clears the buffer, what has to happen before what in \`setup()\`, and the one thing you must never add to the library.

## Two files, and the split is not decoration

Each example is a header and an \`.ino\`.

\`\`\`
examples/01_OneKick/01_OneKick.ino     board glue: pins, codec, callback
examples/01_OneKick/onekick.h          the program
\`\`\`

The header holds the program and contains no board code. The \`.ino\` holds the wiring. The size report compiles that same header (\`test/sketches/p4_e1_onekick.cpp\` includes it rather than copying it), so the flash and RAM figures come from the code you are reading. The Daisy port does the same: \`examples/daisy_onekick\` includes \`01_OneKick/onekick.h\` directly, and that header needed no change, no \`#ifdef\` and no Daisy define to build for a different SDK, a different codec and a different sample rate.

Anything a sketch does that is not board specific belongs in the header.

## The render signature

A render is anything callable with the library's block signature:

\`\`\`cpp
void operator()(float* l, float* r, int from, int to);
\`\`\`

One voice, a whole patch, or an effect chain wrapping another render, all satisfy it. The platform adapters take it as a template parameter rather than through a base class:

\`\`\`cpp
static onekick::Voice voice;
static bellows::BellowsAudioStream<onekick::Voice> node(voice);
\`\`\`

That is why the call inlines and why the linker still sees exactly which engines a sketch reaches. \`BellowsAudioStream::update()\` holds the only virtual function in the library, and it is Paul Stoffregen's rather than ours: the audio graph dispatches it 344 times a second. Nothing below it is virtual.

## Voices add, effects process in place, the caller clears

\`\`\`cpp
void operator()(float* l, float* r, int from, int to) {
  for (int n = from; n < to; ++n) { l[n] = 0.0f; r[n] = 0.0f; }  /* the caller clears */
  kick_.Process(l, r, from, to);                                  /* voices add */
  snare_.Process(l, r, from, to);                                 /* and add */
  delay_.Process(l, r, from, to);                                 /* effects are in place */
}
\`\`\`

This is the same contract as the browser library, and it is what lets several voices share one buffer with no mix pass and no mixer object. There is no mixer in this library on purpose: in \`07_Workstation\` the fifteen-line \`RenderSpan\` IS the mixer.

One consequence catches people. A voice advances its envelope when it renders, so a part that goes two places (dry and into a send, say) is rendered once into a scratch buffer and added twice. Rendering it again for the send plays it twice and it will not sound the same.

## Init, not constructors

Every class is default constructible and does its real setup in \`Init\`:

\`\`\`cpp
bellows::Kick::Params p;
p.decay = 0.55f;   /* a little longer than the 0.4 default */
p.drive = 3.0f;
kick_.Init(sample_rate, p);
\`\`\`

Objects in a sketch are statics, and static constructors run before the SDK is up: before clocks are configured, before the codec exists, before anything can tell you the sample rate. Construction order across translation units is also not yours to choose. \`Init\` moves the whole of that ordering into \`setup()\`, where you can read it top to bottom.

Every \`Params\` struct's defaults match the \`ParamSpec\` defaults in the TypeScript exactly, which is what makes a patch sound the same in both. [/llm-embedded.txt](/llm-embedded.txt) lists every field with its default.

## AudioMemory comes last, and this ordering is load bearing

\`\`\`cpp
void setup() {
  codec.enable();
  codec.volume(0.5f);
  patch.Init(bellows::TeensySampleRate());

  AudioMemory(12);   /* LAST */
}
\`\`\`

\`BellowsAudioStream::update()\` returns early only while \`allocate()\` returns null, which is to say only until \`AudioMemory()\` runs. That call is what opens the audio interrupt. After it, the graph renders whatever it is pointed at, 344 times a second, whether or not you have finished setting that thing up.

So anything initialised below that line can be rendered before it is ready. A delay line that has not been given its buffer reads through a null pointer, and on an i.MX RT1062 address zero is executable memory rather than a trap page: no fault, no crash, just whatever happened to be there, at whatever amplitude it decodes to. A sketch with the calls in the wrong order works fine until the patch grows its first delay line, which is the worst possible time to learn this.

Construct, \`Init\` everything, then \`AudioMemory\`. On a Daisy the equivalent is that \`DaisyAudio<Render>::Start\` goes last.

## Take the sample rate from the SDK

\`\`\`cpp
patch.Init(bellows::TeensySampleRate());   /* Teensy */
patch.Init(hw.AudioSampleRate());          /* Daisy  */
\`\`\`

Not 44100, and not 48000. The Teensy's SAI clock does not land exactly on 44100, and every envelope coefficient, filter cutoff, LFO rate and delay length in the library is derived in \`Init\` from the number you pass. Write the literal and everything time-based is off by the ratio between the two, which is small enough to sound like a mystery rather than like a bug.

## Block splitting, so events land on the sample

The kernel renders up to the frame of the next event, applies the event, then renders the next span. Notes land on the exact sample they were scheduled for, whoever scheduled them, and the inner loop stays a straight run over a buffer with no per-sample dispatch. It is the same idea as the browser kernel, and it is why every signature carries \`from\` and \`to\` instead of a length.

\`\`\`cpp
bellows::Kernel<bellows::Va, 8, 64> kernel;   /* voice, polyphony, queue depth */
kernel.Init(48000.0f);
kernel.InitVoices(48000.0f, &rng);
kernel.PushNoteOn(kernel.FrameAtSeconds(t), 60, 261.63f, 0.8f);
kernel.Process(bufL, bufR, 128);              /* in the audio callback */
\`\`\`

The Teensy graph hands you a fixed block of \`AUDIO_BLOCK_SAMPLES\` (128 by default) carrying int16, so the adapter renders into a float scratch pair and converts on the way out. The fixed quantum costs nothing, because the ranges already exist for events.

Scheduling is not free but it is cheap: four \`Kick\` voices through \`Kernel<Kick, 4, 32>\` cost 2208 bytes of flash and 1272 bytes of RAM over the same \`VoicePool<Kick, 4>\` driven by hand. Most of that RAM is the events themselves at 32 bytes per unit of queue depth (half in the sorted queue, half in the inbound ring), so depth is the knob that matters.

Events reach the audio callback through a lock-free single-producer single-consumer ring: \`loop()\`, or a USB MIDI callback, or a serial reader, but exactly one of them, calls \`Push\`, and the audio callback drains the ring at the top of \`Process\`. Two producers break it. If both \`loop()\` and an interrupt need to push, give the interrupt its own kernel.

## There is no registry, and there must never be one

The browser kernel holds a map from string id to engine. That costs nothing in a browser and everything here, because a runtime map names every engine, so the linker keeps every engine, every constant table and every delay buffer, including the ones a sketch can never reach.

Measured on Cortex-M7, playing one kick:

| how | flash | RAM |
| --- | --- | --- |
| \`Kick\` used directly | 3760 B | 1100 B |
| through \`Bank<Kick>\`, dispatched by runtime index | 3760 B | 1104 B |
| through a string-keyed registry of five engines | 30488 B | 30872 B |

Eight times the flash and twenty-eight times the RAM, for one drum. This is the single load-bearing design rule of the package.

When you do need to pick an engine at runtime, \`bellows::Bank\` gives you exactly that, dispatched by index, and the table above says it is free:

\`\`\`cpp
bellows::Bank<bellows::Kick, bellows::Snare, bellows::Hat> kit;
kit.With(slot, [&](auto& v) { v.NoteOn(hz, vel); });
kit.ForEach([&](auto& v) { v.Process(l, r, from, to); });
\`\`\`

The cost of the abstraction is a chain of integer compares, one per bank entry, resolved at the call site.

## Nothing allocates, so sizes are template parameters

Every buffer-owning class takes its size as a template parameter, which means the sketch decides and the library never calls \`new\`. \`Pluck<110>\` is a plucked string with a 110 Hz floor; \`StereoDelay<500>\` is a 500 ms line.

Those numbers are the whole embedded story. A Karplus-Strong string IS its delay line, sized for the lowest note it will ever play, which at 48 kHz with a 20 Hz floor is 9.6 KB of float per voice. Four voices is 38 KB, and a Teensy 3.2 has 64 KB with the audio library already in it. Measured, before the shared output patch knew what board it was on:

\`\`\`
.bss will not fit in region RAM; region RAM overflowed by 61540 bytes
\`\`\`

Raising the floor to 100 Hz costs five times less per voice and costs nothing else, as long as no note goes below it. That is a decision only the sketch can make, which is why the library does not make it.

On a Teensy 4.1 the \`Ext\` forms take a caller-supplied pointer, so a long tail can live in PSRAM without the library learning that the macro exists:

\`\`\`cpp
EXTMEM float delayL[1 << 18];
EXTMEM float delayR[1 << 18];
bellows::StereoDelayExt d;
d.Init(AUDIO_SAMPLE_RATE_EXACT, delayL, delayR, 1 << 18, params);
\`\`\`

PSRAM is slower than internal RAM and is not write-cached the same way, so put long delay and reverb tails there and keep short, hot buffers (a pluck loop, a chorus line) in the default \`.bss\`.

## Where to go next

[Output and wiring](/docs/emb-output) is the other half of a working sketch: which pins, which parts, and what each path costs in quality. Every class, template parameter and \`Params\` field is listed at [/llm-embedded.txt](/llm-embedded.txt).
`,
};

export default page;

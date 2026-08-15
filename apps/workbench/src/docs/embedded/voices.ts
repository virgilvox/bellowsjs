import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-voices',
  title: 'Voices',
  blurb: 'VoicePool and its steal order, Bank and what a registry would have cost, note ids, and the kernel that splits a block on an event.',
  prev: 'emb-effects',
  next: 'emb-sequencing',
  body: `
By the end of this page you can play more than one note at a time, dispatch between engines by a runtime index without paying for a registry, and put an event on the exact sample it was scheduled for.

## VoicePool

\`\`\`cpp
template <class V, int kPoly> class VoicePool;
\`\`\`

A plain array of \`kPoly\` slots, each holding one voice, its note id, the frame it started on, and whether it is still held. No allocation, no virtuals, no list splicing. The whole class is about forty lines.

\`\`\`cpp
#include "bellows/voicepool.h"
#include "bellows/engines/va.h"

static bellows::Rng rng;
static bellows::VoicePool<bellows::Va, 8> poly;

rng.Init("poly");
for (int i = 0; i < 8; ++i) poly.at(i).Init(sr, &rng);

poly.NoteOn(60, 261.63f, 0.8f, frame);   // note id, Hz, velocity, frame
poly.Process(l, r, from, to);            // every active voice adds in
poly.NoteOff(60);
\`\`\`

\`at(i)\` reaches a voice directly, which is how you initialise them (each engine's \`Init\` takes different arguments, so the pool cannot do it for you) and how you set per-voice parameters. \`ActiveCount()\` is the number of slots still making sound.

\`Process\` calls only the slots whose \`Active()\` is true, and every voice adds into the range, so eight voices are eight calls over the same buffer.

## The steal order

\`NoteOn\` has to choose a slot, and it tries three things in order.

**A free slot.** The first slot in index order whose \`Active()\` is false. A voice that has decayed to silence on its own is free without anyone lifting a key, which is why drums and plucked strings mostly never steal anything.

**The oldest released voice.** If every slot is sounding, the one with the smallest \`start\` frame among the slots that are no longer held. These are notes in their release tail, so cutting one short is the least audible thing available.

**The oldest held voice.** If every slot is sounding and every one is still held, the smallest \`start\` frame overall. This is the one that will be heard, and it is last for that reason.

That is the browser's order, transcribed. Two consequences worth knowing.

\`start\` is the frame you passed to \`NoteOn\`, not the frame the block began on. This is why \`Kernel::Process\` sets its clock to the event's own frame before applying it: two notes 40 samples apart inside one block have to steal in the right order, and they will not if both think they started at the top of the block.

\`NoteOff(id)\` releases **every** slot holding that id, not just the first. If you send two note-ons with the same id, one note-off ends both.

## Bank, and what a registry would have cost

The browser looks an engine up by string: \`b.voice('kick')\`. That shape is what \`bellows/bank.h\` replaces, and this is the single load-bearing design decision of the whole package.

\`\`\`cpp
#include "bellows/bank.h"
#include "bellows/engines/drums.h"

enum Pad { kKick = 0, kSnare = 1, kHat = 2 };

static bellows::Rng rng;
static bellows::Bank<bellows::Kick, bellows::Snare, bellows::Hat> kit;

// Init is the one thing that cannot go through the bank, because each
// engine takes different arguments. Reach the entries directly.
kit.head.Init(sr);                  // Kick
kit.tail.head.Init(sr, &rng);       // Snare, needs noise
kit.tail.tail.head.Init(sr);        // Hat

kit.With(pad, [f, v](auto& voice) { voice.NoteOn(f, v); });        // runtime index
kit.ForEach([l, r, i, n](auto& v) { v.Process(l, r, i, i + n); }); // declaration order
\`\`\`

\`With(i, f)\` calls \`f\` with the engine at runtime index \`i\`. Out of range does nothing. The lambda has to be generic, taking \`auto&\`, because each entry is a different type and the compiler instantiates the body once per entry. The runtime cost of the abstraction is a chain of integer compares, one per bank entry, resolved at the call site.

\`head\` and \`tail\` are public members for exactly the case above: a generic lambda cannot call \`Init\` when \`Kick::Init\` takes one argument and \`Snare::Init\` takes two. \`02_DrumMachine\` is written this way and is worth reading next to this.

Here is why it is worth a header. Measured on Cortex-M7, playing one kick:

| | flash | RAM |
| --- | --- | --- |
| \`Kick\` used directly | 3760 B | 1100 B |
| through \`Bank<Kick>\` with a runtime index | 3760 B | 1104 B |
| through a string-keyed registry of five engines | 30488 B | 30872 B |

8.1 times the flash and 28.1 times the RAM, for the same sound. The bank costs four bytes of RAM against using the class directly, and not one byte of flash.

The reason is not that string comparison is slow. It is that a registry **names** every engine it can return, so the linker has to keep every engine, every constant table and every delay buffer, including the ones the program can never reach. \`--gc-sections\` cannot drop code that a table points at. Compile-time dispatch gives the same \`getEngine(id)\` ergonomics and lets the linker see the truth.

The same effect appears one level down, inside the oscillator. \`BlepOsc::Process()\` switches on a runtime shape, so it names every shape and keeps both 8 KB residual tables even in a program that only ever plays a saw. \`ProcessSaw()\` is the same arithmetic with the shape fixed, and a one-oscillator sketch goes from 18968 bytes to 8552. A runtime switch over shapes costs what a runtime registry of engines costs, for the same reason, at a smaller scale.

## Note ids

A note id is a number you choose. \`VoicePool\` takes an \`int\`, \`KernelEvent\` carries a \`uint16_t\`, and neither attaches any meaning to it. It is a handle: \`NoteOn\` records it against a slot, \`NoteOff\` finds slots by it.

A MIDI note number is the obvious choice and is what \`05_MidiInstrument\` uses, because a keyboard cannot send the same note on twice without an off in between. A sequencer can. If two parts might play the same pitch at once, give each sounding note its own id (a counter is fine) or the first note-off will cut both.

Some voices never need an off at all. A kick, a snare, a hat and a plucked string decay to silence and go inactive by themselves, so \`07_Workstation\` never calls \`NoteOff\` on its strings: a string has no key to lift.

The kernel keeps its own list of ids it has turned on, so that an all-notes-off has something to name. That list holds at most \`kPoly\` entries and drops the oldest when it fills. Entries go stale when the pool steals a voice, and releasing a stale id is a no-op, so a stale entry costs nothing but a loop iteration.

## The Kernel

\`\`\`cpp
template <class Voice, int kPoly, int kQueue = 64, int kRamps = 8> class Kernel;
\`\`\`

One voice pool, one sample-accurate event queue. It is not a mixer and does not want to be: no fx chain, no bus, no master gain. \`Process\` fills a buffer and your effects run over it in place afterwards.

\`\`\`cpp
#include "bellows/kernel.h"
#include "bellows/engines/va.h"

static bellows::Rng rng;
static bellows::Kernel<bellows::Va, 8, 64> kernel;   // voice, polyphony, queue

rng.Init("poly");
kernel.Init(48000.0f);
kernel.InitVoices(48000.0f, &rng);     // arguments forward to Va::Init

// producer side, from loop() or a MIDI callback
kernel.PushNoteOn(kernel.FrameAtSeconds(t), 60, 261.63f, 0.8f);
kernel.PushNoteOff(kernel.FrameAtSeconds(t + 0.5f), 60);

// audio callback
kernel.Process(bufL, bufR, 128);
\`\`\`

The voice type is a template parameter for the same reason the bank exists. The browser kernel holds a \`Map<number, Channel>\` of engines looked up by string id; that costs nothing in a browser and everything here. A sketch that wants three instruments instantiates three kernels, or dispatches a \`Bank\` itself.

### The event queue

Events cross two boundaries and each has its own structure.

From your code into the kernel is a **lock-free single-producer single-consumer ring**. \`loop()\` calls \`Push\`, the audio callback drains it at the top of \`Process\`. The producer writes only the write index, the consumer only the read index, both with release and acquire ordering, so no lock and no disabled interrupts. Capacity is the next power of two at or above \`kQueue\`. \`Push\` returns \`false\` when the ring is full and the event is dropped.

Two producers break this. If both \`loop()\` and an interrupt handler need to push, give the interrupt its own kernel or guard the call yourself.

Inside the kernel is a **sorted array**, \`kQueue\` deep. Draining does a binary insert by frame, keeping equal frames in arrival order, which is what the browser's splice does. The queue is near-sorted in practice, so the shift is short. \`Dropped()\` counts events refused because it was full.

A \`KernelEvent\` is 16 bytes with no padding and no pointers, trivially copyable, so you can \`memcpy\` it into a serial frame as is:

\`\`\`
offset 0   uint32  frame    absolute frame on the kernel clock
offset 4   uint8   kind     EventKind
offset 5   uint8   target   slot id, or kAnyTarget (255)
offset 6   uint16  a        note id, or param index
offset 8   float   b        NoteOn frequency in Hz, Param destination value
offset 12  float   c        NoteOn velocity 0 to 1, ParamRamp seconds
\`\`\`

The \`EventKind\` wire values match \`src/types.ts\` exactly (0 note on, 1 note off, 2 param, 3 param ramp, 4 all notes off), because the endgame is a browser streaming events down a link into this queue.

Time is **frames, not seconds**. A float second stops resolving single samples at 48 kHz after about 87 seconds of uptime, because the float ulp grows past half a sample period, and a board meant to run for hours has no reason to keep the host's units. Convert once at the edge with \`FrameAtSeconds\` or \`FramesFromNow\`. The counter wraps every 24.8 hours at 48 kHz; every comparison goes through a signed difference, so ordering survives the wrap as long as nothing sits in the queue for more than half the range.

### Block splitting

This is the one idea the kernel exists for. \`Process(l, r, n)\` does this:

1. Drain the inbound ring into the sorted queue.
2. Step any parameter ramps once.
3. Zero the block, because voices add.
4. Walk the queue. For each event landing inside this block, render the pool from the current position up to the event's frame, set the clock to that frame, apply the event, and continue from there.
5. Render whatever is left of the block.

So a note scheduled for frame 40 of a 128-frame block produces three \`Process\` spans on the pool rather than one, and the note starts on sample 40 rather than on the next block boundary. The inner loop stays a straight run over a buffer with no per-sample dispatch, which is the whole reason to do it this way rather than checking for events every sample.

An event whose frame has already passed lands at the current position instead of being dropped. Late is better than silent.

### Parameters and ramps

There are no parameter names on a microcontroller. No \`<string>\`, and a string compare on a control path is worse than useless. \`KernelEvent::a\` carries an index that means whatever your sketch says it means:

\`\`\`cpp
static void OnParam(void* ctx, uint8_t target, uint16_t param, float value) {
  auto* self = static_cast<Patch*>(ctx);
  switch (param) {
    case 0: self->p.cutoff = value; break;
    case 1: self->p.resonance = value; break;
    default: return;
  }
  self->ApplyToAllVoices();
}

kernel.SetParamHandler(OnParam, &patch);
kernel.PushParamRamp(frame, 0, 200.0f, 1.5f);   // cutoff to 200 Hz over 1.5 s
\`\`\`

Without a handler installed, param events are ignored.

Ramps step **once per block, not per sample**. A param write on most engines recomputes filter coefficients and phase increments, so per-sample ramping would cost far more than the audio it buys; a block is 2.7 ms at 48 kHz with 128 frames, below what the ear resolves as a step in parameter movement.

Three details of the ramp table, which holds \`kRamps\` entries:

A ramp needs somewhere to start from, and there is no way to read a value back out of a voice because the handler is one way. So the kernel remembers the last value it wrote for each parameter, and a ramp glides from there. A parameter the kernel has never written jumps straight to its destination, which beats dropping the automation.

A second ramp on the same parameter retargets the first rather than stacking. Two ramps fighting over one parameter is two writes a block with neither winning.

When the table is full, a new parameter claims a free slot first, then the oldest resting one, and never a ramp in flight, because stealing that would strand a parameter halfway to somewhere.

### Targets, panic, diagnostics

\`SetTarget(id)\` makes a kernel ignore events aimed elsewhere, so a drum kernel and a bass kernel can share one event stream. The default accepts everything, which is what a single-kernel sketch wants and what target 0 from the browser side gets. \`kAnyTarget\` is 255 and is accepted by every kernel.

\`Panic()\` releases every held note, clears both queues and freezes any ramp where it is rather than running it on toward a destination nobody is listening for. \`ActiveVoices()\` and \`Dropped()\` are the two numbers to print when something sounds wrong.

### What the kernel costs

\`s9n_kernel\` constructs \`Kernel<Kick, 4, 32, 4>\`, pushes three events (two note-ons 40 frames apart inside one block, one note-off later in the same block) and renders: 6208 bytes of flash, 2492 bytes of RAM. Against the same \`VoicePool<Kick, 4>\` driven by hand, the scheduling is 2208 bytes of flash and 1272 bytes of RAM.

Most of that RAM is the events themselves, and the arithmetic is simple: **32 bytes per unit of queue depth**, 16 in the sorted queue and 16 in the inbound ring. Depth is the knob. The ramp table is 24 bytes a slot, and the held-note list is 2 bytes per voice. Adding the param handler, one ramp and MIDI parsing to that sketch cost a further 48 bytes of flash.

## Where next

[Sequencing](/docs/emb-sequencing) is what pushes the events: euclidean patterns, arpeggios, L-systems, Markov chains and a tempo map, all at fixed capacity and about 5.3 KB of flash for the lot.
`,
};

export default page;

import type { DocPage } from '../types';

/*
 * Explanation, in the Diataxis sense: understanding rather than a task.
 *
 * This page exists because the project's most interesting claim was scattered
 * as defensive evidence across a getting-started page, where it answered a
 * question nobody had yet asked. Here the reader has already heard the
 * browser and the board and is asking how both can be true, which is the
 * moment the numbers are interesting rather than reassuring.
 *
 * The three counts it quotes are registered in check-docs.mjs against the
 * harnesses that print them, so this page cannot drift the way the copies
 * elsewhere did.
 */
const page: DocPage = {
  slug: 'emb-parity',
  title: 'How the browser and the board stay the same',
  blurb: 'Two implementations of one DSP, and the measurements that keep them from drifting apart.',
  prev: 'emb-getting-started',
  next: 'emb-program-shape',
  body: `
There are two implementations of this library. TypeScript, which runs in your browser, and C++17, which compiles to a microcontroller. They are not generated from each other and neither is a wrapper around the other.

That should worry you. Two implementations of the same thing is the oldest way to end up with two different things, and "we keep them in sync" is a promise every project makes and few keep.

So this page is about what actually stops it, which is measurement rather than discipline.

## What is compared, and how often

Three harnesses run on every commit.

**41 parity rows.** Each one renders the same note from the TypeScript and from the C++ and diffs the two sample by sample. Same seed, same sample rate, same note, same length. The comparison is a relative RMS of the difference, and each row has its own gate set at roughly ten times the drift actually measured, rather than at a round number somebody liked.

**428 value rows.** The parts that make no sound: scales, chords, note parsing, euclidean patterns, arpeggios, cellular automata, L-systems, tempo maps. These are compared exactly rather than by tolerance, because integers and note names have no excuse for drifting.

**1054 preset values.** All fifty instrument presets, field by field, mapping names through a generated header rather than restating them.

## Why the audio is not bit-identical, and why that is fine

The PRNG is bit-exact. So is the effect input, and so is every one of the 428 value rows. The audio is not, and cannot be: the browser computes in double and the board computes in float. A 32-bit float has about seven decimal digits where a double has fifteen, and every filter, every envelope and every oscillator accumulates that difference slightly differently.

What matters is the size of the difference and whether it grows. A relative RMS around 1e-4 is roughly 80 dB down, which is below the noise floor of the converter you are listening through.

The interesting part is what the gates found when they were tightened. On several engines the residual was not rounding at all: it was a frequency offset, because the browser accumulates an oscillator's phase in double and a float cannot follow it over a long note. The LFO and the four most recently ported engines accumulate phase as a fixed-point \`uint32\` counter instead, which tracks a double more closely than a float does, and their rows moved accordingly. A residual that large is not noise, it is a bug with a small amplitude.

The other engines still accumulate phase in float, and their rows are gated where they measure. That is a difference worth knowing rather than a plan: the fixed-point counter is a change with a cost, and it has been made where the measurement asked for it.

## What the numbers do not cover

Being exact about this, because the temptation is to let a strong measurement stand in for a weaker one.

**Timing is not simulated.** Whether a particular board renders a particular patch in time is not something the browser can tell you. One board has been measured, twice: a Teensy 4.0 running the heaviest program in the set. Everything else is a build rather than a run, and [Performance](/docs/emb-performance) says which is which.

**The sketch is not compared.** Codec setup, pin configuration and the audio library's scheduling are outside all of this. Only the program logic is compared.

**Nothing has been compared by ear.** Forty-one rows and a thousand preset values are a strong position and they are not the same as somebody having listened to both and agreed.

## What that buys you

Two things a library with one implementation cannot offer.

**You can hear it before you own it.** The tutorial and the playground run the TypeScript, so the sound in your browser is within a measured distance of what the board makes. That is why [Make a sound](/docs/emb-make-a-sound) does not begin by asking you to buy anything.

**You can bisect a silent board in one click.** If your patch sounds right in the browser and silent on hardware, the DSP and your patch are both eliminated and the fault is below them. [How to work out why it is silent](/docs/emb-how-silent) is built around that split, and it is only available because the two implementations are known to agree.

## Reproducing it

From \`packages/bellows-embedded\`:

\`\`\`
npm run parity:check     the audio rows, with their gates
npm run tables:check     the value rows, compared exactly
npm run presets:check    the fifty instrument presets
\`\`\`

Each prints its rows and its measured drift. If you change the DSP on either side and a gate trips, the question to ask is which implementation moved, not whether to widen the gate.
`,
};

export default page;

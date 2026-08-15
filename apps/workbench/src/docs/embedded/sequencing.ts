import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'emb-sequencing',
  title: 'Sequencing on hardware',
  blurb: 'Euclid, arpeggios, cellular automata, L-systems, Markov chains and tempo maps, all at fixed capacity.',
  prev: 'emb-voices',
  next: 'emb-theory',
  body: `
Everything on this page is integer and small-float work over \`const\` tables. It calls no transcendental, allocates nothing, and runs at note rate rather than sample rate. A sketch that constructs and drives Euclid, Arp, ElementaryCa, LSystem and TempoMap together costs 5296 bytes of flash and 900 bytes of RAM on Cortex-M7, measured by \`tools/size-report.sh\`. The band-limited oscillator's step tables, by comparison, are about 16 KB on their own.

This is also the part of the library that has no equivalent elsewhere. DaisySP gives you oscillators, filters and reverbs. Mozzi gives you oscillators and tables sized for an AVR. Neither knows what a euclidean rhythm, a dorian scale or a variable-order Markov chain is, so on those libraries the pattern layer is something you write yourself, per project, and then debug on a board. Here it ships as headers with the same output as the browser.

## Euclid

\`\`\`cpp
#include "bellows/seq/euclid.h"

bellows::Euclid<16> kick;

kick.Generate(3, 8);        // E(3,8): 1 0 0 1 0 0 1 0, the tresillo
kick.Generate(5, 8);        // E(5,8): 1 0 1 1 0 1 1 0, the cinquillo
kick.Generate(9, 16, 2);    // nine pulses over sixteen, rotated left by two

// per step, from your clock
if (kick.Process()) voice.NoteOn(freq, 0.9f);
\`\`\`

Bjorklund's algorithm: distribute \`pulses\` onsets as evenly as possible over \`steps\` slots. This is the real recursive bucket pairing, repeatedly zipping the shorter group list into the longer, and not the naive floor accumulator. The two agree for E(3,8) and disagree by E(5,8), which is why the shortcut is not used.

The TypeScript builds arrays of arrays and concatenates them, which is out of the question here. The C++ version exploits an invariant the JS never names: at every round of the pairing, all groups in the first list hold identical contents and all groups in the second do too. It starts true (\`[1]\` and \`[0]\`) and each round forms new groups as A followed by B, so it stays true. The entire state is two bit patterns and two counts, and the output is bit for bit what the JS returns.

The pattern is a bitmask, not one byte per step, so \`Euclid<64>\` is 8 bytes of pattern plus the cursor. Rotation is folded into the write rather than applied as a second pass.

\`Generate\` returns \`false\` and leaves the previous pattern and cursor untouched when \`steps\` is outside \`[1, kMaxSteps]\` or \`pulses\` outside \`[0, steps]\`. Nothing is clamped silently, because a rhythm that quietly got shorter is worse than an obvious no-op. \`Process()\` reads the current step and advances; \`At(i)\` reads without advancing.

## Arp

\`\`\`cpp
#include "bellows/seq/arp.h"

bellows::Arp<16> arp;
bellows::Arp<16>::Params p;
p.mode = bellows::ArpMode::kUpDown;
p.octaves = 2;
arp.Init(p);

const float held[] = {60.f, 64.f, 67.f};
arp.SetNotes(held, 3);

float midi = arp.Next();          // one note per call
float r = arp.Next(rng);          // kRandom needs a stream
\`\`\`

Six modes: \`kUp\`, \`kDown\`, \`kUpDown\`, \`kDownUp\`, \`kRandom\`, \`kOrder\`. \`kUpDown\` and \`kDownUp\` never repeat the endpoints, so three notes play a b c b a b c b, and both degenerate correctly at one and two notes.

\`SetNotes\` expands the held notes across the octave span and rebuilds the traversal cycle; \`Next()\` pulls one note at a time so your scheduler keeps control of timing. Two fixed arrays back it: a pool of expanded notes and a cycle of byte indices into that pool, so the mode is a table lookup rather than a branch per step.

\`kMaxNotes\` bounds the expanded pool, not the chord. \`Arp<16>\` with \`octaves = 2\` accepts eight held notes, and the cycle can be twice the pool minus two. The pool's first \`Count()\` entries are the base chord, which is what lets \`SetParams\` re-expand for a new octave span without asking you for the notes again.

One consequence of storing only the expanded pool: the sort that every mode except \`kOrder\` applies is not undoable. Switching to \`kOrder\` after the notes were sorted keeps the sorted order until the next \`SetNotes\`.

## ElementaryCa

\`\`\`cpp
#include "bellows/seq/automata.h"

bellows::ElementaryCa<32> ca;
ca.Init(30);              // single live cell in the centre, as in the JS

uint8_t row[16];
ca.Rhythm(row, 16, ca.Centre());   // sixteen steps sampled from one column
\`\`\`

Wolfram elementary automata with wrapping edges. Bit b of the rule number gives the next state of the neighbourhood \`(left << 2) | (centre << 1) | right == b\`, so rule 30 is chaotic, rule 110 is the Turing-complete one, and rule 90 draws the Sierpinski triangle. \`Init(rule, rng)\` seeds a random row instead; \`Init(rule, cells)\` takes yours.

Two deviations from the JS, neither of which changes an output bit. The rule table is not expanded into eight bytes, because a shift and a mask of the rule number is cheaper than the load it would replace. And there is no scratch row: a generation is computed in place by carrying the previous cell's old value forward and remembering old cell 0 for the wrap at the right edge, so \`ElementaryCa<32>\` costs 32 bytes rather than 64.

\`Rhythm(out, steps, column)\` writes into a buffer you own, so nothing here decides how long a pattern you are allowed to want.

## LSystem, and its truncation contract

\`\`\`cpp
#include "bellows/seq/lsystem.h"

bellows::LSystem<128, 8> ls;
ls.Init();
ls.SetAxiom("A");
ls.AddRule('A', "AB");
ls.AddRule('B', "A");

if (!ls.Grow(8)) {
  // ran out of room; Truncated() is latched
}

int8_t degrees[64];
const int8_t map[] = {0, 2, 4};
const int n = bellows::MapToDegrees(ls.Result(), "ABC", map, degrees, 64);
\`\`\`

Every symbol is rewritten in parallel each generation, which is the whole point: A to AB and B to A gives Fibonacci lengths only if each generation is built from the old string and never from itself as it is written. A rule is either a plain replacement or a weighted list of alternatives, and the stochastic form draws from a seeded \`Rng\` so the expansion reproduces.

Growth is explosive. The algae system reaches 34 symbols by generation 8, and a doubling system reaches \`kMaxLen\` far sooner, so **overflow is the normal case here, not the exception**, and it is defined rather than undefined:

- When a replacement does not fit whole, that generation stops before writing it.
- The rest of the string is dropped.
- \`Truncated()\` latches true and stays true.
- \`Grow\` returns \`false\` immediately and does not attempt further generations.

What you get back is always a valid NUL-terminated prefix of what the JS would have produced up to that generation. It is a shorter piece, not a corrupt one. Check \`Truncated()\` after growing rather than trusting the capacity you picked.

Two fixed buffers alternate, so growth costs \`2 * (kMaxLen + 1)\` bytes and nothing else. Rule text is not copied: a rule holds your pointer, so string literals stay in flash and cost no RAM. The strings and any weight arrays must outlive the \`LSystem\`, which for literals means forever.

\`MapToDegrees\` walks the result string and, for each symbol found in \`symbols\`, writes the degree at the same index of \`degrees\`. \`kRestDegree\` (-128) stands in for the JS null. Symbols with no entry are structural (turtle commands, brackets) and are skipped.

## Markov, the one module that is a rewrite

\`\`\`cpp
#include "bellows/seq/markov.h"

using Chain = bellows::Markov<8, 48, 2>;   // alphabet, contexts, order
Chain chain;
chain.Init(2);

const uint8_t motif[] = {0, 2, 4, 2, 7, 4, 2, 0, 4, 5, 4, 2, 0, 2, 4, 7};
chain.Train(motif, 16);
if (chain.Truncated()) { /* transitions were dropped */ }

uint8_t next;
chain.Seed(motif, 2);
if (chain.Next(rng, &next)) degree = next;
\`\`\`

Every other \`seq\` header is a transcription. This one is not, and the header says why. The JS keys a context with \`JSON.stringify\` into a \`Map\`, one \`Map\` per order, and both the key and the map grow for as long as you train. Neither a string key nor unbounded growth exists on a microcontroller.

**A state is a byte**, an index into an alphabet you own, 0 to \`kAlphabet - 1\`. What a state means, a scale degree, a slot in a note table, a drum, stays outside the chain, the same way \`MapToDegrees\` leaves symbol mapping to the caller.

**A context is packed into one uint32** instead of stringified:

\`\`\`
key = 1
for each symbol in the context, in order:
    key = key * kAlphabet + symbol
\`\`\`

The leading 1 is the part that matters. It puts the LENGTH into the key, so the empty context (key 1) and the one-symbol context \`[0]\` (key \`kAlphabet\`) cannot collide, and every order shares one flat table instead of one table per order. \`MarkovKeyFitsU32(alphabet, max_order)\` is a \`constexpr\` checked by \`static_assert\` at namespace scope, so a combination that would alias two contexts onto one entry fails to compile on every target rather than on the one where a test happened to run.

**Capacity is fixed at compile time**: \`kMaxContexts\` entries, each with a \`kAlphabet\`-wide outgoing distribution. One entry is 4 bytes of key, 2 of bookkeeping, \`kAlphabet\` bytes of symbols and \`4 * kAlphabet\` of weights, padded to a multiple of four. The default \`Markov<8, 32, 2>\` is 1556 bytes, measured with \`sizeof\` and not counted by hand. That is the whole chain.

Overflow follows the same contract as \`LSystem\`: when the table is full the transition is dropped, \`Truncated()\` latches true, and the call returns \`false\`. A chain that dropped transitions still plays. It plays a smaller chain, and \`Truncated()\` is the only way to find out.

### The two things preserved exactly

The note that comes out depends on both of these, so both are compared against the TypeScript in \`test/parity/tables.cpp\`.

1. **First-seen ordering.** Each distribution walks its symbols in the order they were first seen, not in alphabet order. The weighted draw subtracts along the array until it goes non-positive, so re-ordering the same weights picks a different symbol from the same random number. Storing weights indexed by symbol would have been smaller, faster to look up, and would have quietly played a different melody.

2. **Backoff from k down to 0.** Training records a transition at every order from 0 up to the configured order. At draw time the search runs from \`min(order, context length)\` down to 0, taking the LAST k symbols of the context at each step, and stops at the first order holding any weight. The backoff is the module: a chain that only answers at its full order stalls on the first context it does not hold, which for a melody is somewhere in the second bar.

Lookup is a linear scan and not a hash. The table is small by construction, training runs once at setup, and \`Next()\` runs at note rate, so a hash would cost state and a second failure mode to save time that nothing is waiting on.

\`NextWith(r, &out)\` takes the random number directly instead of an \`Rng\`, which is how the parity harness compares the draw itself. The melody-matrix helpers in the same JS file, \`buildStepwiseMatrix\` and \`weightedWalk\`, are deliberately not ported: they build an n-by-n float matrix with a seeded jitter per cell, which is a different capacity question.

## TempoMap

\`\`\`cpp
#include "bellows/seq/tempomap.h"

bellows::TempoMap<8> map;
map.Init(120.0);
map.RampTo(16.0, 90.0);   // linear ramp, beats 0 to 16
map.SetBpm(32.0, 140.0);  // step: holds 90 until beat 32, then jumps

const auto sec = map.BeatToSeconds(24.0);
const auto beat = map.SecondsToBeat(sec);
\`\`\`

Piecewise-linear tempo automation in the beat domain, with closed-form conversion in both directions. Over a segment where bpm ramps linearly from \`(b0, T0)\` to \`(b1, T1)\` with slope \`k\`:

\`\`\`
t(b) = (60 / k) * ln(T(b) / T0)             when k != 0
     = 60 * (b - b0) / T0                   at constant tempo

b(t) = b0 + T0 * (exp(k * t / 60) - 1) / k  when k != 0
     = b0 + t * T0 / 60                     otherwise
\`\`\`

Tempo is constant before the first point and after the last. Lookups binary search the precomputed cumulative times, so both directions are O(log segments). Points are fixed at \`kMaxPoints\` and an insert that would exceed it returns \`false\` and leaves the map untouched. The cumulative array is rebuilt eagerly on insert rather than behind a dirty flag, which makes every query \`const\`.

**This is the one file in the library that is \`double\` on purpose.** The DSP is float because float is what the FPU and the buffers want. A tempo map is not the audio path: it runs once per scheduled event, and everything downstream trusts its output. The integral accumulates across every segment, so a float cumulative array drifts audibly over a long piece with tempo curves and stops matching the browser, which computes in double.

Checked against the JS over a four point map with two ramps and a step, every conversion agrees to all 17 printed digits except one inverse inside a ramp, which differs by two units in the last place because newlib's \`exp\` and V8's round differently. The accumulation itself contributes nothing.

Measured, a map with one ramp: 3272 bytes of flash and 280 of RAM in double, against 1056 and 144 in float. Almost all of that gap is newlib's double \`log\` and \`exp\` being fatter than \`logf\` and \`expf\`, not the arithmetic.

On Cortex-M7 doubles are hardware and this costs 1.07x. On a single-precision part it is 6.08x, so the type is a knob:

\`\`\`
-DBELLOWS_TEMPO_SCALAR=float
\`\`\`

Every ramp still works. Drift accumulates across segments under a tempo curve, and results stop matching the JS past about the seventh digit. [Performance](/docs/emb-performance) has the measurement that number comes from.

## Where next

[Theory](/docs/emb-theory) is the layer these patterns feed: scales, chords, tunings, and the seeded stream that makes a generated piece reproduce between a browser tab and a board.
`,
};

export default page;

# LANDSCAPE

What else exists, what this library actually leads on, what it does not, and what that implies
about where the effort should go. Companion to `docs/HARDWARE.md`, which covers the embedded
competition in detail and is not repeated here.

## Sourcing discipline, read this first

This file mixes three kinds of statement and labels which is which, because an earlier revision
of the hardware comparison did not and had to withdraw a claim.

- **MEASURED** means a command in this repository printed it. Reproduce it.
- **SOURCED** means a primary document says it: a standard, a paper, a project's own README.
- **SECONDHAND** means it came from a search summary and was not traced to a primary source.
  Treat it as a lead, not a fact. The withdrawn claim was that `arm_lms_f32` outperforms the Q15
  version on Cortex-M7: it read as authoritative, could not be traced, and ARM's own published
  figures point the other way.

## The web side

Nothing here was tried against bellows in a benchmark. This is a map of what the neighbours are
for, not a scoreboard.

**Tone.js** is the default answer for music in the browser: a framework over the Web Audio API
with a DAW-shaped vocabulary, prebuilt synths and effects, and a transport. Its advantage over
this library is ecosystem, not engine. SOURCED.

**Faust** is a functional DSP language that compiles one source to C++, WebAssembly, Rust and
more. It is the direct answer to the strategic fork in `docs/HARDWARE.md`: write the DSP once,
target the browser and the microcontroller from it, and parity drift stops being a category of
bug. It costs the tier 3 JavaScript story and would be a rewrite rather than a port. SOURCED.

**RNBO** compiles Max patches to WebAssembly. Different audience: patchers, not programmers.
SOURCED.

**Csound** and **Elementary Audio** occupy the middle, mature DSP reachable from JavaScript.
SECONDHAND on their current capabilities; nobody here has used them.

**Tune.js** matters more than the others and is the one to read before claiming microtonality as
a differentiator. It brings the Scala archive, over 3000 scales, to JavaScript and Web Audio,
taking MIDI pitch in and returning frequency, adjusted MIDI or a ratio to a tonic. SOURCED. It
does on the web precisely what this library's tuning layer claims as its edge, and it does it
against the whole archive.

The general platform fact under all of them: the Web Audio API's built-in nodes are limited, and
the way around that is AudioWorklet plus WebAssembly. This library reaches the same conclusion
by a different route, running its own DSP in a worklet. SOURCED.

## Where the instrument algorithms come from

Provenance, because "is this a real algorithm or a plausible approximation" is the question that
matters and the answer should be checkable.

**Plucked string.** Karplus-Strong, extended by Jaffe and Smith, "Extensions of the Karplus
Strong Plucked String Algorithm", Computer Music Journal 1983. The extension that matters here is
the first-order allpass for fractional delay, which is what makes the string tune accurately
instead of quantising to integer loop lengths. Smith later derived Karplus-Strong as a special
case of digital waveguide synthesis. SOURCED.

MEASURED: every pitched engine tunes to under 1 cent from A1 to E7, worst case the pluck at E7 at
0.9 cents. That is the evidence the fractional delay is real and working, because a loop rounded
to an integer plays 2594 Hz instead of 2637 at that note, 28 cents flat, and the error grows with
pitch. `test/integration/engine-tuning.test.ts` holds this and was mutation tested: rounding the
loop read puts the pluck 5.6 to 8.7 cents out and the gate fires.

**Bowed string.** The bow table is a static, memoryless map from differential velocity (bow minus
string) to a reflection coefficient, following Smith's digital waveguide treatment, with a
velocity lookup based on a Stribeck friction curve. A basic implementation of this model is in
the Synthesis ToolKit, which is what this library's table is transcribed from. SOURCED.

The known upgrade path, if the bowed string is ever revisited: Serafin and Avanzini's
elasto-plastic friction model, which produces a hysteresis loop in the friction-velocity plane
that matches measurements on real instruments in a way the static bow table cannot. SOURCED.
`docs/BOWED-STRINGS.md` records what was already done and measured; this is what comes after it.

## The psychoacoustic grounding

**Loudness.** `src/analysis/loudness.ts` implements ITU-R BS.1770 with EBU R128 and Tech
3341/3342 on top: K-weighting as two biquads, 400 ms blocks at 75 percent overlap, an absolute
gate at -70 LUFS then a relative gate 10 LU below the absolute-gated mean, and loudness range
between the 10th and 95th percentiles with a -20 LU relative gate. SOURCED against the standard.

MEASURED, and this is the strongest single quality result in the repository: the K-weighting is
derived from the analog prototype rather than copied from the standard's 48 kHz table, and the
derivation reproduces that table to 8.88e-16, machine precision, while also working at any sample
rate. A 997 Hz sine at -3.01 dBFS reads -3.010 LUFS, which is the standard's own calibration
point. Verify with the coefficients in `kWeightingCoeffs(48000)` against BS.1770 Tables 1 and 2.

**What is not implemented, and is the unoccupied ground.** Critical bands, specific loudness,
temporal and spectral masking, and the roughness that close tones inside one critical band
produce, are canonical psychoacoustic constructs and none of them appear anywhere in this
library. SOURCED that they are canonical; MEASURED that they are absent (grep for "critical band"
returns nothing). The analysis suite already has chroma, onset, pitch and descriptors, so the
scaffolding for a masking-aware or roughness-aware analyser exists.

## Honest competitive position

**Leads.**
- The theory layer on a microcontroller. Scales, chords, tunings and note parsing are 2616 bytes
  of flash and 116 of RAM (MEASURED). Neither DaisySP nor Mozzi has any concept of a scale or a
  tuning, which is the strongest true differentiator this library has.
- Determinism across the language boundary. The PRNG is bit exact between TypeScript and C++
  (MEASURED, the parity row is exactly zero), and named streams fork by literal string
  concatenation, so a C++ caller can land on any browser stream. Nothing else surveyed offers a
  seeded render that reproduces on a different runtime.
- One DSP core that runs identically offline, in realtime and on an MCU, with a numeric parity
  harness holding the two implementations together.
- Loudness metering to specification, verified to machine precision.

**Contested, and weaker than previously claimed.**
- Microtonality. Tune.js already ships the Scala archive to Web Audio. Worse, `docs/AUDIT-2.md`
  records that `Scale.degreeToMidi` hardcodes a 12-semitone octave stride, so non-12-EDO is real
  at the `Tuning` object and not at the scale layer above it. The claim in `CLAUDE.md` that
  12-EDO is a default and never an assumption is true of the tuning layer and not yet true of
  everything built on it.
- Physical models. Verified genuine here, but STK, Faust's libraries and the Mutable-derived
  parts of DaisySP all have them. Correct is not the same as unique.

**Behind.**
- Ecosystem and documentation against Tone.js. Not close, and not a DSP problem.
- Multi-target codegen against Faust. Faust solves parity drift structurally; this repository
  pays a permanent tax and keeps it visible with harnesses instead.
- No FFT or spectral processing on hardware yet.
- ~~CI has never run, so none of the quality claims are mechanically enforced.~~ CORRECTED
  2026-08-15: it has run 26 times, 19 green and 7 failures, all seven of them pull requests
  on a feature branch, with every run on main green. The gates are enforced. This line stood
  for weeks after it stopped being true, which is the failure mode the harnesses in this
  repository exist to prevent and the one class of claim none of them can reach.

## What the research implies, in priority order

1. **`int16` delay storage.** The Teensy Audio Library's central decision, and after exact
   sizing the delay buffers are still 86 percent of RAM in `s5_all` (MEASURED). Halving them is
   the largest remaining lever on the constraint that actually binds. It costs quantisation noise
   in a feedback path, so it belongs behind a template parameter with `float` as the default, and
   it needs measuring before it ships.
2. **Make the scale layer tuning-aware.** This is a correctness fix and a competitive one at the
   same time. The differentiator is claimed, contested by Tune.js, and currently incomplete.
3. **CMSIS-DSP for the spectral family on Cortex-M.** Already recommended in `docs/HARDWARE.md`
   and still unstarted. Each spectral effect is 84 to 204 KB of state, so this is also the thing
   that decides whether a board has enough RAM.
4. **Psychoacoustic analysis.** Critical bands, masking and roughness. The loudness work proves
   this codebase can implement a standard exactly, the analysis scaffolding exists, and nothing
   surveyed on the web side occupies this ground.
5. **The elasto-plastic friction model**, if and only if the bowed string is revisited. Read
   `docs/BOWED-STRINGS.md` first; that file records measured evidence and gates that a change
   here must not loosen.

**Deliberately not doing, and why.**
- Fixed point below the Cortex-M4 line. That is not an optimisation of this library, it is a
  different library, and Mozzi already is it. An Arduino Uno has 2 KB of SRAM against a 2492 byte
  kernel and no FPU; the gap is not closeable by tuning.
- Multi-target codegen. Faust is that tool. Adopting it is a rewrite, and the strategic fork in
  `docs/HARDWARE.md` lays out the trade.
- Replacing the tabulated BLEP with a closed-form method. polyBLEP, DPW and PTR are all cheaper
  and all worse: the four-point polyBLEP measures about -37 dB here against the tabulated
  kernel's -86.6 (MEASURED), and the literature puts fourth-order polyBLEP at perceptually
  alias-free only to about 4 kHz (SOURCED).

## Sources

- Jaffe and Smith, Extensions of the Karplus Strong Plucked String Algorithm, CMJ 1983
- Smith, Digital Waveguide Modeling of Bowed Strings, CCRMA
- Serafin and Avanzini, Bowed String Simulation Using an Elasto-Plastic Friction Model
- ITU-R BS.1770-5, EBU R128, EBU Tech 3341 and 3342
- Scala scale file format, Huygens-Fokker
- Taylor, Tune.js: A Microtonal Web Audio Library
- Mozzi, DaisySP, Teensy Audio Library and CMSIS-DSP: see `docs/HARDWARE.md`

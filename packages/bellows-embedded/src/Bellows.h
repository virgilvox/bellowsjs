/*
 * Bellows: every module in one include.
 *
 * This header exists for convenience and exploration. It is not the
 * recommended way to build a sketch, and the numbers below are why.
 *
 * WHAT IT COSTS
 *
 * Not flash, and this is worth being exact about because the opposite is
 * widely assumed. Every class here is a template or an inline function in
 * a header, so with -ffunction-sections -fdata-sections and
 * -Wl,--gc-sections the linker drops everything the program never names.
 * Measured on Cortex-M7 at -Os, one kick voice and nothing else:
 *
 *     #include "bellows/engines/drums.h"     flash 3760 B   RAM 1100 B
 *     #include "Bellows.h"                   flash 3760 B   RAM 1100 B
 *
 * Byte for byte identical. Including this header does not put unused
 * engines in the binary. That only happens with a registry, which is
 * exactly why this library does not have one.
 *
 * What it costs is compile time, on every build, forever. Measured on one
 * translation unit, best of five, preprocessed line counts alongside:
 *
 *     kick:    drums.h          0.16 s   17448 lines
 *              Bellows.h        0.20 s   23189 lines
 *     euclid:  seq/euclid.h     0.07 s     366 lines
 *              Bellows.h        0.21 s   23167 lines
 *
 * The kick case is mild because drums.h already reaches the oscillator
 * and its band-limited step tables. The euclid case is the honest worst
 * case and the reason for the advice: a euclidean pattern needs 366 lines
 * of this library, and the umbrella hands it 23167, for a compile three
 * times longer that produces the same binary.
 *
 * The other reason is documentation. On a sketch that touches three
 * modules, three specific includes say what the program is made of.
 *
 * If a program does reach everything, the ceiling is real. Every engine
 * and effect in the library, constructed and driven:
 *
 *     flash 61328 B   RAM 375340 B (mostly the plate reverb tank)
 *
 * WHAT TO DO INSTEAD
 *
 * Include the two or three headers the sketch needs. Each one lists its
 * own dependencies at the top and pulls in nothing else. The split is
 * measurable: bellows/engines/pluck.h costs 6.6 KB because it needs no
 * band-limited step tables, while bellows/engines/va.h costs 28.5 KB
 * because it does. That difference is invisible if everything arrives
 * through one door.
 *
 * The examples under examples/ include specifically, and each one reports
 * its own measured cost in a comment. Read those first.
 *
 * NOT INCLUDED HERE
 *
 * bellows/params.gen.h is a generated parity document that maps the
 * TypeScript ParamSpec defaults onto the C++ Params fields. It is
 * comments and unreferenced arrays, meant to be read rather than
 * compiled, so it is deliberately left out.
 *
 * The two platform adapters are included but self-guard on the SDK, so
 * bellows/platform/teensy.h expands to nothing in a Daisy build and the
 * other way round. Off both targets they cost the empty-TU floor.
 */
#pragma once

/* Configuration and the two things everything else is built on. */
#include "bellows/config.h"
#include "bellows/core/fastmath.h"
#include "bellows/core/prng.h"

/* DSP primitives. */
#include "bellows/dsp/blep_tables.h"
#include "bellows/dsp/delayline.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/lfo.h"
#include "bellows/dsp/noise.h"
#include "bellows/dsp/oscillators.h"
#include "bellows/dsp/oversample.h"
#include "bellows/dsp/waveshaper.h"

/* Voices. */
#include "bellows/engines/drums.h"
#include "bellows/engines/fm.h"
#include "bellows/engines/formant.h"
#include "bellows/engines/modal.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/engines/va.h"
#include "bellows/engines/westcoast.h"

/* Effects. */
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"
#include "bellows/fx/saturator.h"

/* Music theory. Knows nothing about sample rates or buffers. */
#include "bellows/theory/chords.h"
#include "bellows/theory/notes.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/tuning.h"

/* Generative sequencing. Also free of audio. */
#include "bellows/seq/arp.h"
#include "bellows/seq/automata.h"
#include "bellows/seq/euclid.h"
#include "bellows/seq/lsystem.h"
#include "bellows/seq/tempomap.h"

/* Scheduling, voice allocation, compile-time dispatch, MIDI bytes. */
#include "bellows/bank.h"
#include "bellows/io/midi_parse.h"
#include "bellows/kernel.h"
#include "bellows/voicepool.h"

/* Board glue. Both self-guard and vanish off target. */
#include "bellows/platform/daisy.h"
#include "bellows/platform/teensy.h"

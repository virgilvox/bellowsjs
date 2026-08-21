/*
 * BELLOWS_SAMPLE_RATE sizes every compile-time buffer, checked at the
 * default rate and at a rate that is not the literal these headers used to
 * carry.
 *
 * config.h documents the flag as sizing "the template defaults that need to
 * size buffers at compile time (delay lines, pluck loops)". Pluck<> and
 * StereoDelay<> were the two that hardcoded 48000 and ignored it, so a
 * -D BELLOWS_SAMPLE_RATE=96000 build resized the bore, the chorus line, the
 * flanger line, the compressor lookahead, the limiter window and the plate
 * tank, and left the two the sentence names sized for half the rate. That is
 * the direction that breaks: the storage no longer holds the note, and every
 * read clamps rather than reporting, so it is inaudible as a fault and
 * audible as wrong music.
 *
 * Nothing runs here. Every check is a static_assert, so a template default
 * that goes back to a literal fails the compile at the second rate instead
 * of quietly under-sizing a buffer.
 *
 * The list is every template in src/bellows that defaults kSampleRate to the
 * macro, which is nine of them, and it is complete by construction rather
 * than by intention: `grep -rn "kSampleRate = BELLOWS_SAMPLE_RATE" src` is
 * the list, and a template missing from it here is a buffer nothing watches.
 * Two of the nine are the ones this file exists for, Pluck and StereoDelay.
 * The other seven already read the macro and are asserted anyway, so the next
 * one to drift back to a literal is caught here rather than in another audit.
 * An earlier draft of this comment said four, and asserted five units in
 * total, which is how a gate ends up describing coverage it does not have.
 */
#include "bellows/config.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/tube.h"
#include "bellows/engines/waveguide.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"

static_assert(bellows::Pluck<20>::kMaxPeriod == BELLOWS_SAMPLE_RATE / 20 + 4,
              "Pluck<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::StereoDelay<500>::kCap == (500u * BELLOWS_SAMPLE_RATE) / 1000u + 4u,
              "StereoDelay<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Tube<20>::kMaxSamples == BELLOWS_SAMPLE_RATE / 40 + 5,
              "Tube<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Chorus<>::kLineSamples == (31u * BELLOWS_SAMPLE_RATE + 999u) / 1000u,
              "Chorus<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Plate<>::kStoreSamples ==
                  bellows::plate_detail::TotalSamples(BELLOWS_SAMPLE_RATE, 250),
              "Plate<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Flanger<>::kLineSamples == (11u * BELLOWS_SAMPLE_RATE + 999u) / 1000u,
              "Flanger<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Compressor<>::kMaxLookSamples == (10u * BELLOWS_SAMPLE_RATE) / 1000u,
              "Compressor<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Limiter<>::kLatency == (5 * BELLOWS_SAMPLE_RATE + 999) / 1000,
              "Limiter<> does not default its template rate to BELLOWS_SAMPLE_RATE");
static_assert(bellows::Waveguide<20>::kMaxSamples == (BELLOWS_SAMPLE_RATE + 19) / 20 + 8,
              "Waveguide<> does not default its template rate to BELLOWS_SAMPLE_RATE");

int main() { return 0; }

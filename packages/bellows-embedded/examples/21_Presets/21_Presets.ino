/*
 * 21_Presets: the instrument preset table, played end to end.
 *
 * bellows/presets/instruments.h is the port of the TypeScript preset
 * library: all 50 named instruments as flash-resident data, no strings in
 * the audio path, no registry. This sketch walks it. Ten seconds each,
 * four bars of the same part every time, so what changes between them is
 * the instrument and nothing else.
 *
 * presets.h is the program. This file is the board.
 *
 * WHAT THIS EXAMPLE IS FOR
 *
 * 20_Instruments is eleven patches, each written out by hand in its own
 * header, and it is the better place to read how a patch is built. This
 * one is the argument that the preset table works: one shell, one part,
 * eleven engines, and every preset in the library reachable by index or by
 * id with no allocation and no lookup by string on the audio path.
 *
 * BOARDS
 *   Teensy 4.1 builds and links. Eleven engines and their voice pools in
 *   one image is the whole book rather than the cheapest preset in it: the
 *   Pluck pool is 31.5 KB and the Waveguide pool 34 KB, both because
 *   bass-guitar and double-bass shift two octaves down onto a 55 Hz floor,
 *   and the plate the four bowed presets ask for is 25 KB of tank. See the
 *   matrix in examples/README.md for the rest and note that fitting is not
 *   the same as keeping up: nothing here has been run on hardware.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   Headphones in the jack. For any other output see examples 11 to 15.
 *
 * WHAT IS VERIFIED
 *   The preset header compiles standalone for Cortex-M7, every value in it
 *   is diffed against the TypeScript by npm run presets:check, this sketch
 *   links as Teensy 4.1 firmware, and every one of the 50 presets was
 *   instantiated on the host and rendered for a second through this shell:
 *   all finite, all non-silent. Nothing here has been flashed to a board.
 *
 * PORTING
 *   To a Daisy Seed: swap bellows/platform/teensy.h for
 *   bellows/platform/daisy.h and start the audio through DaisyAudio<T>.
 *   presets.h does not change.
 */

#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "presets.h"

static presets::Tour tour;

static bellows::BellowsAudioStream<presets::Tour> node(tour);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  Serial.begin(115200);
  codec.enable();
  codec.volume(0.6f);
  tour.Init(bellows::TeensySampleRate(), 96);
  /* The plate carves its tank at Init and can refuse the rate. Said once
   * here rather than on every string preset, and said at all because a
   * refusal is otherwise four presets that sound a little dry. */
  if (!tour.PlateReady()) Serial.println("plate did not init: the string presets will play dry");

  /* AudioMemory LAST: it is what opens the audio interrupt, and anything
   * initialised after it can be rendered before it is ready. See the note
   * in platform/teensy.h. */
  AudioMemory(20);
}

void loop() {
  for (int i = 0; i < bellows::kInstrumentPresetCount; ++i) {
    tour.Select(i);
    const bellows::InstrumentPreset& pre = tour.Current();

    Serial.print(i + 1);
    Serial.print("/");
    Serial.print(bellows::kInstrumentPresetCount);
    Serial.print("  ");
    Serial.print(pre.label);
    Serial.print("  [");
    Serial.print(bellows::FamilyName(pre.family));
    Serial.print("/");
    Serial.print(bellows::PresetEngineName(pre.engine));
    Serial.print("]  gain ");
    Serial.print(pre.gain, 2);
    if (pre.octave != 0) {
      Serial.print("  oct ");
      Serial.print(pre.octave);
    }
    /* The one preset whose insert has no port. Saying so beats letting it
     * sound thinner than the browser does for no stated reason. */
    if (pre.fx == bellows::kFxTapeDelay) Serial.print("  (tape delay not ported, dry)");
    /* The one thing Select can get wrong, and it is silent otherwise: the
     * bank's slot order has to be PresetEngine's order. */
    if (!tour.Loaded()) Serial.print("  NOT LOADED, bank order does not match PresetEngine");
    Serial.print("   cpu ");
    Serial.print(AudioProcessorUsageMax(), 1);
    Serial.println("%");
    AudioProcessorUsageMaxReset();

    /* Four bars of sixteenths at 96 bpm is exactly 10 seconds. */
    delay(10000);
  }
}

/*
 * 05_MidiInstrument: USB MIDI in, eight voice polysynth out.
 *
 * Plug the Teensy into a computer and it appears as a MIDI device. Play
 * it from a DAW or a controller. Responds to note on/off with velocity,
 * pitch bend, CC74 for brightness, and CC123 all-notes-off.
 *
 * BOARD SETUP
 *   Arduino IDE: Tools > USB Type > "MIDI" or "Serial + MIDI". Without
 *   this the board enumerates as serial only, usbMIDI is not declared,
 *   and the sketch does not compile.
 *
 *   PlatformIO: the menu has no equivalent, so set the define yourself.
 *     build_flags = -D USB_MIDI_SERIAL
 *   board_build.usb_type does NOT work on the teensy platform; it is
 *   silently ignored and you get the same undeclared usbMIDI error.
 *
 * WHY THE PARSE IS NOT usbMIDI's JOB
 *   The Teensy library already hands you a decoded note number, so this
 *   sketch could skip bellows/io/midi_parse.h entirely, and for USB alone
 *   that is a reasonable choice. It is wired through the library parser
 *   because the moment a second transport appears (DIN on Serial1, BLE
 *   MIDI, a hardware sequencer over UART) that transport gives you raw
 *   bytes and you want one decoder, tested on a host, rather than one per
 *   port. Both paths are shown below.
 *
 * WIRING (Teensy 4.x plus the Rev D audio shield)
 *   USB to the host. Headphones in the jack. For DIN MIDI add an opto
 *   isolator on RX1, uncomment the Serial1 block in loop(), and the same
 *   HandleBytes call decodes it.
 */

#include <Audio.h>

#include "bellows/platform/teensy.h"
#include "midiinstrument.h"

static midiinstrument::Instrument instrument;

static bellows::BellowsAudioStream<midiinstrument::Instrument> node(instrument);
static AudioOutputI2S out;
static AudioControlSGTL5000 codec;
static AudioConnection patchL(node, 0, out, 0);
static AudioConnection patchR(node, 1, out, 1);

void setup() {
  AudioMemory(16);
  codec.enable();
  codec.volume(0.7f);
  instrument.Init(bellows::TeensySampleRate());
}

void loop() {
  /* USB path: rebuild the three status bytes and hand them to the same
   * decoder the DIN path would use, so there is only one place where a
   * MIDI message becomes a note. */
  while (usbMIDI.read()) {
    uint8_t type = usbMIDI.getType();
    uint8_t chan = usbMIDI.getChannel();
    if (type < 0x80 || chan < 1 || chan > 16) continue;

    const uint8_t bytes[3] = {
        static_cast<uint8_t>(type | (chan - 1)),
        static_cast<uint8_t>(usbMIDI.getData1()),
        static_cast<uint8_t>(usbMIDI.getData2()),
    };
    instrument.HandleBytes(bytes, 3);
  }

  /* DIN path, for a 5 pin socket on Serial1 through an opto isolator.
   * Uncomment along with Serial1.begin(31250) in setup(). Bytes arrive
   * one at a time, so they are buffered into a three byte message first.
   *
   * static uint8_t buf[3];
   * static int have = 0;
   * while (Serial1.available()) {
   *   uint8_t b = Serial1.read();
   *   if (b & 0x80) { buf[0] = b; have = 1; }
   *   else if (have >= 1 && have < 3) { buf[have++] = b; }
   *   if (have == 3) { instrument.HandleBytes(buf, 3); have = 1; }
   * }
   */
}

import type { DocPage } from '../types';

/*
 * A how-to: one task, one answer, action and only action. The comparison of
 * all seven output paths stays in emb-output, which is reference. Somebody
 * who arrives here has a board and wants a noise out of it, and the worst
 * thing this page could do is make them choose first.
 *
 * Every pin and part in here is read out of the example headers rather than
 * from memory, and each section names the example that is written for it, so
 * a reader can open working code rather than assemble one from prose.
 */
const page: DocPage = {
  slug: 'emb-how-output',
  title: 'How to get sound out of a Teensy',
  blurb: 'Pick one of three, wire it, and open the example written for it. The full comparison is elsewhere.',
  prev: 'emb-put-it-on-a-board',
  next: 'emb-how-silent',
  body: `
You have a board and you want to hear it. There are seven ways to get audio out of a Teensy and you do not need to compare them today, so this page picks for you: three answers, one for each of the situations people are actually in.

If you would rather choose deliberately, [Output and wiring](/docs/emb-output) has all seven with what each one costs in quality.

## If you want it loud, on a speaker, for three dollars

**Use a MAX98357A I2S amplifier breakout.** Digital audio in, speaker out, amplifier included, nothing to configure.

| Teensy 4.x | Breakout |
| --- | --- |
| pin 7 | DIN / SD / DATA |
| pin 21 | BCLK / SCK / BCK |
| pin 20 | LRC / WS / LCK |
| 5V | VIN |
| GND | GND |

Speaker across **+** and **-**. On a Teensy 3.x the three signal pins are 22, 9 and 23 instead.

Power it from **5V**, not from the Teensy's 3.3V regulator. It is a 3 watt amplifier, and starved of current it glitches on loud notes rather than going quiet, which reads as a bug in the audio code.

The example is **11_I2SAmp**.

## If you want line out, into a mixer or an interface

**Use a PCM5102A or UDA1334A breakout.** Same wiring as above, same example, no amplifier: you get a clean line level instead of a speaker drive. Both are I2S DACs with no control interface, so there is still nothing to configure.

The example is **11_I2SAmp**, unchanged. The breakout is the only difference.

## If you want headphones, line in, and a volume control

**Use the Teensy Audio Shield.** It stacks on the board, so there is no wiring at all, and it brings a headphone amplifier, a line input and an SGTL5000 codec.

It costs more than a breakout and it uses more pins, which is the trade. It is also the only one of the three that can record.

The example is **10_AudioShield**, and it is the one case where your sketch needs a codec object:

\`\`\`cpp
static AudioControlSGTL5000 codec;

void setup() {
  codec.enable();
  codec.volume(0.5f);
}
\`\`\`

If you forget \`codec.enable()\` the shield is silent with no error, which is the single most common way to lose an evening with one.

Leave the volume near 0.5 and change the level in your patch instead. That call drives the headphone amplifier rather than the converter, so turning it up to compensate for a quiet render amplifies the codec's noise floor along with the music.

## Whichever you picked

Three things are true of all of them.

- **The level in the patch is the level you get**, unless you are on the audio shield with its volume control. Breakouts have no volume setting.
- **Voices add into the block.** If one voice is quiet, one voice is quiet; if eight are loud, they clip. There is a limiter in \`fx/dynamics.h\` for that.
- **\`AudioMemory()\` goes last in \`setup()\`**, after everything else is initialised. Anything set up after it can be rendered before it is ready.

If you wire it and hear nothing, do not start changing things: [How to work out why it is silent](/docs/emb-how-silent) halves the problem four times instead.
`,
};

export default page;

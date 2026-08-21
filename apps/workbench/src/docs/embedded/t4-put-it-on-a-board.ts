import type { DocPage } from '../types';

/*
 * Tutorial page four, and the only one with hardware in it.
 *
 * TWO HONESTY CONSTRAINTS, because this page tells somebody to spend money.
 *
 * The wiring taught here is the rig that has actually been run and heard,
 * twice: a MAX98357A on pins 7, 21 and 20 powered from 5V, which is
 * 17_WorkstationI2S's setup. The SKETCH taught here is 11_I2SAmp, which is
 * written for exactly that part and is build-verified rather than heard. The
 * page says which is which and does not blur them.
 *
 * It is 11_I2SAmp rather than 01_OneKick, which was the first plan, because
 * 01_OneKick.ino instantiates AudioControlSGTL5000: it is written for the
 * audio shield, and pairing it with an I2S breakout would have sent a
 * beginner to configure a codec that is not on their desk.
 */
const page: DocPage = {
  slug: 'emb-put-it-on-a-board',
  title: 'Put it on a board',
  blurb: 'A Teensy, a three dollar amplifier and a speaker. What to buy, five wires, and the sketch to upload.',
  prev: 'emb-give-it-a-tune',
  next: 'emb-how-output',
  body: `
Everything so far ran in a browser tab. This page is the same library on a chip you can put in a box.

It takes three parts and five wires.

## What you need

- **A Teensy 4.0 or 4.1.** Any Teensy from the 3.2 up will run this, and the 4.x is the one to buy if you are choosing today.
- **A MAX98357A I2S amplifier breakout.** About three dollars. It takes digital audio in and drives a speaker directly, so there is no separate amplifier and nothing to configure. A PCM5102A or UDA1334A is the same wiring with a line output instead, if you would rather go into a mixer.
- **A small speaker**, 4 or 8 ohm.
- Somewhere to put the wires: a breadboard, or a soldering iron.

You also need the Teensy toolchain, which is [Teensyduino](https://www.pjrc.com/teensy/td_download.html) on top of the Arduino IDE. Install that first and check you can upload the blink example before adding anything of ours to the picture. If blink does not upload, nothing after this will either, and it is much easier to debug on its own.

## Wire it

Five wires, on a Teensy 4.x:

| Teensy | Breakout | What it is |
| --- | --- | --- |
| pin 7 | DIN / SD / DATA | the audio |
| pin 21 | BCLK / SCK / BCK | the bit clock |
| pin 20 | LRC / WS / LCK | left or right |
| 5V (the VIN pad) | VIN | power |
| GND | GND | ground |

Then the speaker across the breakout's **+** and **-**.

**Take the power from 5V, not from the Teensy's 3.3V pin.** This is the mistake that costs people an evening. A MAX98357A is a 3 watt amplifier, and at any real volume it pulls more than the Teensy's small regulator wants to give. When that happens the board browns out, and a brownout does not look like a power problem. It looks like the audio glitching on loud notes, and you will spend an hour blaming the library.

The pins are different on a Teensy 3.x: data is 22, BCLK is 9, LRCLK is 23. They belong to the audio library rather than to you, so do not pick your own.

## Install the library and open the example

In the Arduino IDE: **Sketch, Include Library, Manage Libraries**, search for **Bellows**, install. On the command line that is \`arduino-cli lib install Bellows\`.

Then **File, Examples, Bellows, 11_I2SAmp**. Upload it.

You should hear a repeating chord. That is the same DSP you have been listening to for the last three pages, running on a chip in your hand.

## If it is silent

Silence with no error message is the normal first result on hardware, and it is not a sign you have done anything stupid. It is the hardest failure in this whole field because nothing tells you which half is wrong.

Two checks, in this order, and they cut the problem in half each time:

1. **Does the Teensy's own LED blink on the blink example?** If not, the problem is the board or the upload, and nothing to do with audio.
2. **Does the same patch sound right in this browser?** It does; you heard it. So if the board is running and the browser is fine, the fault is below the DSP: wiring, power, or the speaker. That is four wires to check rather than a whole program.

The full version of that, with more splits, is [How to work out why it is silent](/docs/emb-how-silent).

## What has actually been run

Being straight about this, because the page just asked you to buy something.

The wiring above is the rig that has been built and heard, twice, on a Teensy 4.0 at 44.1 kHz through a MAX98357A. The sketch above is compiled and linked as real firmware for every Teensy from the 3.2 up on every commit, and has not itself been flashed and listened to. Everything else in this library is checked the same way: built, linked, and compared numerically against the browser implementation, which is a strong position and is not the same as somebody having heard it.

## What you just did has a name

The Teensy Audio Library owns the sound card and the clocks; bellows renders into the blocks it asks for. That split is why five wires and one example is all it takes, and it is why the same patch can run in a browser and on a chip without being written twice.

You have the whole loop now: make a sound, sequence it, give it pitch, put it on hardware.

Where to go next depends on what you want:

- The details you have been let off so far, including what all this costs in flash and RAM: [What the port is](/docs/emb-getting-started).
- Every engine, with its parameters: [Engines](/docs/emb-engines).
- Other ways of getting sound out, including the audio shield and a piezo disc: [Output and wiring](/docs/emb-output).
`,
};

export default page;

import type { DocPage } from '../types';

/*
 * A bisection, not a checklist, and that is the whole design.
 *
 * Research on novice debugging is consistent that beginners default to
 * edit-and-test: changing things with no hypothesis until something moves.
 * A checklist of causes ordered by frequency automates that rather than
 * replacing it. What is actually being taught is LOCALISATION, halving the
 * search until the problem area is too small to hide in.
 *
 * The first split is one no comparable library can offer: the same patch
 * runs in the browser. If it sounds right there and silent on the board,
 * every layer above the DSP is eliminated in one step. That is a real
 * bisection rather than an analogy, because the parity harness measures the
 * distance between the two implementations on every commit.
 */
const page: DocPage = {
  slug: 'emb-how-silent',
  title: 'How to work out why it is silent',
  blurb: 'Silence with no error is this field\'s worst failure. Four splits, each one halving what is left.',
  prev: 'emb-how-output',
  next: 'emb-engines',
  body: `
Nothing is wrong with you. Silence with no error message is the normal first result on hardware, and it is the hardest failure in audio work because nothing tells you which half is broken. A compiler error points at a line. Silence points at everything at once.

So do not start changing things. Changing things at random is the slowest way through this, and it is what almost everybody does. Start by cutting the problem in half, four times.

## Split 1: is the program running at all?

Before anything about audio, find out whether the chip is executing your code.

Upload the plain Arduino **blink** example, or add \`digitalWrite(LED_BUILTIN, HIGH)\` to your \`setup()\`. If the LED does not light, nothing below this line matters: the problem is the board, the cable or the upload, and it is a much easier problem than the one you thought you had.

If you have serial, \`Serial.println("up")\` at the end of \`setup()\` does the same job and tells you more. On a Teensy, open the monitor before you expect the message: the board discards serial output when nothing is listening, so a print at boot is usually lost.

**If the LED lights and you get here, the chip is running your program.** Half of everything is gone.

## Split 2: is the DSP producing samples?

Now find out whether bellows is making a signal, separately from whether that signal is reaching anything.

Print a peak level from inside your render function. Every voice writes into the block you hand it, so measure the block:

\`\`\`cpp
void operator()(float* l, float* r, int from, int to) {
  voice_.Process(l, r, from, to);

  /* Temporary. Print the loudest sample in this block, once a second. */
  static float peak = 0;
  static unsigned long last = 0;
  for (int i = from; i < to; i++) {
    float a = l[i] < 0 ? -l[i] : l[i];
    if (a > peak) peak = a;
  }
  if (millis() - last > 1000) {
    Serial.println(peak);
    peak = 0;
    last = millis();
  }
}
\`\`\`

Numbers above zero mean the DSP is working and the fault is below it, in the output path or the wiring. **Zeros mean the fault is above**, in the patch or in what triggers it, and you can stop looking at wires.

If it prints zeros, the two usual causes:

- **Nothing is triggering the voice.** A voice that has never had \`NoteOn\` called on it renders silence forever, correctly. Put a print next to the call and see whether it happens.
- **\`AudioMemory()\` ran before your patch was ready**, or did not run at all. This one is worth its own paragraph.

### The AudioMemory ordering, which is load bearing

\`AudioMemory()\` is what starts the audio interrupt. Anything you initialise after it can be rendered before it is ready, and on a Teensy 4.x reading through a delay line that has not been given its buffer is a read through a null pointer into executable memory.

Every example here calls \`AudioMemory()\` **after everything bellows owns has been initialised**. Three of them do one more thing afterwards, enabling a codec or starting serial, and that is harmless: those are the output chip and the console, not something the audio interrupt is about to render. What must not come after it is a voice, a delay line or a patch.

This is not a style preference. Every sketch in this library had the ordering the other way round once, which is why it is now commented at every call site.

## Split 3: is anything reaching the pin?

The DSP is producing samples and you cannot hear them. Now the question is whether the samples are leaving the chip.

The cheapest test is to change the destination rather than to inspect it. Take the same sketch and send it somewhere else you can check quickly:

- **Headphones on the line.** With an I2S DAC breakout, the line out drives headphones badly but audibly. If you hear something faint, the chain works and your problem is the amplifier or the speaker.
- **A different output path.** [Output and wiring](/docs/emb-output) has every route this library supports, and swapping to one you have already got working is a stronger test than staring at the one that is not.

The pins belong to the audio library, not to you, and they differ by board generation. On a Teensy 4.x, I2S data is pin 7, bit clock is 21 and word clock is 20. On a 3.x they are 22, 9 and 23. If you picked your own, that is the answer.

## Split 4: is the far end powered and connected?

Everything upstream works. What is left is three or four wires and a part.

- **Power.** A MAX98357A is a 3 watt amplifier and should be fed from 5V, not from the Teensy's 3.3V regulator. Underpowered, it does not go quiet in a way that looks like a power problem; it glitches on loud notes, which looks like a bug in the audio code.
- **Ground.** The breakout and the Teensy need a common ground. Without it you get silence or noise, and both look like software.
- **The speaker.** Across the breakout's + and -, not to ground.
- **Mono summing.** A MAX98357A averages left and right by default. A patch that puts something on one channel and its exact inverse on the other, which the piezo examples do deliberately, sums to silence. That is the one case where correct code plays nothing for a correct reason.

## The split this library has that most do not

Between splits 2 and 3 there is a shortcut worth knowing.

**The same patch runs in this browser.** The playground and the tutorial pages run the TypeScript implementation of the same DSP your C++ compiles from, and the difference between them is measured on every commit rather than asserted.

So: play your patch here. If it sounds right in the browser and silent on the board, the DSP and your patch are both fine, and everything you have left to check is hardware. That is one click, and it removes more of the search space than any other single test on this page.

It does not tell you whether your board is fast enough to render it in time, which is the one thing a browser cannot simulate. For that, print \`AudioProcessorUsageMax()\` and read [Performance](/docs/emb-performance).

## If it is quiet rather than silent

A different problem, and easier.

- The level in the patch is the level you get. Breakouts with no control interface have no volume setting, so if it is quiet, the patch is quiet.
- Voices **add** into the block. Several quiet voices sum to something reasonable; one quiet voice stays quiet.
- A high-pass filter in an output chain can take out most of what you are listening for. The piezo voicing removes everything below 1.2 kHz on purpose, because a disc cannot reproduce it, and on a speaker that sounds thin rather than broken.
`,
};

export default page;

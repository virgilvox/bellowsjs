import type { DocPage } from '../types';

/*
 * Tutorial page one. Structured as PRIMM: predict, run, investigate, modify,
 * and a repack at the end that names what the reader just did.
 *
 * There is not one number in this page that a harness could check, and that
 * is deliberate rather than lazy. Flash figures, RAM figures and parity
 * counts are the answer to "should I depend on this", which is asked second.
 * They are two clicks away on What the port is. Nothing here can go stale.
 */
const page: DocPage = {
  slug: 'emb-make-a-sound',
  title: 'Make a sound',
  blurb: 'A kick drum, in this browser, in about a minute. No board, no toolchain, nothing plugged in.',
  prev: null,
  next: 'emb-make-a-beat',
  body: `
You are going to make a drum sound, change it, and hear the difference. It takes about a minute and you do not need a board, a soldering iron, or anything plugged in.

If you already have a Teensy and you want it making noise now, skip ahead to [Put it on a board](/docs/emb-put-it-on-a-board). Everything here works either way, and this page will still be here afterwards.

## Hear it

The kick below has its decay set to 0.55 seconds. Decay is how long the drum takes to die away.

Before you press play, decide what you think happens if you push that to 2 seconds. A longer boom? A different note? Nothing much? Any answer is fine. The point is to have one, because you will find out in about ten seconds and a guess you have committed to is what makes the answer stick.

\`\`\`listen onekick params=decay,drive
predict: Decay is 0.55 seconds. What do you think 2 seconds sounds like?
One kick drum. Press play, then drag decay.
\`\`\`

Drag **decay** to the far right. Then drag it back. Then try **drive**, which is how hard the drum is pushed into a soft clipper: low is a clean thud, high is a squashed thump with more edge.

You have just changed an instrument while it was playing.

## Find it in the code

This is the whole program, or the part of it that decides what the drum sounds like. It is real C++ from \`examples/01_OneKick\`, not an illustration of it.

\`\`\`cpp
void Init(float sample_rate) {
  bellows::Kick::Params p;
  p.decay = 0.55f;      /* a little longer than the 0.4 default */
  p.drive = 3.0f;       /* and pushed harder into the tanh */
  kick_.Init(sample_rate, p);
}

void Trigger(float hz, float vel) { kick_.NoteOn(hz, vel); }

void operator()(float* l, float* r, int from, int to) {
  kick_.Process(l, r, from, to);
}
\`\`\`

Do not try to understand all of it. Find one thing: **the line that holds the number you were just dragging.** It is there, written the way you would write it, and the slider was doing exactly what editing that line and rebuilding would do.

That is worth a second. The control you dragged is not a simulation of the program. It is the program's own parameter.

## What you just did has a name

The object called \`kick_\` is a **voice**: one sound that can be playing, with parameters you can set. \`Params\` is the struct that holds those parameters, every engine has one, and the fields in it are the sliders you just moved.

You made a sound and changed it while it ran. That is most of what playing an instrument is.

Next: [Make a beat](/docs/emb-make-a-beat), where three of these run at once and something decides when each of them fires.
`,
};

export default page;

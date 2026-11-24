import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'webassembly',
  title: 'WebAssembly',
  blurb: 'Every engine and effect, and the kernel that plays them, compiled to WebAssembly in the bellows-wasm package.',
  prev: 'custom-dsp',
  next: null,
  body: `
By the end of this page you can render any score in WebAssembly without changing it, play the WebAssembly units beside the TypeScript ones to hear the two, and know what runs where and how closely the two agree.

**Try it first.** On the [instrument page](/#play), the engine panel has both: a button that adds the WebAssembly engines beside the TypeScript ones, so you can switch between \`va\` and \`wasm-va\` mid-phrase, and a switch that runs the whole kernel in WebAssembly.

## What it is

\`bellows-wasm\` is its own package, beside \`bellowsjs\`. It carries every engine and effect bellowsjs registers (18 engines, the sampler among them, and 24 effects, the spectral ones among them) and the kernel that plays them, compiled to WebAssembly from bellows-embedded, the C++ library that runs the same DSP on microcontrollers. Every unit takes the same params as its TypeScript twin, draws from the same seeded random streams, and is tested against it.

It is a plugin, like [the singing voice](/docs/singing): the module loads into the AudioWorklet beside the kernel, so a page that never asks for it never carries it. It is about 900 KB, because the plugin is one script that carries the module inline.

\`\`\`js
// npm install bellowsjs bellows-wasm
import { Bellows } from 'bellowsjs';
import { bellowsWasm } from 'bellows-wasm';
\`\`\`

## The whole kernel

\`\`\`js
const b = await Bellows.boot({ plugins: [bellowsWasm({ kernel: true })] });
const lead = b.voice('va', { cutoff: 1200 });
lead.fx('plate');
\`\`\`

With \`{ kernel: true }\` the whole render runs in the module: the event queue and its sample-accurate block splitting, voice allocation and stealing, parameter ramps, gains and pans, insert chains, sends, buses, the master chain and the meter, one call into WebAssembly per 128-frame block. Every builtin plays from it under its own id, so a score needs no changes.

Anything the module does not carry still plays: the singing voice from bellows-voice, a def of your own from [Custom DSP](/docs/custom-dsp), another plugin's engine, or a builtin you replaced with \`registerEngine\`. The kernel calls it in JavaScript at the point the TypeScript kernel would, inside the same render, so it sounds exactly as it does there.

The kernel is chosen when the worklet starts, so the plugin goes to \`Bellows.boot\`; \`b.use()\` refuses it once the instance is running. \`b.render()\` renders with the same kernel as live playback. It needs bellowsjs 0.5.1 or later.

## Beside the TypeScript units

\`\`\`js
const b = await Bellows.boot({ plugins: [bellowsWasm()] });
const ts = b.voice('va');
const wasm = b.voice('wasm-va');   // the same params, the same seed
\`\`\`

Without the option, each unit registers as \`wasm-\` plus its id (\`wasm-va\`, \`wasm-plate\`) and plays inside the TypeScript kernel, for listening to the two side by side. \`bellowsWasm({ replace: true })\` registers them under the TypeScript ids instead. This mode can be added after boot with \`await b.use(bellowsWasm())\`. The sampler is the exception: it plays registered banks, so it runs in the module only in kernel mode.

## On the calling thread

\`renderOffline\` and tests in Node use the same module. Register the plugin on the calling thread, as with any plugin, and name the kernel:

\`\`\`js
import { renderOffline } from 'bellowsjs';
import { KERNEL_NAME, bellowsWasm } from 'bellows-wasm';

bellowsWasm({ kernel: true }).register();
const out = renderOffline(setup, { seconds: 4, sampleRate: 48000, kernelName: KERNEL_NAME });
\`\`\`

A plugin of your own can bring a kernel the same way: \`registerKernel(name, factory)\` on the calling thread, \`globalThis.bellowsKernel.registerKernel\` in its worklet script, and \`kernel: name\` on the plugin. The factory gets the realm's registry, builtin defs, \`rng\`, \`VoicePool\` and interned param names as a \`KernelEnv\`, which is what it needs to play units it does not carry.

## How closely it matches

The TypeScript computes in double, because that is what a JavaScript number is, and the C++ computes in float, because that is what a microcontroller wants, so the two are close rather than identical. Each unit is played through the real kernel both ways at 44.1, 48 and 96 kHz, with params off their defaults and one changed while it sounds, and the difference is measured as its RMS over the RMS of the TypeScript render. Most units sit between 1e-7 and 1e-3. The loosest are the ones whose own feedback amplifies rounding (the bowed string, the wavefolder, long modal rings at high rates), up to a few percent.

The kernel itself is exact. On scores whose units all run in JavaScript, so that only the kernel differs, the WebAssembly kernel gives the TypeScript kernel's samples bit for bit, through voice stealing, ramps, gliding gains and sends, buses, channels replaced and removed, and panic. Sample banks, with their round robin shared between channels, match within 2e-5. The same scores rendered in headless Chrome, through the worklet, hash the same as in Node.

## Speed

Measured on one Apple machine under Node 22 at 48 kHz, with the WebAssembly kernel: engines ran 1.4 to 2.8 times faster than the TypeScript at eight voices, effects 2.4 to 6.7 times faster (the plate most), and a mix of 18 channels with an effect each, two buses and a master chain 1.8 times faster. Run the package's \`test/bench.mjs\` on your own hardware rather than quoting these.

## Limits

- The kernel is chosen at boot. Switching to or from it means a new instance, which the instrument page does for you.
- Values cross into the module as 32-bit floats, so a param or an effect seed beyond 2^24 rounds.
- A channel seed with characters past U+00FF, or longer than 450 characters, plays its engine in JavaScript in kernel mode, because the module hashes bytes where the TypeScript hashes UTF-16 units; its random streams stay the TypeScript's.
- A delay time glided live settles a few samples from its target at high rates.
- The analysis suite (pitch, tempo, chroma, loudness) stays in TypeScript: it runs on the main thread over arrays, not in the kernel.
`,
};

export default page;

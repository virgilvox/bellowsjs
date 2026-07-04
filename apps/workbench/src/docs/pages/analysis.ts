import type { DocPage } from '../types';

const page: DocPage = {
  slug: 'analysis',
  title: 'Analysis',
  blurb: 'Pitch tracking, onsets and tempo, key estimation, and LUFS metering.',
  prev: 'rendering-and-export',
  next: 'midi',
  body: `
By the end of this page you can measure the pitch, tempo, key, and loudness of any buffer, including your own renders.

All of these run on plain Float32Arrays with no browser dependencies, so they work identically on live input, decoded files, and offline renders, in the browser and in Node.

## Pitch: yin and mpm

\`\`\`js
import { yin, mpm } from 'bellowsjs';

const y = yin(buffer, 44100);        // { freq, probability } or null
const m = mpm(buffer, 44100);        // { freq, clarity } or null

if (y) console.log(y.freq.toFixed(1), 'Hz, confidence', y.probability);
\`\`\`

Both are one-shot monophonic pitch trackers over a window (2048 samples works well). YIN is the standard for voice and monophonic instruments; MPM (the McLeod pitch method) reports a \`clarity\` score that drops gracefully on noisy input. Both return null on silence or unpitched sound, so always check. Fed a rendered 220 Hz synth note, both land within a fraction of a hertz. For streaming use, \`YinDetector\` accepts pushed blocks and polls at control rate; the soundfont panel uses it to guess root keys of dropped samples.

## Onsets and tempo

\`\`\`js
import { detectOnsets, estimateTempo } from 'bellowsjs';

const onsets = detectOnsets(buffer, 44100);   // times in seconds
const tempo = estimateTempo(onsets);          // { bpm, confidence }
// or straight from audio:
const tempo2 = estimateTempo(buffer, 44100);
\`\`\`

\`detectOnsets\` runs spectral flux with an adaptive median threshold and returns event times. Expect a few extras on ringing, reverberant material; \`estimateTempo\` shrugs that off because it votes over inter-onset intervals (a rendered 120 bpm kick pattern with ringing tails still reads 120.0). Tempo can fold to half or double the felt rate, a limitation shared by every interval histogram method, so check \`confidence\` and sanity-check the octave.

## Chroma and key

\`\`\`js
import { ChromaAnalyzer, keyEstimate } from 'bellowsjs';

const an = new ChromaAnalyzer(44100);
an.push(buffer, 0, buffer.length);
const chroma = an.poll();             // 12 bins, C first
const key = keyEstimate(chroma);      // { key: 0..11, mode, confidence }
\`\`\`

Chroma folds the spectrum into twelve pitch classes; \`keyEstimate\` correlates the result against the Krumhansl-Kessler major and minor profiles. A rendered C major pad comes back \`{ key: 0, mode: 'major' }\` with confidence around 0.8. Short or harmonically thin material lowers confidence; give it several seconds of audio when you can.

## Loudness: LoudnessMeter

One paragraph of LUFS: broadcast loudness is measured in LUFS (loudness units relative to full scale), which weight the signal the way ears do (the BS.1770 K-weighting) and average over time, so it tracks perceived level where peak meters track voltage. Momentary is a 400 ms window, short-term 3 s, and integrated gates out silence and averages the whole program; loudness range (LRA, in LU) describes how dynamic the program is, and true peak catches inter-sample overs that a sample peak meter misses. Streaming platforms normalize to integrated loudness, commonly -14 LUFS.

\`\`\`js
import { LoudnessMeter, gainToDb } from 'bellowsjs';

const meter = new LoudnessMeter(44100, 2);
meter.push(left, right, 0, left.length);

meter.integrated();          // LUFS for the whole program
meter.shortTerm();           // trailing 3 s
meter.momentary();           // trailing 400 ms
meter.range();               // LRA in LU
gainToDb(meter.truePeak());  // dBTP
\`\`\`

The meter is push-based and streams: feed it block by block during playback or all at once after a render. Methods return \`-Infinity\` until enough audio has arrived.

## End to end: analyze your own render

\`\`\`js
const audio = await b.render({ bars: 8 });

const tempo = estimateTempo(audio.left, audio.sampleRate);
const an = new ChromaAnalyzer(audio.sampleRate);
an.push(audio.left, 0, audio.left.length);
const key = keyEstimate(an.poll());

const meter = new LoudnessMeter(audio.sampleRate, 2);
meter.push(audio.left, audio.right, 0, audio.left.length);

console.log('tempo', tempo.bpm.toFixed(1), 'bpm');
console.log('key', key.key, key.mode, 'confidence', key.confidence.toFixed(2));
console.log('integrated', meter.integrated().toFixed(1), 'LUFS');
console.log('true peak', gainToDb(meter.truePeak()).toFixed(1), 'dBTP');
\`\`\`

Render, then interrogate: does the detected tempo match the transport, does the key match the scale you wrote in, and is the integrated loudness where you want it before you [export](/docs/rendering-and-export)? Because renders are deterministic, these numbers are stable across runs, which makes them useful assertions in tests.
`,
};

export default page;

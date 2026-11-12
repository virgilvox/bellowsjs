/*
 * Does every pitched engine play the note it was asked for?
 *
 * The tuning tests in test/tuning cover the tuning LAYER: Scala parsing,
 * cents arithmetic, the EDO and just-intonation tables. Nothing checked
 * that an engine handed 2637 Hz actually produces 2637 Hz, and that is a
 * different failure with a different cause.
 *
 * It matters most for the delay-line models. A plucked string's loop is
 * sampleRate / freq samples long, which at E7 is 16.72 samples. Round that
 * to an integer and the string plays 2594 Hz, 28 cents flat, and the error
 * grows as the note goes up because the loop gets shorter. The fractional
 * delay and phase-delay compensation that Jaffe and Smith added to
 * Karplus-Strong in 1983 exist to fix exactly this, so this test is the one
 * that distinguishes a real extended Karplus-Strong from a delay line with
 * a lowpass in it. The same argument applies to the waveguide bore and the
 * modal bank's frequency map.
 *
 * Engines whose defaults move the pitch on purpose are neutralised here:
 * va detunes its oscillator pair by 7 cents and formant applies 25 cents of
 * vibrato. Measuring them as shipped measures the expression, not the
 * tuning, which cost the author an afternoon of chasing a bug that was a
 * feature.
 *
 * vocal moves it three ways, all on purpose: a 0.3 semitone vibrato that
 * blooms in from 0.25 s, inside this test's 0.37 s window; a 1/f drift of
 * 6 cents rms, which does not average out over any window; and per-cycle
 * jitter scaled by roughness. Measured over eight seeds (a scratch copy of
 * this measurement): as shipped the worst error was 22.5 cents, with the
 * vibrato off 7.6, with drift off too 3.4, and with roughness 0 as well
 * 1.53. That last residue is the jitter floor CHIMERA keeps at roughness
 * 0 (0.21 percent a cycle, dsp/glottal.ts), averaged over 41 cycles at
 * 110 Hz. So all three are zeroed: the bar is then about the tuning, with
 * the margin every other engine gets, rather than about which seed the
 * jitter happened to draw.
 */

import { describe, expect, it } from 'vitest';
import { rng } from '../../src/core/prng';
import type { EngineDef } from '../../src/types';
import { pluckEngine } from '../../src/engines/pluck';
import { stringEngine, tubeEngine } from '../../src/engines/waveguide';
import { modalEngine } from '../../src/engines/modal';
import { fmEngine } from '../../src/engines/fm';
import { vaEngine } from '../../src/engines/va';
import { formantEngine } from '../../src/engines/formant';
import { vocalEngine } from '../../src/engines/vocal';
import { additiveEngine } from '../../src/engines/additive';
import { harmonicEngine } from '../../src/engines/harmonic';
import { magnitudeSpectrum } from '../dsp-osc/spectrum';

const SR = 44100;
const N = 1 << 14;

/** Defaults that deliberately move the pitch, zeroed so this measures tuning. */
const NEUTRAL: Record<string, Record<string, number>> = {
  va: { detune: 0, drift: 0, sub: 0 },
  formant: { vibratoDepth: 0, vibratoRate: 0, breath: 0 },
  vocal: { vibratoDepth: 0, drift: 0, roughness: 0 },
};

function render(def: EngineDef, hz: number): Float32Array {
  const n = N + 2048;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const voice = def.createVoice(SR, NEUTRAL[def.id] ?? {}, rng('tune/' + def.id));
  voice.noteOn(hz, 1);
  for (let i = 0; i < n; i += 128) voice.process(l, r, i, Math.min(i + 128, n));
  return l;
}

/**
 * Cents between the strongest spectral peak near `target` and `target`.
 * Parabolic interpolation on the log magnitude beats the bin spacing, which
 * at this length is 2.7 Hz and would otherwise swamp the measurement.
 */
function centsError(buf: Float32Array, target: number): number {
  const mags = magnitudeSpectrum(buf.subarray(0, N));
  const binHz = SR / N;
  const lo = Math.max(1, Math.floor((target * 0.945) / binHz));
  const hi = Math.min(mags.length - 2, Math.ceil((target * 1.06) / binHz));
  let peak = lo;
  for (let b = lo; b <= hi; b++) if (mags[b] > mags[peak]) peak = b;
  const a = Math.log(mags[peak - 1] + 1e-30);
  const c0 = Math.log(mags[peak] + 1e-30);
  const c = Math.log(mags[peak + 1] + 1e-30);
  const delta = (0.5 * (a - c)) / (a - 2 * c0 + c || 1e-30);
  return 1200 * Math.log2(((peak + delta) * binHz) / target);
}

/* A2, A4 and E7. The top note is the one that matters: it is where an
 * integer-rounded delay line is 28 cents flat. */
const NOTES = [110, 440, 2637];

const ENGINES: Array<[string, EngineDef]> = [
  ['pluck', pluckEngine],
  ['string', stringEngine],
  ['tube', tubeEngine],
  ['modal', modalEngine],
  ['fm', fmEngine],
  ['va', vaEngine],
  ['formant', formantEngine],
  ['vocal', vocalEngine],
  ['additive', additiveEngine],
  ['harmonic', harmonicEngine],
];

describe('pitched engines play the note they are given', () => {
  for (const [name, def] of ENGINES) {
    it(`${name} tunes within 2 cents across the range`, () => {
      for (const hz of NOTES) {
        const err = centsError(render(def, hz), hz);
        expect(Number.isFinite(err)).toBe(true);
        // 2 cents is inaudible and is about twice the worst measured, which
        // is the pluck at E7. An integer-rounded loop would be 28 cents out.
        expect(Math.abs(err)).toBeLessThan(2);
      }
    });
  }

  it('the delay-line models hold tuning at the top, where rounding would show', () => {
    /* Stated separately because it is the assertion with teeth. At 2637 Hz
     * the loop is 16.72 samples; rounding to 17 plays 2594 Hz. */
    for (const [name, def] of [
      ['pluck', pluckEngine],
      ['string', stringEngine],
      ['tube', tubeEngine],
    ] as Array<[string, EngineDef]>) {
      const err = centsError(render(def, 2637), 2637);
      expect(Math.abs(err), `${name} at 2637 Hz`).toBeLessThan(2);
    }
  });
});

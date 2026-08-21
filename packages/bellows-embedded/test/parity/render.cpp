/*
 * Host-side renderer for the parity harness.
 *
 * Renders one note from a named voice into a raw float32 buffer on stdout,
 * so parity.mjs can diff it against the same note rendered by the
 * TypeScript library. Compiled for the host, not for ARM: the point is to
 * compare algorithms, not instruction sets.
 *
 *   ./render kick 24000 > /tmp/kick.f32
 *
 * Arguments: <voice> <frames> [freq] [vel] [sampleRate]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bellows/engines/additive.h"
#include "bellows/engines/drums.h"
#include "bellows/engines/pluck.h"
#include "bellows/engines/va.h"
#include "bellows/dsp/noise.h"
#include "bellows/dsp/filters.h"
#include "bellows/dsp/envelopes.h"
#include "bellows/core/prng.h"
#include "bellows/theory/tuning.h"
#include "bellows/engines/fm.h"
#include "bellows/engines/modal.h"
#include "bellows/engines/westcoast.h"
#include "bellows/engines/formant.h"
#include "bellows/engines/harmonic.h"
#include "bellows/engines/tube.h"
#include "bellows/engines/wavetable.h"
#include "bellows/engines/waveguide.h"
#include "bellows/fx/eq.h"
#include "bellows/fx/delay.h"
#include "bellows/fx/saturator.h"
#include "bellows/fx/dynamics.h"
#include "bellows/fx/modfx.h"
#include "bellows/fx/plate.h"

namespace {

constexpr int kBlock = 128;

uint32_t SeedFromEnv() {
  const char* s = getenv("BELLOWS_SEED");
  return static_cast<uint32_t>(strtoul(s ? s : "1", nullptr, 10));
}

/* The JS derives a voice's stream by label, and fork is string
 * concatenation, so the harness passes the exact path the JS engine ends
 * up on. See the note in core/prng.h. */
const char* LabelFromEnv(const char* dflt) {
  const char* s = getenv("BELLOWS_RNG_LABEL");
  return (s && *s) ? s : dflt;
}

void Emit(const float* l, const float* r, int n) {
  /* interleaved stereo float32, little endian, straight to stdout */
  for (int i = 0; i < n; ++i) {
    fwrite(&l[i], sizeof(float), 1, stdout);
    fwrite(&r[i], sizeof(float), 1, stdout);
  }
}

template <class V>
void RenderVoice(V& v, int frames, float freq, float vel) {
  float* l = static_cast<float*>(calloc(frames, sizeof(float)));
  float* r = static_cast<float*>(calloc(frames, sizeof(float)));
  v.NoteOn(freq, vel);
  for (int i = 0; i < frames; i += kBlock) {
    int to = i + kBlock > frames ? frames : i + kBlock;
    v.Process(l, r, i, to);
  }
  Emit(l, r, frames);
  free(l);
  free(r);
}

/* Effects are driven by white noise from the shared PRNG, generated the
 * same way on both sides down to the rounding: Rng::Next() casts the
 * uint32 to float before scaling and Bipolar() subtracts in float, and
 * parity.mjs mirrors both roundings with Math.fround. Only then is the
 * input actually bit-identical and the only thing the diff measures the
 * effect's own arithmetic. That claim used to be asserted here and was
 * false: the JS computed 2*(u/2^32)-1 in double and rounded once at the
 * store, which left 17580 of 32768 samples differing at 5.5e-8 rel rms,
 * more than the delay row's own 7.8e-8. The fxin rows now gate it. */
/*
 * Input shape for the effect rows, selected by BELLOWS_FX_DRIVE and mirrored
 * exactly in parity.mjs. u is one draw of Rng::Bipolar().
 *
 * Most effects want a steady signal, and 0.25 is what every row was written
 * against. Two do not, and driving them at 0.25 made their rows vacuous: a
 * limiter whose ceiling is -0.3 dB never engages on a signal that peaks at
 * 0.25, and a gate whose threshold is -40 dB never closes on one. Both rows
 * passed a deliberate mutation because of it.
 *
 * Every constant here is exactly representable in binary floating point:
 * 0.25, 1.5, 1/512, and n * 10 * 2^-24 for integer n with 10n well below
 * 2^24. So each envelope value is the same number in float and in double,
 * and the sweep's sign flip is exact too. 0.25 * 1.6 would not be,
 * and the difference would land in the comparison as if it were the
 * effect's own.
 */
enum class Drive { kSteady, kHot, kBursts, kSweep };

Drive DriveFromEnv() {
  const char* s = getenv("BELLOWS_FX_DRIVE");
  if (s && strcmp(s, "hot") == 0) return Drive::kHot;
  if (s && strcmp(s, "bursts") == 0) return Drive::kBursts;
  if (s && strcmp(s, "sweep") == 0) return Drive::kSweep;
  return Drive::kSteady;
}

/*
 * kBursts and kSweep are both the gate, because neither one alone tests it.
 *
 * kBursts steps between 1 and 1/512 every 4096 samples, which is 93 ms at
 * 44.1 kHz, longer than the gate's 50 ms hold plus 100 ms release, so it
 * fully opens and fully closes four times. What it measures is timing: 0.1
 * percent changes to the gate's attack, hold and release all trip that row,
 * and so does the same change to the detector's own release, because after
 * a step the detector is in free decay and the moment it passes the
 * threshold is set by its time constant.
 *
 * What kBursts cannot see is the thresholds themselves. A step crosses any
 * threshold at the same instant, so kGateHysteresisDb 3.0 -> 3.003 moved
 * that row not at all, to three significant figures. Hence kSweep: a slow
 * triangle that ramps up through the open threshold and back down through
 * the close threshold. It is the mirror image, and the two rows together are
 * what covers the class: on kSweep the detector's release changes the ramp's
 * lag by 0.07 samples of crossing time and the row does not move at all,
 * measured, while the thresholds move it by two orders of magnitude.
 *
 * Three things make the threshold observable on kSweep, and it needs all
 * three.
 *
 * ONE, the samples have to BE the envelope, not noise riding on it. The
 * detector's input is max(|l|, |r|), and with white noise that is a run of
 * peaks scattered by a percent or so, jittering the detector by about 0.05 dB
 * from one sample to the next while the envelope moves 0.0007. The last
 * sample above the close threshold is then chosen by which peak happened to
 * land there, not by the threshold: measured, it was sample 40544 at -43.000
 * dB and sample 40544 at -43.003 dB, moving only once the threshold reached
 * -43.03. So kSweep emits +envelope or -envelope with the sign from the PRNG.
 * |x| is then exactly the ramp, the detector sees it clean, and the crossing
 * is a function of the threshold alone. The signal is still white and still
 * bit-identical on both sides, because a sign flip is exact.
 *
 * TWO, the ramp has to be slow. The close threshold is -43 dB and 0.1 percent
 * of 3 dB moves it by 0.003 dB. At 10 * 2^-24 per sample the detector falls
 * 7.31e-4 dB per sample near the crossing, so the mutation moves the crossing
 * 4.1 samples. A ramp from 0 to 1 over 4096 samples would have moved it by
 * 0.005 samples and rounded to nothing. Slow also means long: 65536 frames,
 * four times the harness default, to finish the sweep and the release.
 *
 * THREE, the crossing must not sit on a sample boundary, or the C++ and the
 * TypeScript land on opposite sides of it for no better reason than float
 * against double, and the row's own baseline eats the mutation. Only the
 * slope moves that phase (changing the base shifts the crossing by whole
 * samples). At 2^-21 the crossing fell 0.002 samples from a boundary and the
 * two sides duly disagreed, C++ closing at 44790 and the JS at 44791, which
 * put the row at 2.7e-5 / 1.4e-6 all by itself. At 10 * 2^-24 the open
 * crossing clears its boundary by 0.455 samples and the close by 0.342, both
 * some fifty times the 0.007 samples of float-against-double uncertainty.
 *
 * Amplitude runs 6554 * 10 * 2^-24 (-48.2 dB, under the -43 dB close
 * threshold) up to 31130 * 10 * 2^-24 (-34.6 dB, over the -40 dB open
 * threshold) and back over 49152 samples, then sits at the floor for the
 * remaining 16384 so the 50 ms hold and 100 ms release play out to completion
 * inside the render. Every value is (6554 + t) * 10 * 2^-24 with t an integer
 * under 2^15, and the product of the integers stays under 2^24, so each one
 * is exact in float and in double.
 */
float DriveSample(Drive d, int i, float u) {
  switch (d) {
    case Drive::kHot:
      return u * 1.5f;  // well past a -0.3 dB ceiling
    case Drive::kBursts:
      return u * (((i / 4096) % 2) == 0 ? 1.0f : 0.001953125f);  // 1 and 1/512
    case Drive::kSweep: {
      const int p = i % 65536;
      const int t = p < 24576 ? p : (p < 49152 ? 49152 - p : 0);
      const float a = static_cast<float>(6554 + t) * 5.9604644775390625e-07f;  // 10 * 2^-24
      return u < 0.0f ? -a : a;
    }
    default:
      return u * 0.25f;
  }
}

template <typename Fx>
void RenderFx(Fx& fx, int frames, uint32_t seed) {
  bellows::Rng r;
  r.Init(seed);
  const Drive drive = DriveFromEnv();
  float* l = static_cast<float*>(calloc(frames, sizeof(float)));
  float* rr = static_cast<float*>(calloc(frames, sizeof(float)));
  for (int i = 0; i < frames; ++i) {
    l[i] = DriveSample(drive, i, r.Bipolar());
    rr[i] = DriveSample(drive, i, r.Bipolar());
  }
  for (int i = 0; i < frames; i += kBlock) {
    int to = i + kBlock > frames ? frames : i + kBlock;
    fx.Process(l, rr, i, to);
  }
  Emit(l, rr, frames);
  free(l);
  free(rr);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: render <voice> <frames> [freq] [vel] [sampleRate]\n");
    return 2;
  }
  const char* which = argv[1];
  const int frames = atoi(argv[2]);
  const float freq = argc > 3 ? static_cast<float>(atof(argv[3])) : 220.0f;
  const float vel = argc > 4 ? static_cast<float>(atof(argv[4])) : 0.9f;
  const float sr = argc > 5 ? static_cast<float>(atof(argv[5])) : 44100.0f;

  bellows::Rng rng;

  if (strcmp(which, "kick") == 0) {
    bellows::Kick v;
    v.Init(sr);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "hat") == 0) {
    bellows::Hat v;
    v.Init(sr);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "snare") == 0) {
    /* The JS forks a child stream labelled 'snare/noise' off the voice
     * stream; the parity script seeds this to the same 32-bit state. */
    rng.Init(LabelFromEnv("parity::snare/noise"));
    bellows::Snare v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "pluck") == 0) {
    rng.Init(LabelFromEnv("parity"));
    bellows::Pluck<20, 44100> v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "va") == 0) {
    rng.Init(LabelFromEnv("parity::va"));
    bellows::Va v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "fm") == 0) {
    bellows::Fm v;
    v.Init(sr);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "modal") == 0) {
    rng.Init(LabelFromEnv("parity"));
    bellows::Modal v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "westcoast") == 0) {
    bellows::WestCoast v;
    v.Init(sr);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "additive") == 0) {
    /* Default params, which at 220 Hz and 44.1 kHz keeps all 32 partials:
     * the highest sits at 7040 Hz against a limit of 19845, so the row
     * covers the whole bank rather than the Nyquist cut. No rng: the JS
     * voice takes one and never draws from it. */
    static bellows::Additive<32> v;
    v.Init(sr);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "additive_morph") == 0) {
    /* The same engine with the four things the default record leaves off:
     * the inharmonicity stretch, the cents conversion, the frame morph and
     * the Nyquist cut, which at inharm 1/64 stops the bank at partial 26.
     * Mirrored by hand from VOICE_PARAMS in parity.mjs, so the row also
     * proves the two sides still agree about what each param means. */
    static bellows::Additive<32> v;
    bellows::Additive<32>::Params p;
    p.morph = 0.5f;
    p.inharm = 0.015625f;
    p.decay = 3.0f;
    p.rolloff = 0.875f;
    p.attack = 0.00390625f;
    p.release = 0.25f;
    p.gain = 0.75f;
    p.detune[1] = 7.0f;
    p.detune[2] = -5.0f;
    p.detune[4] = 12.0f;
    v.Init(sr, p);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "additive_morph_hi") == 0) {
    /* additive_morph with the weight off the halfway point. At morph = 0.5
     * the lerp is symmetric, so writing 1 - morph here renders the same note
     * and that row cannot see it. See the comment on the gate in parity.mjs. */
    static bellows::Additive<32> v;
    bellows::Additive<32>::Params p;
    p.morph = 0.8125f;
    p.inharm = 0.015625f;
    p.decay = 3.0f;
    p.rolloff = 0.875f;
    p.attack = 0.00390625f;
    p.release = 0.25f;
    p.gain = 0.75f;
    p.detune[1] = 7.0f;
    p.detune[2] = -5.0f;
    p.detune[4] = 12.0f;
    v.Init(sr, p);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "formant") == 0) {
    rng.Init(LabelFromEnv("parity"));
    bellows::Formant v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "harmonic") == 0) {
    /* The JS voice hands its own stream straight to NoiseGen and forks
     * nothing, so the C++ Rng sits on the parent label. Default params, and
     * at 220 Hz against a 19845 Hz limit all 64 partials are in play, so the
     * row covers the whole bank rather than the Nyquist cut. */
    rng.Init(LabelFromEnv("parity"));
    bellows::Harmonic v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "tube") == 0) {
    rng.Init(LabelFromEnv("parity"));
    bellows::Tube<20, 44100> v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "waveguide") == 0) {
    /*
     * The string half of waveguide.ts, and the one row where the params are
     * NOT the defaults. On an empty params record the JS engine has bow 0,
     * body 0, vibDepth 0, dynamics 0 and no polDetune key, so the voice is a
     * plain plucked loop and the whole bowed apparatus (friction table, hair
     * lowpass, position comb, 24 body modes, jitter, pitch settle, second
     * polarization) is dead code that no comparison can see. The values
     * below are the ones parity.mjs hands the TypeScript, and they exist to
     * light every branch: bow on, dispersion on so the allpass chain is not
     * an identity, body between two anchors so the morph interpolates rather
     * than picking a row, and a vibrato onset short enough that the raised
     * cosine ramp completes inside 16384 frames.
     *
     * The second polarization exists here because the JS allocates it when
     * the polDetune KEY is present, and parity.mjs passes it. That is the
     * template argument on this side.
     *
     * Two streams. The JS forks 'note' off the voice stream for its per note
     * jitter and settle draws, and fork is string concatenation, so the
     * child label is the parent's plus '::note'. RNG_LABEL['waveguide'] in
     * parity.mjs is 'parity', which is what fixes both.
     */
    rng.Init(LabelFromEnv("parity"));
    static bellows::Rng note_rng;
    note_rng.Init("parity::note");
    using W = bellows::Waveguide<20, 44100, true>;
    static W v;
    W::Params p;
    p.damp = 0.25f;
    p.sustain = 0.75f;
    p.dispersion = 0.125f;
    p.bow = 0.875f;
    p.bow_pressure = 0.5f;
    p.bow_speed = 0.625f;
    p.level = 0.75f;
    p.body = 0.75f;
    p.body_size = 0.25f;
    p.bow_noise = 0.375f;
    p.attack_bite = 0.5f;
    p.vib_rate = 6.0f;
    p.vib_depth = 16.0f;
    p.vib_onset = 0.0625f;
    p.bow_pos = 0.125f;
    p.dynamics = 0.5f;
    p.pol_detune = 2.0f;
    v.Init(sr, &rng, &note_rng, p);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "wavetable") == 0 || strcmp(which, "wavetable_low") == 0) {
    /*
     * One engine, two notes, and the params are not the defaults.
     *
     * On an empty record scanDepth, envToPosition and position are all 0 and
     * filter is off, so the voice would sit on frame 0 of the table forever:
     * a sine through an envelope, with the frame crossfade, the scan LFO,
     * the position clamp and the filter all unmeasured. The values below are
     * the ones parity.mjs hands the TypeScript. Every one is exactly
     * representable in binary floating point, so nothing here is a different
     * number in float and in double before the DSP touches it.
     *
     * position runs 0.25 + 0.5 * lfo + 0.25 * env, which spans -0.25 to 1.0
     * across the render: it clamps at both ends and crosses all four frames,
     * so both sides of the `ff > 0` branch are taken. scan_rate 3 Hz is
     * 1.11 cycles inside 16384 frames, where the motion-pad preset's own 0.2
     * Hz would have covered 7 percent of one. pan 0.375 is off centre on
     * purpose, because the harness compares the left channel only. The
     * lowpass sits at 1024 Hz with resonance 0.75 so that it shapes the
     * note rather than passing it: that is what makes the resonance to Q
     * map observable, and parity.mjs carries the measurement.
     *
     * The two rows differ in pitch alone, and that picks the mip level. At
     * 220 Hz the oscillator reads level 2 (63 harmonics kept); at 55 Hz it
     * reads level 0, which is the level stored at two points per period of
     * its top harmonic and therefore the one where linear interpolation is
     * worst. Level 0 is also the part of the flash blob nothing else reads.
     */
    bellows::Wavetable v;
    bellows::Wavetable::Params p;
    p.position = 0.25f;
    p.scan_rate = 3.0f;
    p.scan_depth = 0.5f;
    p.env_to_position = 0.25f;
    p.attack = 0.03125f;
    p.decay = 0.125f;
    p.sustain = 0.75f;
    p.release = 0.25f;
    p.filter = 1.0f;
    p.cutoff = 1024.0f;
    p.resonance = 0.75f;
    p.pan = 0.375f;
    v.Init(sr, p);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "fxin") == 0) {
    /* No effect at all: the input to every effect row, straight back out.
     * Gated bit exact, because every other effect row assumes it is. */
    struct Identity {
      void Process(float*, float*, int, int) {}
    } fx;
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "eq") == 0) {
    bellows::Eq6 fx;
    bellows::Eq6::Params p;
    /* One shelf, two bells and the top shelf lit, so the bypass path and
     * the active path are both exercised in one run. */
    p.band[0].gain_db = 6.0f;
    p.band[2].gain_db = -4.0f;
    p.band[4].gain_db = 3.0f;
    p.band[5].gain_db = -2.0f;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "delay") == 0) {
    /*
     * Short, fractional, recirculating, and crossed, because the defaults
     * are none of those and the row measured almost nothing.
     *
     * On the defaults both times clamp to the 250 ms maximum, which is 11025
     * samples. The first echo lands at sample 11025 of a 16384 sample render
     * and the second at 22050, outside it, so the feedback gain, the damping
     * filter in the feedback path and the cross-feedback mix never reach the
     * output at all: 0.1 percent mutations of feedback and of damping left
     * the row at 5.72e-8 / 2.98e-8, identical to three figures. The delay
     * time also never moves, so the Smoother is snapped at Init and stays
     * there, and 11025 - 1 is an integer, so ReadCubic interpolates between
     * nothing. The row's own note said "cubic reads, smoothed time".
     *
     * 11/1024 and 17/1024 of a second are 473.73 and 732.13 samples, so the
     * reads are properly fractional, and 33 echoes recirculate inside the
     * render. Both are dyadic and 44100 is an integer, so time * sr is exact
     * in float and in double and no part of the setup drifts on its own.
     * Feedback, cross-feedback and mix are dyadic for the same reason.
     */
    static bellows::StereoDelay<250, 44100> fx;
    bellows::StereoDelay<250, 44100>::Params p;
    p.time_l = 0.0107421875f;  // 11/1024 s, 473.73046875 samples
    p.time_r = 0.0166015625f;  // 17/1024 s, 732.12890625 samples
    p.feedback = 0.375f;
    p.cross_feedback = 0.25f;
    p.mix = 0.5f;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "saturator") == 0) {
    /* Default params, which is curve 0. The other three curves get their
     * own rows below: with only this one, softClip, Foldback and the whole
     * Chebyshev recurrence were constrained by nothing in either language,
     * since the golden render also runs on curve 0. */
    static bellows::Saturator<4, kBlock> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "saturator_soft") == 0) {
    static bellows::Saturator<4, kBlock> fx;
    bellows::Saturator<4, kBlock>::Params p;
    p.curve = bellows::SatCurve::kSoft;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "saturator_fold") == 0) {
    static bellows::Saturator<4, kBlock> fx;
    bellows::Saturator<4, kBlock>::Params p;
    p.curve = bellows::SatCurve::kFold;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "saturator_cheby") == 0) {
    /* The one row where the two implementations are deliberately different
     * algorithms: the JS interpolates a 2048-point table, this evaluates the
     * T(n+1) = 2x T(n) - T(n-1) recurrence directly. The gate is therefore
     * set by the table's interpolation error, not by float rounding. */
    static bellows::Saturator<4, kBlock> fx;
    bellows::Saturator<4, kBlock>::Params p;
    p.curve = bellows::SatCurve::kCheby;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "compressor") == 0) {
    static bellows::Compressor<10, 44100> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "chorus") == 0) {
    static bellows::Chorus<44100> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "chorus_static") == 0) {
    /* Modulation off. Isolates the delay lines, cubic reads, feedback and
     * mix from the LFO timing that dominates the modulated case. */
    static bellows::Chorus<44100> fx;
    bellows::Chorus<44100>::Params p;
    p.depth = 0.0f;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "plate") == 0) {
    static bellows::Plate<44100> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
    /*
     * The six below were ported, built into the size sketches, and never
     * numerically compared to anything. The sketches assert nothing about
     * output; they exist to be measured. All six run on default params,
     * which the two sides declare separately and by hand, so agreeing on
     * the numbers is itself part of what these rows prove.
     */
  } else if (strcmp(which, "limiter") == 0) {
    /* Default detector. The true-peak path is a template parameter, so it
     * would be a different class and a different row. */
    static bellows::Limiter<44100, false, kBlock> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "gate") == 0 || strcmp(which, "gate_sweep") == 0) {
    /* Same unit, two envelopes. The caller picks which through
     * BELLOWS_FX_DRIVE; see the note on Drive above for why one of them is
     * not enough. */
    static bellows::Gate fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "flanger") == 0) {
    static bellows::Flanger<44100> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "flanger_static") == 0) {
    /* Modulation off, for the same reason chorus_static exists: a
     * sample-wise RMS of a time-modulating effect mostly measures the read
     * position, so this is the row that would catch broken flanger DSP. */
    static bellows::Flanger<44100> fx;
    bellows::Flanger<44100>::Params p;
    p.depth = 0.0f;
    fx.Init(sr, p);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "tremolo") == 0) {
    static bellows::Tremolo fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "autopan") == 0) {
    static bellows::AutoPan fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "ringmod") == 0) {
    static bellows::RingMod fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "theory") == 0) {
    /* Not audio: pitch. A wrong tuning table is silent, no test that
     * listens to a buffer can catch it, and 12-EDO is a default here and
     * never an assumption, so the non-12 cases are the ones that matter.
     * Emits frequency for every note index 21..108 across several EDOs,
     * then the same for a just intonation table. */
    static const int kEdos[] = {12, 19, 24, 31, 53};
    for (int e = 0; e < 5; ++e) {
      auto t = bellows::Tuning<64>::Edo(kEdos[e]);
      for (int m = 21; m <= 108; ++m) {
        float f = t.FreqOf(m);
        float z = 0.0f;
        fwrite(&f, sizeof(float), 1, stdout);
        fwrite(&z, sizeof(float), 1, stdout);
      }
    }
    /* 5-limit just intonation, the ratios the JS documents. */
    static const float kJi[] = {1.0f,      16.0f / 15, 9.0f / 8,  6.0f / 5,  5.0f / 4,
                                4.0f / 3,  45.0f / 32, 3.0f / 2,  8.0f / 5,  5.0f / 3,
                                9.0f / 5,  15.0f / 8};
    auto ji = bellows::Tuning<64>::Ji(kJi, 12);
    for (int m = 21; m <= 108; ++m) {
      float f = ji.FreqOf(m);
      float z = 0.0f;
      fwrite(&f, sizeof(float), 1, stdout);
      fwrite(&z, sizeof(float), 1, stdout);
    }
  } else if (strcmp(which, "prng") == 0) {
    /* Not a voice: dump the raw PRNG stream so parity can prove the
     * generators are bit identical before blaming DSP for a difference. */
    rng.Init(static_cast<uint32_t>(strtoul(getenv("BELLOWS_SEED") ?: "1", nullptr, 10)));
    for (int i = 0; i < frames; ++i) {
      float a = rng.Next();
      float b = 0.0f;
      fwrite(&a, sizeof(float), 1, stdout);
      fwrite(&b, sizeof(float), 1, stdout);
    }
  } else {
    fprintf(stderr, "unknown voice: %s\n", which);
    return 2;
  }
  return 0;
}

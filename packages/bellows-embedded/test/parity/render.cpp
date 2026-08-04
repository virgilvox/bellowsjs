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
#include "bellows/engines/tube.h"
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

/* Effects get a bit-exact input: white noise straight from the shared
 * PRNG, so both implementations see identical bits and the only thing the
 * diff can be measuring is the effect's own arithmetic. */
template <class Fx>
void RenderFx(Fx& fx, int frames, uint32_t seed) {
  bellows::Rng r;
  r.Init(seed);
  float* l = static_cast<float*>(calloc(frames, sizeof(float)));
  float* rr = static_cast<float*>(calloc(frames, sizeof(float)));
  for (int i = 0; i < frames; ++i) {
    l[i] = r.Bipolar() * 0.25f;
    rr[i] = r.Bipolar() * 0.25f;
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
  } else if (strcmp(which, "formant") == 0) {
    rng.Init(LabelFromEnv("parity"));
    bellows::Formant v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
  } else if (strcmp(which, "tube") == 0) {
    rng.Init(LabelFromEnv("parity"));
    bellows::Tube<20, 44100> v;
    v.Init(sr, &rng);
    RenderVoice(v, frames, freq, vel);
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
    static bellows::StereoDelay<250, 44100> fx;
    fx.Init(sr);
    RenderFx(fx, frames, SeedFromEnv());
  } else if (strcmp(which, "saturator") == 0) {
    static bellows::Saturator<4, kBlock> fx;
    fx.Init(sr);
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

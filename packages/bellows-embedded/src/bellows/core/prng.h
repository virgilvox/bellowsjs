/* Direct transcription of src/core/prng.ts. All uint32 ops, so streams
 * are bit-identical to the JS for the same seed.
 *
 * FORKING, and how to match a browser stream exactly.
 *
 * The TypeScript derives child streams by label:
 *
 *   rng(label).fork(child)  ===  rng(label + '::' + child)
 *
 * It is literal string concatenation, nothing more, so there is no fork
 * method here and none is needed. Write the full path and you land on the
 * same stream the browser is on:
 *
 *   JS   b.rng('piece').fork('ch0').fork('snare/noise')
 *   C++  rng.Init("piece::ch0::snare/noise")
 *
 * That is deliberate: storing a label per Rng so Fork() could concatenate
 * would cost a char buffer per voice, and the caller already knows the
 * path at the point of construction.
 *
 * Which labels the engines use is a property of the TypeScript, not of
 * this library. As of the port: snare forks 'snare/noise', clap forks
 * 'clap/noise', tom forks 'tom/noise', va forks 'va', formant forks
 * 'vibrato' for its LFO only, and pluck, modal and tube take the parent
 * stream directly. The C++ voices take one Rng and use it the way the JS
 * uses its own, so passing the correctly labelled stream is what makes
 * the noise match. Nothing enforces this: if you pass an unlabelled Rng
 * you get perfectly good noise that is simply not the browser's noise. */
#pragma once
#include <stdint.h>

namespace bellows {

inline uint32_t Xmur3(const char* s) {
  uint32_t h = 1779033703u;
  uint32_t len = 0;
  for (const char* p = s; *p; ++p) ++len;
  h ^= len;
  for (const char* p = s; *p; ++p) {
    h = (h ^ static_cast<uint32_t>(*p)) * 3432918353u;
    h = (h << 13) | (h >> 19);
  }
  h = (h ^ (h >> 16)) * 2246822507u;
  h = (h ^ (h >> 13)) * 3266489909u;
  return h ^ (h >> 16);
}

class Rng {
 public:
  void Init(uint32_t seed) { a_ = seed; }
  void Init(const char* label) { a_ = Xmur3(label); }

  uint32_t NextU32() {
    a_ += 0x6d2b79f5u;
    uint32_t t = (a_ ^ (a_ >> 15)) * (1u | a_);
    t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
    return t ^ (t >> 14);
  }

  /* Matches the JS `/ 4294967296` exactly. */
  float Next() { return static_cast<float>(NextU32()) * 2.3283064365386963e-10f; }
  float Bipolar() { return 2.0f * Next() - 1.0f; }

 private:
  uint32_t a_ = 0;
};

}  // namespace bellows

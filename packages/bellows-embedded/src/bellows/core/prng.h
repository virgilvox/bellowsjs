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
 * you get perfectly good noise that is simply not the browser's noise.
 *
 * LABELS ARE ASCII. The JS hashes str.charCodeAt(i), which is a UTF-16
 * code unit, and str.length, which counts code units. This hashes bytes.
 * The two agree for every character below 0x80 and cannot agree above it,
 * because one U+00E9 is a single 0xE9 code unit in the browser and two
 * bytes (0xC3 0xA9) here. Measured: "cafe" with an acute accent seeds
 * 0x14cad659 in the JS and 0x1ab6029e here. Every label in this tree and
 * every label the engines use is ASCII; keep yours ASCII too, or the
 * stream is simply a different stream from the browser's. */
#pragma once
#include <stdint.h>

namespace bellows {

/*
 * constexpr so the two static_asserts below run on every target this
 * header is compiled for, rather than only where a test happens to run.
 * It is still an ordinary inline function at a runtime call site.
 */
inline constexpr uint32_t Xmur3(const char* s) {
  uint32_t h = 1779033703u;
  uint32_t len = 0;
  for (const char* p = s; *p; ++p) ++len;
  h ^= len;
  for (const char* p = s; *p; ++p) {
    /* Read the byte through unsigned char, never through plain char.
     * Plain char's signedness is implementation defined: signed on the
     * x86-64 host where test/parity/render.cpp is built and where the
     * prng row is proved bit exact, unsigned on ARM EABI, which is every
     * board this library targets. static_cast<uint32_t> of a negative
     * char sign extends, so a byte of 0xE9 entered the mix as
     * 0xFFFFFFE9 on the host and as 0x000000E9 on the board and the two
     * seeds diverged for the rest of the stream. Measured on the label
     * below: 0x33bbfd30 signed against 0x1ab6029e unsigned. The parity
     * harness only ever builds for the host, so it is structurally
     * unable to see that; the asserts below are the gate that is not. */
    h = (h ^ static_cast<uint32_t>(static_cast<unsigned char>(*p))) * 3432918353u;
    h = (h << 13) | (h >> 19);
  }
  h = (h ^ (h >> 16)) * 2246822507u;
  h = (h ^ (h >> 13)) * 3266489909u;
  return h ^ (h >> 16);
}

/* A label whose fourth character is two bytes above 0x7f, so the constant
 * differs between the two signedness choices. Whatever plain char is on
 * the compiler reading this header, one answer has to come out. */
static_assert(Xmur3("caf\xc3\xa9") == 0x1ab6029eu,
              "Xmur3 must hash bytes as unsigned on every target");
/* And an ASCII label, hashed here and in the browser, to pin the half of
 * the contract that the fix must not have moved. Node, same generator:
 * xmur3('bringup')() is 0xe9e81aca. */
static_assert(Xmur3("bringup") == 0xe9e81acau, "Xmur3 must match the JS for ASCII labels");

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

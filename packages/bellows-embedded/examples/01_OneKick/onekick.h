/* Shared logic for the 01_OneKick example.
 *
 * The whole program is one voice and a render function, kept in a header
 * so the .ino and the size-report sketch (test/sketches/p4_e1_onekick.cpp)
 * compile the same code and the reported cost is the real one.
 *
 * This is the smallest useful bellows program, and it is the number the
 * rest of the library is measured against: one kick, one include, no
 * registry, no dispatch table. Measured on Cortex-M7 at -Os with
 * --gc-sections, as the p4_e1_onekick row of tools/size-report.sh:
 *
 *     flash 3776 B    RAM 1100 B
 *
 * The 16 bytes over the s1_kick row's 3760 B are this wrapper class and
 * the non-default Params below; a bare Kick with stock parameters is the
 * 3760 B floor.
 *
 * Note what is not here. There is no engine lookup by name, no base class
 * and no virtual call. Kick is a concrete type, the compiler can see
 * every call into it, and the linker never learns that Snare and Hat
 * exist even though they live in the same header. */
#pragma once

#include "bellows/engines/drums.h"

namespace onekick {

/* A render object: any callable with the library's block signature works
 * as the Render template argument for the Teensy and Daisy adapters. */
class Voice {
 public:
  void Init(float sample_rate) {
    /* Params defaults match the ParamSpec defaults in the TypeScript
     * drums.ts exactly, so this kick sounds like the browser one. */
    bellows::Kick::Params p;
    p.decay = 0.55f;      /* a little longer than the 0.4 default */
    p.drive = 3.0f;       /* and pushed harder into the tanh */
    kick_.Init(sample_rate, p);
  }

  void Trigger(float hz, float vel) { kick_.NoteOn(hz, vel); }

  /* Voices ADD into the range, so the caller owns clearing the block.
   * That is the same contract the TypeScript uses, and it is what lets
   * several voices share one buffer without a mix pass. */
  void operator()(float* l, float* r, int from, int to) {
    kick_.Process(l, r, from, to);
  }

  bool Active() const { return kick_.Active(); }

 private:
  bellows::Kick kick_;
};

}  // namespace onekick

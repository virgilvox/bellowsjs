/*
 * Value parity for the modules that make no sound.
 *
 * A wrong euclidean pattern, scale table or chord interval is silent in
 * the sense that no audio test can hear it: the note that plays is
 * confident, plausible and wrong. This dumps the values as text so
 * tables.mjs can diff them against the TypeScript exactly, with no
 * tolerance, because integers have no excuse.
 */
#include <stdio.h>

#include "bellows/seq/euclid.h"
#include "bellows/seq/arp.h"
#include "bellows/seq/automata.h"
#include "bellows/seq/lsystem.h"
#include "bellows/seq/markov.h"
#include "bellows/seq/tempomap.h"
#include "bellows/theory/scales.h"
#include "bellows/theory/chords.h"
#include "bellows/theory/notes.h"
#include "bellows/io/midi_parse.h"

int main() {
  /* Euclid across the whole useful space. */
  for (int steps = 1; steps <= 16; ++steps) {
    for (int pulses = 0; pulses <= steps; ++pulses) {
      bellows::Euclid<32> e;
      e.Init();
      if (!e.Generate(pulses, steps)) { printf("euclid %d %d REJECT\n", pulses, steps); continue; }
      printf("euclid %d %d ", pulses, steps);
      for (int i = 0; i < steps; ++i) printf("%d", e.At(i) ? 1 : 0);
      printf("\n");
    }
  }
  /* Euclid rotation. */
  for (int rot = -3; rot <= 3; ++rot) {
    bellows::Euclid<32> e;
    e.Init();
    e.Generate(3, 8, rot);
    printf("euclidrot %d ", rot);
    for (int i = 0; i < 8; ++i) printf("%d", e.At(i) ? 1 : 0);
    printf("\n");
  }
  /* Every scale table. */
  for (int t = 0; t < bellows::kScaleCount; ++t) {
    const uint8_t* st = bellows::ScaleSteps(static_cast<bellows::ScaleType>(t));
    const int n = bellows::ScaleLength(static_cast<bellows::ScaleType>(t));
    printf("scale %d %s ", t, bellows::kScaleNames[t]);
    for (int i = 0; i < n; ++i) printf("%d ", static_cast<int>(st[i]));
    printf("\n");
  }
  /* Every chord table. */
  for (int t = 0; t < bellows::kChordCount; ++t) {
    const int8_t* st = bellows::ChordTypeSteps(static_cast<bellows::ChordType>(t));
    const int n = bellows::ChordTypeLength(static_cast<bellows::ChordType>(t));
    printf("chord %d ", t);
    for (int i = 0; i < n; ++i) printf("%d ", static_cast<int>(st[i]));
    printf("\n");
  }
  /* Note parsing and naming round trip. */
  static const char* kNames[] = {"C4", "C#4", "Db-1", "g3", "A0", "B8", "Fx", "H4"};
  for (const char* n : kNames) printf("parsenote %s %d\n", n, bellows::ParseNote(n));
  for (int m = 0; m <= 127; m += 7) {
    char buf[8];
    bellows::NoteName(m, buf, sizeof(buf));
    printf("notename %d %s\n", m, buf);
  }
  /* Elementary CA, the classic rules. */
  static const uint8_t kRules[] = {30, 90, 110, 150};
  for (uint8_t rule : kRules) {
    bellows::ElementaryCa<32> ca;
    ca.Init(rule);
    for (int g = 0; g < 8; ++g) {
      printf("ca %d %d ", static_cast<int>(rule), g);
      for (int i = 0; i < ca.Width(); ++i) printf("%d", ca.Cell(i));
      printf("\n");
      ca.Step();
    }
  }
  /* Arp traversal for every mode. */
  static const float kNotes[] = {60.0f, 64.0f, 67.0f};
  const char* kModeName[] = {"up", "down", "updown", "downup", "random", "order"};
  for (int m = 0; m < 6; ++m) {
    if (m == 4) continue; /* random draws from an rng, compared separately */
    bellows::Arp<16> a;
    bellows::Arp<16>::Params p;
    p.mode = static_cast<bellows::ArpMode>(m);
    p.octaves = 2;
    a.Init(p);
    a.SetNotes(kNotes, 3);
    printf("arp %s ", kModeName[m]);
    for (int i = 0; i < 12; ++i) printf("%d ", static_cast<int>(a.Next()));
    printf("\n");
  }
  /*
   * L-systems. Every other ported seq/ module was compared here from the
   * start and this one was not, so the rewrite was carried, built into
   * s9m_seq and quoted in the size tables without ever being diffed
   * against its source of truth. A rewrite that diverges is silent in
   * exactly the way this file exists to catch.
   *
   * kMaxLen is 512 so nothing below truncates. Truncation is a C++-only
   * behaviour with no JS counterpart, so it is not a parity question and
   * is not asked here.
   */
  {
    struct Case {
      const char* name;
      const char* axiom;
      const char* syms;
      const char* reps[3];
      int rules;
      int gens;
    };
    static const Case kCases[] = {
        /* Algae, the system whose whole point is that the generation is
         * built from the old string and never from itself. Lengths follow
         * Fibonacci only if the rewrite is parallel. */
        {"algae", "A", "AB", {"AB", "A", nullptr}, 2, 8},
        /* Two rules that feed each other, so an order-dependent rewrite
         * diverges within two generations. */
        {"cross", "AB", "AB", {"BA", "AAB", nullptr}, 2, 5},
        /* Symbols with no rule pass through, including brackets. */
        {"through", "A[B]C+A", "A", {"AB", nullptr, nullptr}, 1, 4},
        /* An empty replacement erases its symbol. */
        {"erase", "ABABA", "AB", {"AB", "", nullptr}, 2, 4},
        /* Koch-style turtle string, the classic growth shape. */
        {"koch", "F", "F", {"F+F-F-F+F", nullptr, nullptr}, 1, 3},
    };
    for (const Case& c : kCases) {
      for (int g = 0; g <= c.gens; ++g) {
        bellows::LSystem<512, 8> ls;
        ls.Init();
        ls.SetAxiom(c.axiom);
        for (int r = 0; r < c.rules; ++r) ls.AddRule(c.syms[r], c.reps[r]);
        const bool ok = ls.Grow(g);
        printf("lsys %s %d %d %d %s\n", c.name, g, ok ? 1 : 0, ls.Length(), ls.Result());
      }
    }
    /* MapToDegrees, including the rest sentinel and skipped structure. */
    {
      bellows::LSystem<512, 8> ls;
      ls.Init();
      ls.SetAxiom("A");
      ls.AddRule('A', "AB[C]");
      ls.AddRule('B', "A-C");
      ls.Grow(4);
      static const char kSyms[] = "ABC";
      static const int8_t kDegrees[] = {0, 2, bellows::kRestDegree};
      int8_t out[512];
      const int n = bellows::MapToDegrees(ls.Result(), kSyms, kDegrees, out, 512);
      printf("lsysdeg %d ", n);
      for (int i = 0; i < n; ++i) printf("%d ", static_cast<int>(out[i]));
      printf("\n");
    }
  }
  /*
   * Markov chains, which are the reason this file exists stated in one
   * module: a wrong transition table plays a confident, plausible, wrong
   * melody and no audio test can hear it.
   *
   * The C++ is a rewrite rather than a transcription (the JS keys contexts
   * by JSON string into an unbounded Map), so there is more to get wrong
   * here than anywhere else in this file, and two properties beyond the
   * numbers have to hold. The whole table is dumped, per order, in the
   * order contexts were first recorded, so the comparison sees the
   * FIRST-SEEN ordering of each distribution: reordering the same weights
   * picks a different symbol from the same draw and is otherwise
   * invisible. And the walk is dumped separately so the backoff from order
   * k down to 0 is compared step by step.
   *
   * The draw itself is compared, unlike the arp's random mode and the
   * L-system's stochastic rules, which are excluded here because they draw
   * from an rng. That is possible because Markov::NextWith takes the
   * uniform instead of drawing it, so both sides can be handed the same r.
   * Every r below is a multiple of 1/16 and every weight is a small
   * integer, so r * total and the subtraction chain are exact in float and
   * in double alike and no rounding can reach the comparison. Going
   * through an Rng instead would compare the generator's float rounding,
   * which is the property the fxin rows in parity.mjs already pin.
   *
   * Truncation is a C++-only behaviour with no JS counterpart, so it is
   * not a parity question and is not asked; kMaxContexts is 24 here, above
   * the 21 that the widest case can reach.
   */
  {
    using Chain = bellows::Markov<4, 24, 2>;
    /* (2i + 1) / 16: exactly representable, and no odd numerator can land
     * on a cumulative boundary of the cases below, whose totals are 2, 3,
     * 4, 5 and 10. That is what kEdge is for. */
    static const float kDraws[] = {0.0625f, 0.1875f, 0.3125f, 0.4375f,
                                   0.5625f, 0.6875f, 0.8125f, 0.9375f};
    /* Draws that land EXACTLY on a boundary of the kEdge chain, whose
     * every distribution sums to 16. Without them the comparison cannot
     * tell `x <= 0` from `x < 0`, which is the one line where the two
     * implementations must agree on a tie and where an off-by-one in the
     * walk is otherwise invisible: watched failing on that mutation. */
    static const float kEdgeDraws[] = {0.25f,  0.5f,   0.75f,  0.125f,
                                       0.375f, 0.625f, 0.875f, 0.5f};

    auto dump = [](const char* name, Chain& chain) {
      printf("mkvinfo %s %d %d\n", name, chain.Order(), chain.Contexts());
      for (int k = 0; k <= chain.Order(); ++k) {
        for (int i = 0; i < chain.Contexts(); ++i) {
          const Chain::Context& c = chain.ContextAt(i);
          if (static_cast<int>(c.order) != k) continue;
          uint8_t ctx[2] = {0, 0};
          Chain::Unpack(c.key, c.order, ctx);
          printf("mkvtab %s %d ", name, k);
          if (k == 0) {
            printf("-");
          } else {
            for (int j = 0; j < k; ++j) printf("%d", static_cast<int>(ctx[j]));
          }
          printf(" %d", static_cast<int>(c.count));
          for (int j = 0; j < c.count; ++j) {
            printf(" %d %.6f", static_cast<int>(c.next[j]), static_cast<double>(c.weight[j]));
          }
          printf("\n");
        }
      }
    };

    auto walk = [](const char* name, Chain& chain, const uint8_t* seed, int seed_n,
                   const float* draws) {
      chain.Seed(seed, seed_n);
      for (int i = 0; i < 8; ++i) {
        uint8_t v = 0;
        const bool ok = chain.NextWith(draws[i], &v);
        printf("mkvwalk %s %d %.4f %d %d\n", name, i, static_cast<double>(draws[i]), ok ? 1 : 0,
               ok ? static_cast<int>(v) : -1);
      }
    };

    /* A ten symbol tune over a four symbol alphabet, trained at order 1
     * and again at order 2, so the same data is compared at both depths. */
    static const uint8_t kTune[] = {0, 1, 0, 2, 1, 0, 1, 2, 2, 0};
    static const uint8_t kSeed01[] = {0, 1};
    {
      Chain c;
      c.Init(1);
      c.Train(kTune, 10);
      dump("o1", c);
      walk("o1", c, kSeed01, 2, kDraws);
    }
    {
      Chain c;
      c.Init(2);
      c.Train(kTune, 10);
      dump("o2", c);
      walk("o2", c, kSeed01, 2, kDraws);
    }
    /* Weights accumulated by hand, including a repeated pair, which is the
     * only path that adds into an existing entry rather than appending. */
    {
      Chain c;
      c.Init(2);
      static const uint8_t a0[] = {0};
      static const uint8_t a01[] = {0, 1};
      c.AddTransition(a0, 1, 1, 1.0f);
      c.AddTransition(a0, 1, 1, 1.0f);
      c.AddTransition(a0, 1, 2, 3.0f);
      c.AddTransition(a01, 2, 2, 1.0f);
      c.AddTransition(a01, 2, 3, 2.0f);
      c.AddTransition(a0, 0, 0, 1.0f);
      c.AddTransition(a0, 0, 3, 4.0f);
      dump("add", c);
      walk("add", c, a01, 2, kDraws);
    }
    /*
     * The backoff, on purpose. Trained on three symbols only, then seeded
     * with a context that exists at no order, so the first step falls from
     * 2 to 1 and the second falls all the way to the order-0 distribution.
     */
    {
      Chain c;
      c.Init(2);
      static const uint8_t kShort[] = {3, 0, 1};
      static const uint8_t kUnseen[] = {2, 0};
      c.Train(kShort, 3);
      dump("bko", c);
      walk("bko", c, kUnseen, 2, kDraws);
    }
    /* An untrained chain answers nothing, where the JS throws. */
    {
      Chain c;
      c.Init(2);
      dump("empty", c);
      walk("empty", c, kSeed01, 2, kDraws);
    }
    /*
     * Every distribution sums to 16, so a draw that is a multiple of 1/16
     * can leave the running total at exactly zero. Walked from the empty
     * context, the first three draws each land on a boundary.
     */
    {
      Chain c;
      c.Init(1);
      static const uint8_t e0[] = {0};
      static const uint8_t e1[] = {1};
      static const uint8_t e2[] = {2};
      static const uint8_t e3[] = {3};
      c.AddTransition(e0, 0, 0, 4.0f);
      c.AddTransition(e0, 0, 1, 12.0f);
      c.AddTransition(e0, 1, 1, 8.0f);
      c.AddTransition(e0, 1, 2, 8.0f);
      c.AddTransition(e1, 1, 0, 12.0f);
      c.AddTransition(e1, 1, 3, 4.0f);
      c.AddTransition(e2, 1, 2, 16.0f);
      c.AddTransition(e3, 1, 3, 16.0f);
      dump("edge", c);
      walk("edge", c, e0, 0, kEdgeDraws);
    }
  }
  /* Tempo map: the closed form beat/second conversion, including a ramp. */
  {
    bellows::TempoMap<8> tm;
    tm.Init(120);
    tm.RampTo(8, 180);
    for (int b = 0; b <= 16; ++b) {
      printf("tempo %d %.9f %.9f\n", b, static_cast<double>(tm.BeatToSeconds(b)),
             static_cast<double>(tm.BpmAt(b)));
    }
    for (int i = 0; i <= 8; ++i) {
      const double t = i * 0.75;
      printf("tempoinv %.3f %.9f\n", t, static_cast<double>(tm.SecondsToBeat(t)));
    }
  }
  /* MIDI parsing. */
  {
    const uint8_t msgs[][3] = {
        {0x90, 60, 100}, {0x90, 60, 0}, {0x80, 60, 64}, {0xB0, 7, 100},
        {0xC0, 5, 0},    {0xD0, 90, 0}, {0xE0, 0, 64},  {0xE0, 127, 127},
        {0xA0, 60, 50},  {0xF8, 0, 0},
    };
    for (const auto& m : msgs) {
      bellows::midi::MidiMessage out;
      const bool ok = bellows::midi::Parse(m, 3, &out);
      /* For pitch bend the meaningful value is the assembled 14 bit word,
       * not the raw second byte, so compare that. */
      const int d2 = !ok ? -1
                     : (out.kind == bellows::midi::Kind::kPitchBend
                            ? static_cast<int>(out.bend14)
                            : static_cast<int>(out.data2));
      printf("midi %02x %d %d -> %d kind=%d ch=%d d1=%d d2=%d\n", m[0], m[1], m[2], ok ? 1 : 0,
             ok ? static_cast<int>(out.kind) : -1, ok ? out.channel : -1,
             ok ? out.data1 : -1, d2);
    }
  }
  return 0;
}

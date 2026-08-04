/* Transcription of src/seq/tempomap.ts.
 *
 * Piecewise-linear tempo automation in the beat domain, with exact
 * closed-form conversion between beats and seconds.
 *
 * Over a segment where bpm ramps linearly from (b0, T0) to (b1, T1),
 * with slope k = (T1 - T0) / (b1 - b0), elapsed seconds at beat b are
 *
 *   t(b) = integral of 60 / T(x) dx from b0 to b
 *        = (60 / k) * ln(T(b) / T0)          when k != 0
 *        = 60 * (b - b0) / T0                in the constant-tempo limit
 *
 * and the inverse is
 *
 *   b(t) = b0 + T0 * (exp(k * t / 60) - 1) / k   when k != 0
 *        = b0 + t * T0 / 60                       otherwise.
 *
 * Points come in two flavours. RampTo(beat, bpm) interpolates linearly
 * from the previous point. SetBpm(beat, bpm) is a step: tempo holds the
 * previous value up to `beat`, then jumps. Tempo is constant before the
 * first point and after the last. Lookups binary search the precomputed
 * cumulative times, so both directions are O(log segments).
 *
 * WHY DOUBLE, HERE AND NOWHERE ELSE IN BELLOWS.
 * The DSP is float because on the audio path float is what the FPU and
 * the buffers want. This file is not the audio path: it runs once per
 * scheduled event, and its output is a time that everything downstream
 * trusts. The integral above accumulates across every segment, so a
 * float cumulative array drifts audibly over a long piece with tempo
 * curves, and event times stop matching the JS, which computes in
 * double. On Cortex-M7 the FPU does double in hardware, so the
 * arithmetic is the same handful of instructions either way. Measured,
 * a map with one ramp: 3272 bytes of flash and 280 of RAM in double,
 * 1056 and 144 in float. Almost all of that gap is newlib's double log
 * and exp being fatter than logf and expf, not the arithmetic, and it
 * buys agreement with the library that generated the score. Checked
 * against the JS over a four point map with two ramps and a step: every
 * conversion agrees to all 17 printed digits except one inverse inside
 * a ramp, which differs by two units in the last place because newlib's
 * exp and V8's exp round differently. The accumulation itself
 * contributes nothing.
 *
 * On a target without a double FPU (Cortex-M4F, RP2040, ESP32) double
 * is emulated in software and gets much more expensive in both flash
 * and cycles, so the type is a knob: build with
 * -DBELLOWS_TEMPO_SCALAR=float and every ramp still works, with drift
 * accumulating across segments under a tempo curve and results that no
 * longer match the JS past about the seventh digit.
 *
 * log and exp are called directly rather than through bellows::fm,
 * deliberately. The fm polynomials carry about 1e-4 relative error,
 * which is fine for a filter coefficient and not fine for a timestamp.
 *
 * Two departures from the JS, neither of which changes a result. The
 * points array is fixed at kMaxPoints, and an insert that would exceed
 * it returns false and leaves the map untouched. And the cumulative
 * array is rebuilt eagerly on insert rather than lazily behind a dirty
 * flag: inserts are rare control-rate calls over a handful of points,
 * and doing it eagerly makes every query const.
 */
#pragma once
#include <math.h>

#ifndef BELLOWS_TEMPO_SCALAR
#define BELLOWS_TEMPO_SCALAR double
#endif

namespace bellows {

using TempoScalar = BELLOWS_TEMPO_SCALAR;

namespace detail {
/* Overload pairs so the scalar type picks the right libm entry point
 * without <cmath> and without a cast that would silently narrow. */
inline double TempoLog(double x) { return log(x); }
inline float TempoLog(float x) { return logf(x); }
inline double TempoExp(double x) { return exp(x); }
inline float TempoExp(float x) { return expf(x); }
}  // namespace detail

template <int kMaxPoints = 8>
class TempoMap {
 public:
  static_assert(kMaxPoints >= 1, "TempoMap needs room for the tempo at beat 0");
  static constexpr int kCapacity = kMaxPoints;

  void Init() { Init(static_cast<TempoScalar>(120)); }

  /* Resets to a single constant-tempo point at beat 0. A non-positive
   * bpm falls back to 120 rather than leaving the map unusable. */
  void Init(TempoScalar bpm) {
    if (!(bpm > 0)) bpm = static_cast<TempoScalar>(120);
    n_ = 1;
    pts_[0].beat = 0;
    pts_[0].bpm = bpm;
    pts_[0].ramp = false;
    cum_[0] = 0;
    zero_time_ = 0;
  }

  /* Instantaneous tempo change at `beat`. Tempo before it is unaffected. */
  bool SetBpm(TempoScalar beat, TempoScalar bpm) { return Insert(beat, bpm, false); }

  /* Point reached by a linear ramp from the previous point. */
  bool RampTo(TempoScalar beat, TempoScalar bpm) { return Insert(beat, bpm, true); }

  /* Instantaneous bpm at `beat`. */
  TempoScalar BpmAt(TempoScalar beat) const {
    const int i = PointIndexFor(beat);
    if (i < 0) return pts_[0].bpm;
    if (i >= n_ - 1) return pts_[n_ - 1].bpm;
    const Point& p0 = pts_[i];
    const Point& p1 = pts_[i + 1];
    const TempoScalar t1 = p1.ramp ? p1.bpm : p0.bpm;
    const TempoScalar k = (t1 - p0.bpm) / (p1.beat - p0.beat);
    return p0.bpm + k * (beat - p0.beat);
  }

  /* Seconds elapsed from beat 0 to `beat`. Negative beats give negative
   * times, extrapolated at the first point's tempo. */
  TempoScalar BeatToSeconds(TempoScalar beat) const { return RawTime(beat) - zero_time_; }

  /* Inverse of BeatToSeconds. */
  TempoScalar SecondsToBeat(TempoScalar sec) const {
    const TempoScalar raw = sec + zero_time_;
    const int last = n_ - 1;

    if (raw <= cum_[0]) {
      return pts_[0].beat + ((raw - cum_[0]) * pts_[0].bpm) / kSecPerMin;
    }
    if (raw >= cum_[last]) {
      return pts_[last].beat + ((raw - cum_[last]) * pts_[last].bpm) / kSecPerMin;
    }

    /* Largest i with cum_[i] <= raw. */
    int lo = 0;
    int hi = last;
    while (lo < hi) {
      const int mid = (lo + hi + 1) >> 1;
      if (cum_[mid] <= raw) lo = mid;
      else hi = mid - 1;
    }
    const Point& p0 = pts_[lo];
    const Point& p1 = pts_[lo + 1];
    const TempoScalar t0 = p0.bpm;
    const TempoScalar t1 = p1.ramp ? p1.bpm : t0;
    const TempoScalar k = (t1 - t0) / (p1.beat - p0.beat);
    const TempoScalar dt = raw - cum_[lo];
    if (Abs(k) < kEps) return p0.beat + (dt * t0) / kSecPerMin;
    return p0.beat + (t0 * (detail::TempoExp((k * dt) / kSecPerMin) - 1)) / k;
  }

  int PointCount() const { return n_; }

 private:
  struct Point {
    TempoScalar beat = 0;
    TempoScalar bpm = 120;
    /* True when this point ramps from the previous one instead of stepping. */
    bool ramp = false;
  };

  /* Built by division rather than written as a literal: the library is
   * compiled with -fsingle-precision-constant, which would turn 1e-9
   * into a float before it ever reached a double. */
  static constexpr TempoScalar kEps =
      static_cast<TempoScalar>(1) / static_cast<TempoScalar>(1000000000);
  static constexpr TempoScalar kSecPerMin = static_cast<TempoScalar>(60);

  static TempoScalar Abs(TempoScalar x) { return x < 0 ? -x : x; }

  bool Insert(TempoScalar beat, TempoScalar bpm, bool ramp) {
    if (!(bpm > 0)) return false;
    int i = 0;
    while (i < n_ && pts_[i].beat < beat) ++i;
    if (i < n_ && pts_[i].beat == beat) {
      pts_[i].bpm = bpm;
      pts_[i].ramp = ramp;
    } else {
      if (n_ >= kMaxPoints) return false;
      for (int j = n_; j > i; --j) pts_[j] = pts_[j - 1];
      pts_[i].beat = beat;
      pts_[i].bpm = bpm;
      pts_[i].ramp = ramp;
      ++n_;
    }
    Rebuild();
    return true;
  }

  /* Largest index with pts_[i].beat <= beat, or -1 before the first. */
  int PointIndexFor(TempoScalar beat) const {
    if (beat < pts_[0].beat) return -1;
    int lo = 0;
    int hi = n_ - 1;
    while (lo < hi) {
      const int mid = (lo + hi + 1) >> 1;
      if (pts_[mid].beat <= beat) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /* Seconds over `db` beats of a segment starting at `t0` bpm with slope
   * `k`. This is the integral at the top of the file. */
  static TempoScalar SegSeconds(TempoScalar t0, TempoScalar k, TempoScalar db) {
    if (Abs(k) < kEps) return (kSecPerMin * db) / t0;
    return (kSecPerMin / k) * detail::TempoLog((t0 + k * db) / t0);
  }

  /* Seconds at `beat` measured from the first point's beat. */
  TempoScalar RawTime(TempoScalar beat) const {
    const int i = PointIndexFor(beat);
    if (i < 0) return cum_[0] + (kSecPerMin * (beat - pts_[0].beat)) / pts_[0].bpm;
    if (i >= n_ - 1) {
      const Point& p = pts_[n_ - 1];
      return cum_[n_ - 1] + (kSecPerMin * (beat - p.beat)) / p.bpm;
    }
    const Point& p0 = pts_[i];
    const Point& p1 = pts_[i + 1];
    const TempoScalar t1 = p1.ramp ? p1.bpm : p0.bpm;
    const TempoScalar k = (t1 - p0.bpm) / (p1.beat - p0.beat);
    return cum_[i] + SegSeconds(p0.bpm, k, beat - p0.beat);
  }

  void Rebuild() {
    cum_[0] = 0;
    for (int i = 0; i < n_ - 1; ++i) {
      const Point& p0 = pts_[i];
      const Point& p1 = pts_[i + 1];
      const TempoScalar t1 = p1.ramp ? p1.bpm : p0.bpm;
      const TempoScalar db = p1.beat - p0.beat;
      const TempoScalar k = (t1 - p0.bpm) / db;
      cum_[i + 1] = cum_[i] + SegSeconds(p0.bpm, k, db);
    }
    zero_time_ = 0;
    zero_time_ = RawTime(0);
  }

  Point pts_[kMaxPoints];
  TempoScalar cum_[kMaxPoints] = {};
  TempoScalar zero_time_ = 0;
  int n_ = 1;
};

}  // namespace bellows

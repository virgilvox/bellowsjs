/* Transcription of the HilbertPair in src/fx/freqshift.ts.
 *
 * Splits a signal into a quadrature pair (i, q), 90 degrees apart at all
 * audio frequencies with q leading i. This is Olli Niemitalo's IIR design:
 * two parallel cascades of four second-order allpass sections
 * y[n] = c * (x[n] + y[n-2]) - x[n-2] with c = a * a, the first cascade
 * followed by a one sample delay. The phase difference stays within a
 * fraction of a degree of 90 across roughly 0.002 to 0.498 of the sample
 * rate, and the design does not depend on the rate, so there is nothing to
 * initialise but the state.
 *
 * The JS holds the state in Float64Arrays and squares the coefficients in
 * double; here the state is float and the squares are the double products
 * rounded once to float. */
#pragma once

namespace bellows {

class HilbertPair {
 public:
  static constexpr int kSections = 4;

  inline void Process(float x) {
    /* Path A, delayed one sample, feeds i. */
    float v = x;
    for (int s = 0; s < kSections; ++s) {
      const float y = kA[s] * (v + y2_[s]) - x2_[s];
      x2_[s] = x1_[s];
      x1_[s] = v;
      y2_[s] = y1_[s];
      y1_[s] = y;
      v = y;
    }
    i_ = held_;
    held_ = v;
    /* Path B feeds q. */
    float w = x;
    for (int s = kSections; s < 2 * kSections; ++s) {
      const float y = kB[s - kSections] * (w + y2_[s]) - x2_[s];
      x2_[s] = x1_[s];
      x1_[s] = w;
      y2_[s] = y1_[s];
      y1_[s] = y;
      w = y;
    }
    q_ = w;
  }

  float I() const { return i_; }
  float Q() const { return q_; }

  void Reset() {
    for (int s = 0; s < 2 * kSections; ++s) x1_[s] = x2_[s] = y1_[s] = y2_[s] = 0.0f;
    held_ = 0.0f;
    i_ = 0.0f;
    q_ = 0.0f;
  }

 private:
  /* a * a for a = 0.6923877778065, 0.9360654322959, 0.988229522686,
   * 0.9987488452737 (path A) and 0.4021921162426, 0.856171088242,
   * 0.9722909545651, 0.9952884791278 (path B). */
  static constexpr float kA[kSections] = {0.47940083485582313f, 0.87621849353931014f,
                                          0.97659758950819930f, 0.99749925593554911f};
  static constexpr float kB[kSections] = {0.16175849836770106f, 0.73302893234149047f,
                                          0.94534970032911325f, 0.99059915668452925f};

  /* Section states, path A in slots 0..3, path B in slots 4..7. */
  float x1_[2 * kSections] = {}, x2_[2 * kSections] = {};
  float y1_[2 * kSections] = {}, y2_[2 * kSections] = {};
  float held_ = 0.0f, i_ = 0.0f, q_ = 0.0f;
};

}  // namespace bellows

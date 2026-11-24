/* Transcription of src/dsp/fft.ts.
 *
 * Radix-2 complex FFT, a real-input wrapper over a half-size complex
 * transform, and the three analysis windows. Same algorithm as the JS: an
 * in-place iterative Cooley-Tukey with the same butterfly order, the same
 * even-odd packing for real input (size/2 + 1 bins, DC and Nyquist purely
 * real), no scaling forward and 1/size inverse.
 *
 * Two departures, neither of which changes a result.
 *
 * The bit-reversal permutation is computed as the transform runs rather
 * than read from a table. It is a set of disjoint swaps, so the order they
 * are made in cannot change the output, and it saves a uint32 per point.
 *
 * The real transform keeps one twiddle table, e^(-2 pi i k / size) for
 * k = 0..size/2, and the half-size complex transform reads every second
 * entry of it: the JS builds a second table for the inner Fft whose entry t
 * is the same angle, -2 pi t / (size/2) = -2 pi 2t / size. Half the
 * twiddle storage, the same values.
 *
 * Storage is the caller's. Each class takes one float buffer and a length,
 * sized with its Samples(n), and Init returns false when the buffer is
 * short or the size is not a power of two, after which the transforms are
 * no-ops rather than faults. Nothing here allocates.
 *
 * Twiddles and windows are float here and double in the JS. They are
 * computed from angles reduced into the first octant (FirstOctantCosSin
 * below), so each value is within about an ulp of the double rounded to
 * float, and the butterflies run in float where the JS rounds to float
 * only on each store. Measured against fft.ts on seeded noise from 2 to
 * 2048 points (test/spectral-dsp.mjs in bellows-wasm): real forward bins
 * within 1.7e-7 of the largest bin, real inverse samples within 3.0e-7 of
 * the largest, complex either way within 1.6e-7, Hann and Hamming within
 * one float ulp (6e-8) and Blackman-Harris within two.
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/core/fastmath.h"

namespace bellows {
namespace fft_detail {

inline constexpr bool IsPow2(uint32_t n) { return n != 0u && (n & (n - 1u)) == 0u; }

/*
 * cos and sin of 2 pi k / n for k in [0, n/2], n a power of two.
 *
 * Computing kTwoPi * k / n in float puts an absolute error of about 2e-7
 * on the angle near pi, which the twiddle inherits. Folding into the first
 * octant first keeps the angle at or below pi/4, where the same relative
 * error is under 1e-7: the second quadrant through cos(pi - x) = -cos(x),
 * and the second octant through cos(pi/2 - x) = sin(x). The folds are
 * exact because they are done on the integer k.
 */
inline void FirstOctantCosSin(uint32_t k, uint32_t n, float* c, float* s) {
  bool flip = false;
  if (k > n / 4u) {
    k = n / 2u - k;
    flip = true;
  }
  float cv, sv;
  if (k > n / 8u) {
    const float x = kTwoPi * (static_cast<float>(n / 4u - k) / static_cast<float>(n));
    cv = fm::Sin(x);
    sv = fm::Cos(x);
  } else {
    const float x = kTwoPi * (static_cast<float>(k) / static_cast<float>(n));
    cv = fm::Cos(x);
    sv = fm::Sin(x);
  }
  *c = flip ? -cv : cv;
  *s = sv;
}

/* cos(2 pi i / n) for i in [0, n), through the symmetry about n/2. */
inline float CosTurn(uint32_t i, uint32_t n) {
  float c, s;
  FirstOctantCosSin(2u * i > n ? n - i : i, n, &c, &s);
  return c;
}

/*
 * In-place radix-2 transform of size n. Twiddle t of the JS table, the
 * angle -2 pi t / n, is cs[t * stride] and -sn[t * stride], so a table
 * built for a size stride times larger serves. `inverse` flips the sign of
 * the imaginary twiddle, as the JS `sign` does; scaling is the caller's.
 */
inline void Radix2(float* re, float* im, uint32_t n, const float* cs, const float* sn,
                   uint32_t stride, bool inverse) {
  /* Bit-reversal permutation, j stepping through the reversed indices. */
  for (uint32_t i = 0, j = 0; i < n; ++i) {
    if (j > i) {
      const float tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const float ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    uint32_t bit = n >> 1;
    while (bit != 0u && (j & bit) != 0u) {
      j ^= bit;
      bit >>= 1;
    }
    j |= bit;
  }
  for (uint32_t len = 2; len <= n; len <<= 1) {
    const uint32_t half = len >> 1;
    const uint32_t step = (n / len) * stride;
    for (uint32_t start = 0; start < n; start += len) {
      for (uint32_t k = 0; k < half; ++k) {
        const uint32_t t = k * step;
        const float wr = cs[t];
        /* The table holds sin of the positive angle; the JS sin table
         * holds sin(-2 pi t / n), so forward negates and inverse does not. */
        const float wi = inverse ? sn[t] : -sn[t];
        const uint32_t i0 = start + k;
        const uint32_t i1 = i0 + half;
        const float xr = re[i1] * wr - im[i1] * wi;
        const float xi = re[i1] * wi + im[i1] * wr;
        re[i1] = re[i0] - xr;
        im[i1] = im[i0] - xi;
        re[i0] += xr;
        im[i0] += xi;
      }
    }
  }
}

}  // namespace fft_detail

/* Complex transform, size a power of two. Storage: n/2 cos, n/2 sin. */
class Fft {
 public:
  static constexpr uint32_t Samples(uint32_t n) { return 2u * (n / 2u); }

  bool Init(uint32_t n, float* buf, uint32_t len) {
    n_ = 0;
    if (!fft_detail::IsPow2(n) || (Samples(n) > 0u && (buf == nullptr || len < Samples(n)))) {
      return false;
    }
    const uint32_t half = n / 2u;
    for (uint32_t i = 0; i < half; ++i) fft_detail::FirstOctantCosSin(i, n, &buf[i], &buf[half + i]);
    cs_ = buf;
    sn_ = buf + half;
    n_ = n;
    return true;
  }

  uint32_t Size() const { return n_; }

  /* In place, no scaling. */
  void Forward(float* re, float* im) const {
    if (n_ == 0u) return;
    fft_detail::Radix2(re, im, n_, cs_, sn_, 1u, false);
  }

  /* In place, scaled by 1/size. */
  void Inverse(float* re, float* im) const {
    if (n_ == 0u) return;
    fft_detail::Radix2(re, im, n_, cs_, sn_, 1u, true);
    const float inv = 1.0f / static_cast<float>(n_);
    for (uint32_t i = 0; i < n_; ++i) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }

 private:
  const float* cs_ = nullptr;
  const float* sn_ = nullptr;
  uint32_t n_ = 0;
};

/*
 * Real-input transform over a half-size complex one. Forward takes size
 * samples and writes size/2 + 1 bins; Inverse takes the same layout back.
 * Storage: the size/2 + 1 point twiddle table, cos then sin, then the half
 * size scratch, re then im. The scratch makes the transforms non-const:
 * one RealFft serves any number of channels that call it in turn.
 */
class RealFft {
 public:
  static constexpr uint32_t Samples(uint32_t n) { return 2u * (n / 2u + 1u) + 2u * (n / 2u); }

  bool Init(uint32_t n, float* buf, uint32_t len) {
    n_ = 0;
    if (n < 2u || !fft_detail::IsPow2(n) || buf == nullptr || len < Samples(n)) return false;
    const uint32_t m = n / 2u;
    tw_cos_ = buf;
    tw_sin_ = buf + (m + 1u);
    zr_ = buf + 2u * (m + 1u);
    zi_ = zr_ + m;
    for (uint32_t k = 0; k <= m; ++k) fft_detail::FirstOctantCosSin(k, n, &tw_cos_[k], &tw_sin_[k]);
    for (uint32_t k = 0; k <= m; ++k) tw_sin_[k] = -tw_sin_[k]; /* sin(-2 pi k / n), as the JS */
    n_ = n;
    return true;
  }

  uint32_t Size() const { return n_; }

  /* in has size samples; re and im receive size/2 + 1 bins. */
  void Forward(const float* in, float* re, float* im) {
    if (n_ == 0u) return;
    const uint32_t m = n_ >> 1;
    float* zr = zr_;
    float* zi = zi_;
    for (uint32_t i = 0; i < m; ++i) {
      zr[i] = in[2u * i];
      zi[i] = in[2u * i + 1u];
    }
    Half(zr, zi, false);
    re[0] = zr[0] + zi[0];
    im[0] = 0.0f;
    re[m] = zr[0] - zi[0];
    im[m] = 0.0f;
    /* X[k] = Fe[k] + W^k Fo[k], X[m-k] = conj(Fe[k] - W^k Fo[k]), where
     * Fe and Fo are the transforms of the even and odd sample streams. */
    for (uint32_t k = 1; k <= (m >> 1); ++k) {
      const uint32_t j = m - k;
      const float er = 0.5f * (zr[k] + zr[j]);
      const float ei = 0.5f * (zi[k] - zi[j]);
      const float or_ = 0.5f * (zi[k] + zi[j]);
      const float oi = -0.5f * (zr[k] - zr[j]);
      const float wr = tw_cos_[k];
      const float wi = tw_sin_[k];
      const float fr = or_ * wr - oi * wi;
      const float fi = or_ * wi + oi * wr;
      re[k] = er + fr;
      im[k] = ei + fi;
      re[j] = er - fr;
      im[j] = -ei + fi;
    }
  }

  /* re and im hold size/2 + 1 bins; out receives size samples. */
  void Inverse(const float* re, const float* im, float* out) {
    if (n_ == 0u) return;
    const uint32_t m = n_ >> 1;
    float* zr = zr_;
    float* zi = zi_;
    zr[0] = 0.5f * (re[0] + re[m]);
    zi[0] = 0.5f * (re[0] - re[m]);
    for (uint32_t k = 1; k < m; ++k) {
      const uint32_t j = m - k;
      const float fer = 0.5f * (re[k] + re[j]);
      const float fei = 0.5f * (im[k] - im[j]);
      const float dr = 0.5f * (re[k] - re[j]);
      const float di = 0.5f * (im[k] + im[j]);
      /* Fo[k] = D * W^-k */
      const float wr = tw_cos_[k];
      const float wi = -tw_sin_[k];
      const float fr = dr * wr - di * wi;
      const float fi = dr * wi + di * wr;
      zr[k] = fer - fi;
      zi[k] = fei + fr;
    }
    Half(zr, zi, true);
    const float inv = 1.0f / static_cast<float>(m);
    for (uint32_t i = 0; i < m; ++i) {
      out[2u * i] = zr[i] * inv;
      out[2u * i + 1u] = zi[i] * inv;
    }
  }

 private:
  /* The half-size complex transform, on every second twiddle. The table
   * here holds sin of the negative angle, so the sign convention of
   * Radix2 (which wants sin of the positive one) is flipped. */
  void Half(float* zr, float* zi, bool inverse) const {
    fft_detail::Radix2(zr, zi, n_ >> 1, tw_cos_, tw_sin_, 2u, !inverse);
  }

  float* tw_cos_ = nullptr;
  float* tw_sin_ = nullptr;
  float* zr_ = nullptr;
  float* zi_ = nullptr;
  uint32_t n_ = 0;
};

/* Periodic Hann window: 0.5 - 0.5 cos(2 pi i / n). */
inline void Hann(float* w, uint32_t n) {
  for (uint32_t i = 0; i < n; ++i) w[i] = 0.5f - 0.5f * fft_detail::CosTurn(i, n);
}

/* Periodic Hamming window: 0.54 - 0.46 cos(2 pi i / n). */
inline void Hamming(float* w, uint32_t n) {
  for (uint32_t i = 0; i < n; ++i) w[i] = 0.54f - 0.46f * fft_detail::CosTurn(i, n);
}

/* Periodic 4-term Blackman-Harris window, sidelobes at -92 dB. cos(2t)
 * and cos(3t) are read at 2i and 3i modulo n, which is the same angle. */
inline void BlackmanHarris(float* w, uint32_t n) {
  const float a0 = 0.35875f, a1 = 0.48829f, a2 = 0.14128f, a3 = 0.01168f;
  for (uint32_t i = 0; i < n; ++i) {
    const uint32_t i2 = static_cast<uint32_t>((2ull * i) % n);
    const uint32_t i3 = static_cast<uint32_t>((3ull * i) % n);
    w[i] = a0 - a1 * fft_detail::CosTurn(i, n) + a2 * fft_detail::CosTurn(i2, n) -
           a3 * fft_detail::CosTurn(i3, n);
  }
}

}  // namespace bellows

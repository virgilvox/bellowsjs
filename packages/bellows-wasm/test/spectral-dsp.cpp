/*
 * The transforms under the spectral effects, exported one call each so test/spectral-dsp.mjs can
 * hold them against src/dsp/fft.ts and src/dsp/stft.ts. Built with the module's own runtime.
 */
#include "bellows/dsp/fft.h"
#include "bellows/dsp/stft.h"

extern "C" void* malloc(__SIZE_TYPE__);
extern "C" void free(void*);

#define SD_EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* Real forward transform of n samples into n/2 + 1 bins. */
SD_EXPORT(sd_real_forward) int sd_real_forward(int n, const float* in, float* re, float* im) {
  bellows::RealFft f;
  float* t = static_cast<float*>(malloc(sizeof(float) * bellows::RealFft::Samples(n)));
  const bool ok = f.Init(n, t, bellows::RealFft::Samples(n));
  if (ok) f.Forward(in, re, im);
  free(t);
  return ok ? 1 : 0;
}

/* Real inverse transform of n/2 + 1 bins into n samples. */
SD_EXPORT(sd_real_inverse) int sd_real_inverse(int n, const float* re, const float* im, float* out) {
  bellows::RealFft f;
  float* t = static_cast<float*>(malloc(sizeof(float) * bellows::RealFft::Samples(n)));
  const bool ok = f.Init(n, t, bellows::RealFft::Samples(n));
  if (ok) f.Inverse(re, im, out);
  free(t);
  return ok ? 1 : 0;
}

/* Complex transform in place, forward or inverse. */
SD_EXPORT(sd_complex) int sd_complex(int n, float* re, float* im, int inverse) {
  bellows::Fft f;
  float* t = static_cast<float*>(malloc(sizeof(float) * (bellows::Fft::Samples(n) + 1)));
  const bool ok = f.Init(n, t, bellows::Fft::Samples(n));
  if (ok) {
    if (inverse) f.Inverse(re, im);
    else f.Forward(re, im);
  }
  free(t);
  return ok ? 1 : 0;
}

/* 0 Hann, 1 Hamming, 2 Blackman-Harris. */
SD_EXPORT(sd_window) void sd_window(int kind, int n, float* w) {
  if (kind == 0) bellows::Hann(w, n);
  else if (kind == 1) bellows::Hamming(w, n);
  else bellows::BlackmanHarris(w, n);
}

/* len samples through a StftProcessor with no spectral edit; mode 1 zeroes the odd bins. */
SD_EXPORT(sd_stft) int sd_stft(int n, int hop, const float* in, float* out, int len, int mode) {
  bellows::StftCommon c;
  bellows::StftProcessorExt p;
  const uint32_t cn = bellows::StftCommon::Samples(n, hop);
  const uint32_t pn = bellows::StftProcessorExt::Samples(n, hop);
  float* buf = static_cast<float*>(malloc(sizeof(float) * (cn + pn)));
  bool ok = c.Init(n, hop, buf, cn) && p.Init(&c, buf + cn, pn);
  if (ok) {
    for (int i = 0; i < len; ++i) {
      out[i] = p.Tick(in[i], [mode, &c](float* re, float* im) {
        if (mode == 1) {
          for (uint32_t k = 1; k < c.Bins(); k += 2) re[k] = im[k] = 0.0f;
        }
      });
    }
  }
  free(buf);
  return ok ? 1 : 0;
}

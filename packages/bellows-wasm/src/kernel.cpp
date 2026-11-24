/*
 * The kernel in the module: packages/bellows/src/kernel/engine.ts carried over, so a page can run
 * the whole render (event queue, block splitting, voice pools, param ramps, channel fx, sends,
 * buses, the master chain and the meter) in WebAssembly, one call per block, instead of calling
 * into the module once per voice per block.
 *
 * It follows the TypeScript line for line, including its arithmetic: event times, frames, ramps,
 * gains and pans are doubles as they are in JavaScript, and a value lands in a float buffer at
 * exactly the point where the TypeScript stores into a Float32Array. A mix written as
 * `mixL[i] += l` in the TypeScript rounds once, after adding the unrounded double l, and so does
 * this. With every unit running in JavaScript (below) the two kernels give the same samples bit
 * for bit, which is how test/kernel-parity.mjs checks this file apart from the units.
 *
 * Units the module does not carry (the singing voice, a user's tier 3 def, a plugin's engine, or a
 * builtin someone replaced) still play: such a channel or effect is "foreign", held by the
 * JavaScript side (src/kernel.js), and this file calls out to it through the host_* imports at
 * exactly the points the TypeScript kernel would call the unit. The order of everything else is
 * unchanged, so a foreign unit sounds as it does in the TypeScript kernel.
 *
 * Params are named by a name id the JavaScript side assigns (one per distinct name). Each
 * channel keeps its params record the way VoicePool does, by name id, NaN where the record has no
 * entry, and g_names maps a name id to the param index of each unit, -1 where the unit has no
 * param of that name.
 *
 * Maps in the TypeScript (channels, buses, a channel's sends) keep insertion order, and setting
 * an existing key keeps its place; the ordered lists here do the same, because the order things
 * are mixed in is the order their rounding lands in.
 */
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#include "unit.h"

#define BW_EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define BW_IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

/* A foreign channel or effect, by the handle the JavaScript side gave it. */
BW_IMPORT(host_ch_on) void host_ch_on(int h, double note, double freq, double vel, double frame);
BW_IMPORT(host_ch_off) void host_ch_off(int h, double note);
BW_IMPORT(host_ch_alloff) void host_ch_alloff(int h);
BW_IMPORT(host_ch_param) void host_ch_param(int h, int name, double value);
BW_IMPORT(host_ch_process) void host_ch_process(int h, float* l, float* r, int from, int to);
BW_IMPORT(host_fx_process) void host_fx_process(int h, float* l, float* r, int n);

namespace bwasm {
namespace {

constexpr double kPi = 3.141592653589793;     /* Math.PI */
constexpr double kSqrt2 = 1.4142135623730951; /* Math.SQRT2 */
constexpr double kMaxSafe = 9007199254740991.0;
constexpr int kRampSlots = 32;
constexpr int kCompactAfter = 256;

inline bool Finite(double x) { return __builtin_isfinite(x); }

/* Math.round: halves toward +infinity. x - floor(x) is exact, so this is too. */
inline double JsRound(double x) {
  const double f = __builtin_floor(x);
  return x - f >= 0.5 ? f + 1.0 : f;
}

/* A growable array of trivially copyable values. Grows only on the configuration path. */
template <class T>
struct Vec {
  T* data = nullptr;
  int n = 0;
  int cap = 0;
  bool Reserve(int want) {
    if (want <= cap) return true;
    int c = cap ? cap : 8;
    while (c < want) c *= 2;
    T* d = static_cast<T*>(realloc(data, sizeof(T) * c));
    if (!d) return false;
    data = d;
    cap = c;
    return true;
  }
  bool Push(const T& v) {
    if (!Reserve(n + 1)) return false;
    data[n++] = v;
    return true;
  }
  bool Insert(int at, const T& v) {
    if (!Reserve(n + 1)) return false;
    __builtin_memmove(data + at + 1, data + at, sizeof(T) * (n - at));
    data[at] = v;
    ++n;
    return true;
  }
  void Erase(int at) {
    __builtin_memmove(data + at, data + at + 1, sizeof(T) * (n - at - 1));
    --n;
  }
  T& operator[](int i) { return data[i]; }
  const T& operator[](int i) const { return data[i]; }
  void Release() {
    free(data);
    data = nullptr;
    n = cap = 0;
  }
};

/* The TypeScript Ramp, the linear glide under gains, pans, sends and returns. */
struct Ramp {
  double v = 0, target = 0, step = 0, rate = 0;
  void Init(double sr, double initial, double time = 0.02) {
    const double x = Finite(initial) ? initial : 0.0;
    v = target = x;
    step = 0;
    const double d = sr * time;
    rate = 1.0 / (d > 1.0 ? d : 1.0);
  }
  void Set(double t) {
    if (!Finite(t)) return;
    target = t;
    step = (t - v) * rate;
  }
  void Snap(double x) {
    if (!Finite(x)) return;
    v = target = x;
    step = 0;
  }
  double Next() {
    if (step != 0) {
      const double nv = v + step;
      if ((step > 0 && nv >= target) || (step < 0 && nv <= target)) {
        v = target;
        step = 0;
      } else {
        v = nv;
      }
    }
    return v;
  }
};

struct Event {
  double time, a, b, c;
  int kind, target;
};

enum : int { kNoteOn = 0, kNoteOff = 1, kParam = 2, kParamRamp = 3, kAllNotesOff = 4 };

/* One effect in a chain: a unit in the module, or a foreign effect by handle. */
struct FxSlot {
  Fx* fx;
  int foreign;
};

struct Slot {
  Voice* voice;
  double note;
  double start;
  bool held;
};

struct Send {
  int bus;
  Ramp level;
};

/*
 * A registered sample bank, shared by every channel made on it: the sampler's round-robin counter
 * lives in the bank, as it lives in the TypeScript def. A bank registered again under the same id
 * is a new bank; channels made on the old one keep it, so it is freed when it is no longer
 * registered and its last channel is gone.
 */
struct BankRef {
  Bank* bank;
  int refs;
  bool registered;
};

void Unref(BankRef* b) {
  if (!b) return;
  if (--b->refs <= 0 && !b->registered) {
    FreeBank(b->bank);
    delete b;
  }
}

struct Channel {
  int id = 0;
  int unit = -1;
  int foreign = -1;
  BankRef* bank = nullptr;
  Vec<Slot> slots;
  Vec<double> rec;
  Vec<uint8_t> has; /* rec[i] is an entry of the params record (its value may be NaN, as in JS) */
  Vec<FxSlot> fx;
  Ramp gain, pan;
  Vec<Send> sends;
  float* sl = nullptr;
  float* sr = nullptr;
};

struct Bus {
  int id = 0;
  Vec<FxSlot> fx;
  Ramp ret;
  float* sl = nullptr;
  float* sr = nullptr;
};

struct RampSlot {
  bool active;
  int target;
  int param;
  double from, to, start, end;
};

/* name id x unit -> param index, -1 where the unit has none */
Vec<int16_t> g_names;

int UnitParam(int unit, int name) {
  if (unit < 0 || name < 0) return -1;
  const int i = name * kUnitCount + unit;
  return i < g_names.n ? g_names[i] : -1;
}

void FreeChain(Vec<FxSlot>& chain) {
  for (int i = 0; i < chain.n; ++i) delete chain[i].fx;
  chain.n = 0;
}

void RunChain(Vec<FxSlot>& chain, float* l, float* r, int n) {
  for (int i = 0; i < chain.n; ++i) {
    if (chain[i].fx)
      chain[i].fx->Run(l, r, n);
    else
      host_fx_process(chain[i].foreign, l, r, n);
  }
}

void FreeChannel(Channel* c) {
  for (int i = 0; i < c->slots.n; ++i) delete c->slots[i].voice;
  c->slots.Release();
  c->rec.Release();
  c->has.Release();
  FreeChain(c->fx);
  c->fx.Release();
  c->sends.Release();
  free(c->sl);
  free(c->sr);
  Unref(c->bank);
  delete c;
}

void FreeBus(Bus* b) {
  FreeChain(b->fx);
  b->fx.Release();
  free(b->sl);
  free(b->sr);
  delete b;
}

bool RecGet(const Channel* c, int name, double* out) {
  if (name < 0 || name >= c->rec.n || !c->has[name]) return false;
  *out = c->rec[name];
  return true;
}

bool RecSet(Channel* c, int name, double v) {
  if (name < 0) return true;
  if (name >= c->rec.n) {
    if (!c->rec.Reserve(name + 1) || !c->has.Reserve(name + 1)) return false;
    while (c->rec.n <= name) {
      c->rec.data[c->rec.n++] = 0;
      c->has.data[c->has.n++] = 0;
    }
  }
  c->rec[name] = v;
  c->has[name] = 1;
  return true;
}

/* ---------------- the voice pool (core/voicepool.ts) ---------------- */

void PoolNoteOn(Channel* c, double note, double freq, double vel, double frame) {
  if (c->foreign >= 0) {
    host_ch_on(c->foreign, note, freq, vel, frame);
    return;
  }
  Slot* pick = nullptr;
  for (int i = 0; i < c->slots.n; ++i) {
    if (!c->slots[i].voice->Active()) {
      pick = &c->slots[i];
      break;
    }
  }
  if (!pick) {
    for (int i = 0; i < c->slots.n; ++i) {
      Slot& s = c->slots[i];
      if (!s.held && (!pick || s.start < pick->start)) pick = &s;
    }
  }
  if (!pick) {
    for (int i = 0; i < c->slots.n; ++i) {
      Slot& s = c->slots[i];
      if (!pick || s.start < pick->start) pick = &s;
    }
  }
  if (!pick) return;
  pick->note = note;
  pick->start = frame;
  pick->held = true;
  pick->voice->On(static_cast<float>(freq), static_cast<float>(vel));
}

void PoolNoteOff(Channel* c, double note) {
  if (c->foreign >= 0) {
    host_ch_off(c->foreign, note);
    return;
  }
  for (int i = 0; i < c->slots.n; ++i) {
    Slot& s = c->slots[i];
    if (s.held && s.note == note) {
      s.held = false;
      s.voice->Off();
    }
  }
}

void PoolAllOff(Channel* c) {
  if (c->foreign >= 0) {
    host_ch_alloff(c->foreign);
    return;
  }
  for (int i = 0; i < c->slots.n; ++i) {
    Slot& s = c->slots[i];
    if (s.held) {
      s.held = false;
      s.voice->Off();
    }
  }
}

void PoolSetParam(Channel* c, int name, double value) {
  if (!Finite(value)) return;
  RecSet(c, name, value);
  if (c->foreign >= 0) {
    host_ch_param(c->foreign, name, value);
    return;
  }
  const int i = UnitParam(c->unit, name);
  if (i < 0) return;
  const float v = static_cast<float>(value);
  for (int k = 0; k < c->slots.n; ++k) c->slots[k].voice->Set(i, v);
}

void PoolProcess(Channel* c, int from, int to) {
  if (c->foreign >= 0) {
    host_ch_process(c->foreign, c->sl, c->sr, from, to);
    return;
  }
  for (int i = 0; i < c->slots.n; ++i) {
    Voice* v = c->slots[i].voice;
    if (v->Active()) v->Run(c->sl + from, c->sr + from, to - from);
  }
}

}  // namespace

/* ---------------- the kernel (kernel/engine.ts) ---------------- */

struct Kernel {
  double rate = 0;
  int n = 0;
  Vec<Channel*> channels;
  Vec<Bus*> buses;
  Vec<FxSlot> master;
  Ramp master_gain;
  Vec<Event> events;
  int head = 0;
  double frame = 0;
  float* mix_l = nullptr;
  float* mix_r = nullptr;
  float* out_l = nullptr;
  float* out_r = nullptr;
  bool processed = false;
  RampSlot ramps[kRampSlots];
  int active_ramps = 0;
  double meter[4] = {0, 0, 0, 0};

  int ChannelAt(int id) const {
    for (int i = 0; i < channels.n; ++i)
      if (channels[i]->id == id) return i;
    return -1;
  }
  Channel* FindChannel(int id) const {
    const int i = ChannelAt(id);
    return i < 0 ? nullptr : channels[i];
  }
  Bus* FindBus(int id) const {
    for (int i = 0; i < buses.n; ++i)
      if (buses[i]->id == id) return buses[i];
    return nullptr;
  }
  Vec<FxSlot>* Chain(int kind, int id) {
    if (kind == 0) {
      Channel* c = FindChannel(id);
      return c ? &c->fx : nullptr;
    }
    if (kind == 1) {
      Bus* b = FindBus(id);
      return b ? &b->fx : nullptr;
    }
    return &master;
  }

  /* Before the first rendered block, level changes snap: initial setup is not automation. */
  void SetLevel(Ramp& r, double v) {
    if (!processed)
      r.Snap(v);
    else
      r.Set(v);
  }

  void PushEvent(const Event& e) {
    int lo = head;
    int hi = events.n;
    while (lo < hi) {
      const int mid = (lo + hi) >> 1;
      if (events[mid].time <= e.time)
        lo = mid + 1;
      else
        hi = mid;
    }
    events.Insert(lo, e);
  }

  /* Free ramp slots: all of them (target < 0 is "any"), one channel's, or one channel param's. */
  void ClearRamps(bool any_target, int target, bool any_param, int param) {
    if (active_ramps == 0) return;
    for (int i = 0; i < kRampSlots; ++i) {
      RampSlot& s = ramps[i];
      if (!s.active) continue;
      if (!any_target && s.target != target) continue;
      if (!any_param && s.param != param) continue;
      s.active = false;
      --active_ramps;
    }
  }

  bool StartRamp(int target, int param, double from, double to, double seconds) {
    const double start = frame;
    const double len = JsRound(seconds * rate);
    const double end = start + (len > 1.0 ? len : 1.0);
    /* Number.isSafeInteger(end) */
    if (!Finite(end) || __builtin_floor(end) != end || __builtin_fabs(end) > kMaxSafe) return false;
    for (int i = 0; i < kRampSlots; ++i) {
      RampSlot& s = ramps[i];
      if (s.active && s.target == target && s.param == param) {
        s.from = from;
        s.to = to;
        s.start = start;
        s.end = end;
        return true;
      }
    }
    for (int i = 0; i < kRampSlots; ++i) {
      RampSlot& s = ramps[i];
      if (s.active) continue;
      s.active = true;
      s.target = target;
      s.param = param;
      s.from = from;
      s.to = to;
      s.start = start;
      s.end = end;
      ++active_ramps;
      return true;
    }
    return false;
  }

  void AdvanceRamps(double at) {
    for (int i = 0; i < kRampSlots; ++i) {
      RampSlot& s = ramps[i];
      if (!s.active) continue;
      Channel* c = FindChannel(s.target);
      if (!c) {
        s.active = false;
        --active_ramps;
        continue;
      }
      if (at >= s.end) {
        PoolSetParam(c, s.param, s.to);
        s.active = false;
        --active_ramps;
        continue;
      }
      if (at <= s.start) continue;
      const double t = (at - s.start) / (s.end - s.start);
      PoolSetParam(c, s.param, s.from + (s.to - s.from) * t);
    }
  }

  void ApplyEvent(const Event& e) {
    Channel* c = FindChannel(e.target);
    if (!c) return;
    switch (e.kind) {
      case kNoteOn:
        PoolNoteOn(c, e.a, e.b, e.c, frame);
        break;
      case kNoteOff:
        PoolNoteOff(c, e.a);
        break;
      case kParam:
        if (active_ramps > 0) ClearRamps(false, e.target, false, static_cast<int>(e.a));
        PoolSetParam(c, static_cast<int>(e.a), e.b);
        break;
      case kParamRamp: {
        const int name = static_cast<int>(e.a);
        double current = 0;
        if (e.c > 0 && Finite(e.c) && RecGet(c, name, &current) && StartRamp(e.target, name, current, e.b, e.c)) break;
        ClearRamps(false, e.target, false, name);
        PoolSetParam(c, name, e.b);
        break;
      }
      case kAllNotesOff:
        PoolAllOff(c);
        break;
      default:
        break;
    }
  }

  void Process() {
    processed = true;
    const int N = n;
    const double block_start = frame;
    const double block_end_time = (block_start + N) / rate;

    if (active_ramps > 0) AdvanceRamps(block_start);

    for (int i = 0; i < channels.n; ++i) {
      Channel* c = channels[i];
      for (int k = 0; k < N; ++k) c->sl[k] = c->sr[k] = 0.0f;
    }

    int from = 0;
    while (head < events.n) {
      const Event e = events[head];
      if (e.time >= block_end_time) break;
      double fd = JsRound(e.time * rate) - block_start;
      if (fd < from) fd = from;
      const int f = static_cast<int>(fd);
      if (f > from) {
        for (int i = 0; i < channels.n; ++i) PoolProcess(channels[i], from, f);
        from = f;
      }
      frame = block_start + from;
      ApplyEvent(e);
      ++head;
    }
    if (from < N) {
      for (int i = 0; i < channels.n; ++i) PoolProcess(channels[i], from, N);
    }
    frame = block_start;

    if (head > kCompactAfter) {
      const int left = events.n - head;
      __builtin_memmove(events.data, events.data + head, sizeof(Event) * left);
      events.n = left;
      head = 0;
    }

    for (int k = 0; k < N; ++k) mix_l[k] = mix_r[k] = 0.0f;
    for (int i = 0; i < buses.n; ++i) {
      Bus* b = buses[i];
      for (int k = 0; k < N; ++k) b->sl[k] = b->sr[k] = 0.0f;
    }
    for (int i = 0; i < channels.n; ++i) {
      Channel* c = channels[i];
      RunChain(c->fx, c->sl, c->sr, N);
      for (int k = 0; k < N; ++k) {
        const double g = c->gain.Next();
        const double p = c->pan.Next();
        const double a = 0.25 * kPi * (p + 1);
        const double gl = cos(a) * kSqrt2 * g;
        const double gr = sin(a) * kSqrt2 * g;
        const double l = static_cast<double>(c->sl[k]) * gl;
        const double r = static_cast<double>(c->sr[k]) * gr;
        c->sl[k] = static_cast<float>(l);
        c->sr[k] = static_cast<float>(r);
        mix_l[k] = static_cast<float>(static_cast<double>(mix_l[k]) + l);
        mix_r[k] = static_cast<float>(static_cast<double>(mix_r[k]) + r);
      }
      for (int s = 0; s < c->sends.n; ++s) {
        Send& send = c->sends[s];
        Bus* b = FindBus(send.bus);
        if (!b) continue;
        for (int k = 0; k < N; ++k) {
          const double lv = send.level.Next();
          b->sl[k] = static_cast<float>(static_cast<double>(b->sl[k]) + static_cast<double>(c->sl[k]) * lv);
          b->sr[k] = static_cast<float>(static_cast<double>(b->sr[k]) + static_cast<double>(c->sr[k]) * lv);
        }
      }
    }

    for (int i = 0; i < buses.n; ++i) {
      Bus* b = buses[i];
      RunChain(b->fx, b->sl, b->sr, N);
      for (int k = 0; k < N; ++k) {
        const double rl = b->ret.Next();
        mix_l[k] = static_cast<float>(static_cast<double>(mix_l[k]) + static_cast<double>(b->sl[k]) * rl);
        mix_r[k] = static_cast<float>(static_cast<double>(mix_r[k]) + static_cast<double>(b->sr[k]) * rl);
      }
    }

    RunChain(master, mix_l, mix_r, N);

    double pl = 0, pr = 0, sl = 0, sr = 0;
    for (int k = 0; k < N; ++k) {
      const double g = master_gain.Next();
      const double l = static_cast<double>(mix_l[k]) * g;
      const double r = static_cast<double>(mix_r[k]) * g;
      out_l[k] = static_cast<float>(l);
      out_r[k] = static_cast<float>(r);
      const double al = __builtin_fabs(l);
      const double ar = __builtin_fabs(r);
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      sl += l * l;
      sr += r * r;
    }
    meter[0] = pl;
    meter[1] = pr;
    meter[2] = __builtin_sqrt(sl / N);
    meter[3] = __builtin_sqrt(sr / N);
    frame = block_start + N;
  }
};

namespace {

float* Buffer(int n) { return static_cast<float*>(calloc(n, sizeof(float))); }

/* seed + "::v" + i, the label VoicePool's rng.fork('v' + i) gives */
void VoiceLabel(char* out, int cap, const char* seed, int i) {
  int n = 0;
  for (; *seed && n < cap - 16; ++seed) out[n++] = *seed;
  out[n++] = ':';
  out[n++] = ':';
  out[n++] = 'v';
  char digits[12];
  int d = 0;
  do {
    digits[d++] = static_cast<char>('0' + i % 10);
    i /= 10;
  } while (i > 0);
  while (d > 0) out[n++] = digits[--d];
  out[n] = 0;
}

}  // namespace
}  // namespace bwasm

/* ---------------- exports ---------------- */

using bwasm::Kernel;

BW_EXPORT(bw_k_free) void bw_k_free(Kernel* k);

BW_EXPORT(bw_k_new) Kernel* bw_k_new(double rate, int n) {
  Kernel* k = new Kernel;
  k->rate = rate;
  k->n = n;
  k->master_gain.Init(rate, 0.9);
  k->mix_l = bwasm::Buffer(n);
  k->mix_r = bwasm::Buffer(n);
  k->out_l = bwasm::Buffer(n);
  k->out_r = bwasm::Buffer(n);
  for (int i = 0; i < bwasm::kRampSlots; ++i) k->ramps[i] = {false, 0, 0, 0, 0, 0, 0};
  if (!k->mix_l || !k->mix_r || !k->out_l || !k->out_r) {
    bw_k_free(k);
    return nullptr;
  }
  return k;
}

BW_EXPORT(bw_k_free) void bw_k_free(Kernel* k) {
  for (int i = 0; i < k->channels.n; ++i) bwasm::FreeChannel(k->channels[i]);
  k->channels.Release();
  for (int i = 0; i < k->buses.n; ++i) bwasm::FreeBus(k->buses[i]);
  k->buses.Release();
  bwasm::FreeChain(k->master);
  k->master.Release();
  k->events.Release();
  free(k->mix_l);
  free(k->mix_r);
  free(k->out_l);
  free(k->out_r);
  delete k;
}

BW_EXPORT(bw_k_out) float* bw_k_out(Kernel* k, int right) { return right ? k->out_r : k->out_l; }
BW_EXPORT(bw_k_meter) double* bw_k_meter(Kernel* k) { return k->meter; }
BW_EXPORT(bw_k_set_frame) void bw_k_set_frame(Kernel* k, double f) { k->frame = f; }
BW_EXPORT(bw_k_frame) double bw_k_frame(Kernel* k) { return k->frame; }
BW_EXPORT(bw_k_process) void bw_k_process(Kernel* k) { k->Process(); }

BW_EXPORT(bw_k_voices) int bw_k_voices(Kernel* k) {
  int n = 0;
  for (int i = 0; i < k->channels.n; ++i) {
    const bwasm::Channel* c = k->channels[i];
    for (int s = 0; s < c->slots.n; ++s)
      if (c->slots[s].voice->Active()) ++n;
  }
  return n;
}

/* Name id `name` is param `index` of `unit`. */
BW_EXPORT(bw_k_name_unit) int bw_k_name_unit(int name, int unit, int index) {
  auto& t = bwasm::g_names;
  const int need = (name + 1) * bwasm::kUnitCount;
  if (need > t.n) {
    if (!t.Reserve(need)) return 0;
    while (t.n < need) t.data[t.n++] = -1;
  }
  t[name * bwasm::kUnitCount + unit] = static_cast<int16_t>(index);
  return 1;
}

/*
 * createChannel. unit >= 0: a module engine, `poly` voices labelled seed::v0, seed::v1 ... from
 * `vals` (every param in spec order) and `variant`. foreign >= 0: a JavaScript pool by handle.
 * rec_ids/rec_vals: the params record, by name id. An existing id is replaced in place.
 * Returns 0 when a voice cannot be made.
 */
BW_EXPORT(bw_k_channel)
int bw_k_channel(Kernel* k, int id, int unit, int foreign, const char* seed, const float* vals, int variant, int poly,
                 const int* rec_ids, const double* rec_vals, int rec_n, bwasm::BankRef* bank) {
  using namespace bwasm;
  Channel* c = new Channel;
  c->id = id;
  c->unit = unit;
  c->foreign = foreign;
  if (bank) {
    c->bank = bank;
    ++bank->refs;
  }
  c->gain.Init(k->rate, 0.8);
  c->pan.Init(k->rate, 0);
  c->sl = Buffer(k->n);
  c->sr = Buffer(k->n);
  bool ok = c->sl && c->sr;
  for (int i = 0; ok && i < rec_n; ++i) ok = RecSet(c, rec_ids[i], rec_vals[i]);
  if (ok && foreign < 0) {
    char label[600];
    ok = c->slots.Reserve(poly > 0 ? poly : 1);
    for (int i = 0; ok && i < poly; ++i) {
      VoiceLabel(label, sizeof(label), seed, i);
      Voice* v = bank ? NewBankVoice(unit, static_cast<float>(k->rate), label, vals, bank->bank)
                      : NewVoice(unit, static_cast<float>(k->rate), label, vals, variant);
      if (!v) {
        ok = false;
        break;
      }
      c->slots.Push({v, -1, 0, false});
    }
  }
  if (!ok) {
    FreeChannel(c);
    return 0;
  }
  const int at = k->ChannelAt(id);
  if (at >= 0) {
    FreeChannel(k->channels[at]);
    k->channels[at] = c;
  } else if (!k->channels.Push(c)) {
    FreeChannel(c);
    return 0;
  }
  return 1;
}

/* registerBank / registerGrain: the kernel takes the bank (from bw_bank_sampler_new or
 * bw_bank_grain_new) and hands back the reference channels are made on. */
BW_EXPORT(bw_k_bank_add) bwasm::BankRef* bw_k_bank_add(Kernel*, bwasm::Bank* bank) { return new bwasm::BankRef{bank, 0, true}; }

/* The id was registered again: the old bank lives on for the channels made on it. */
BW_EXPORT(bw_k_bank_drop) void bw_k_bank_drop(Kernel*, bwasm::BankRef* b) {
  b->registered = false;
  ++b->refs;
  bwasm::Unref(b);
}

BW_EXPORT(bw_k_channel_remove) void bw_k_channel_remove(Kernel* k, int id) {
  const int at = k->ChannelAt(id);
  if (at >= 0) {
    bwasm::FreeChannel(k->channels[at]);
    k->channels.Erase(at);
  }
  k->ClearRamps(false, id, true, 0);
}

BW_EXPORT(bw_k_channel_param) void bw_k_channel_param(Kernel* k, int id, int name, double value) {
  bwasm::Channel* c = k->FindChannel(id);
  if (!c) return;
  if (k->active_ramps > 0) k->ClearRamps(false, id, false, name);
  bwasm::PoolSetParam(c, name, value);
}

BW_EXPORT(bw_k_channel_gain) void bw_k_channel_gain(Kernel* k, int id, double g) {
  bwasm::Channel* c = k->FindChannel(id);
  if (c) k->SetLevel(c->gain, g);
}

/* pan arrives clamped, by the TypeScript clamp() */
BW_EXPORT(bw_k_channel_pan) void bw_k_channel_pan(Kernel* k, int id, double p) {
  bwasm::Channel* c = k->FindChannel(id);
  if (c) k->SetLevel(c->pan, p);
}

/* createBus: an existing id is replaced in place. Its chain follows through bw_k_chain_push. */
BW_EXPORT(bw_k_bus) int bw_k_bus(Kernel* k, int id, double return_level) {
  using namespace bwasm;
  Bus* b = new Bus;
  b->id = id;
  b->ret.Init(k->rate, return_level);
  b->sl = Buffer(k->n);
  b->sr = Buffer(k->n);
  if (!b->sl || !b->sr) {
    FreeBus(b);
    return 0;
  }
  for (int i = 0; i < k->buses.n; ++i) {
    if (k->buses[i]->id == id) {
      FreeBus(k->buses[i]);
      k->buses[i] = b;
      return 1;
    }
  }
  k->buses.Push(b);
  return 1;
}

BW_EXPORT(bw_k_send) void bw_k_send(Kernel* k, int channel, int bus, double level) {
  bwasm::Channel* c = k->FindChannel(channel);
  if (!c) return;
  for (int i = 0; i < c->sends.n; ++i) {
    if (c->sends[i].bus == bus) {
      k->SetLevel(c->sends[i].level, level);
      return;
    }
  }
  bwasm::Send s;
  s.bus = bus;
  s.level.Init(k->rate, 0);
  k->SetLevel(s.level, level);
  c->sends.Push(s);
}

BW_EXPORT(bw_k_master_gain) void bw_k_master_gain(Kernel* k, double g) { k->SetLevel(k->master_gain, g); }

/* A chain: kind 0 a channel's, 1 a bus's, 2 the master's. clear frees the module effects in it. */
BW_EXPORT(bw_k_chain_clear) int bw_k_chain_clear(Kernel* k, int kind, int id) {
  auto* chain = k->Chain(kind, id);
  if (!chain) return 0;
  bwasm::FreeChain(*chain);
  return 1;
}

/* Appends a module effect (fx) or a foreign one (fx null, foreign its handle); the chain owns fx. */
BW_EXPORT(bw_k_chain_push) int bw_k_chain_push(Kernel* k, int kind, int id, bwasm::Fx* fx, int foreign) {
  auto* chain = k->Chain(kind, id);
  if (!chain) {
    delete fx;
    return 0;
  }
  if (!chain->Push({fx, foreign})) {
    delete fx;
    return 0;
  }
  return 1;
}

/* One kernel event. For Param and ParamRamp, a is the name id. */
BW_EXPORT(bw_k_event) void bw_k_event(Kernel* k, double time, int kind, int target, double a, double b, double c) {
  bwasm::Event e;
  e.time = time;
  e.kind = kind;
  e.target = target;
  e.a = a;
  e.b = b;
  e.c = c;
  k->PushEvent(e);
}

BW_EXPORT(bw_k_panic) void bw_k_panic(Kernel* k) {
  for (int i = 0; i < k->channels.n; ++i) bwasm::PoolAllOff(k->channels[i]);
  k->events.n = 0;
  k->head = 0;
  k->ClearRamps(true, 0, true, 0);
}

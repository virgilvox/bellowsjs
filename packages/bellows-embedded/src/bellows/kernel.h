/*
 * Transcription of the render core in src/kernel/engine.ts.
 *
 * The one idea worth carrying over from the JS kernel is block splitting:
 * a block renders up to the frame of the next event, the event applies,
 * then the next span renders. Notes land on the exact sample they were
 * scheduled for, whoever scheduled them and whenever, and the inner loop
 * stays a straight run over a buffer with no per-sample dispatch.
 *
 * What did not come across is the channel map. The JS kernel holds
 * Map<number, Channel>, each channel an engine looked up by string id
 * with its own fx chain. That shape costs nothing in a browser and
 * everything here: a runtime map from id to engine names every engine, so
 * the linker keeps every engine, every constant table and every delay
 * buffer, including the ones a sketch can never reach. Measured on
 * Cortex-M7, one kick through a string-keyed registry of five engines is
 * 30296 bytes of flash and 30828 of RAM against 3760 and 1100 for the
 * same kick used directly. So the voice type is a template parameter,
 * fixed at compile time, and the kernel owns exactly one VoicePool of it.
 * A sketch that wants three instruments instantiates three kernels, or
 * dispatches a bellows::Bank itself; either way the linker sees only what
 * the sketch named.
 *
 * Effects are not the kernel's business either. There is no fx chain, no
 * bus, no master gain. Process() fills the buffer and the sketch runs its
 * own effects over it in place afterwards, which is the same contract the
 * JS effects have, minus the dynamic chain.
 *
 * Threading. On a single-core Arduino the audio callback interrupts
 * loop(), so anything loop() touches while the callback runs must survive
 * being interrupted mid-write. Incoming events therefore land in a
 * lock-free single-producer single-consumer ring: loop() (or a USB MIDI
 * callback, or a serial reader, but only one of them) calls Push, the
 * audio callback drains the ring at the top of Process and owns
 * everything downstream of it. The producer writes only the ring's write
 * index, the consumer only its read index, both with release/acquire
 * ordering, so no lock and no disabled interrupts are needed. Two
 * producers break it: if both loop() and an ISR need to push, give the
 * ISR its own kernel or guard the call yourself.
 *
 * Nothing here allocates, at steady state or otherwise. The event queue,
 * the ring and the ramp table are all fixed-size members sized by
 * template parameters.
 *
 * Measured on Cortex-M7, four Kick voices through Kernel<Kick, 4, 32>
 * against the same VoicePool<Kick, 4> driven by hand: 2208 bytes of flash
 * and 1272 bytes of RAM for the scheduling. Most of that RAM is the
 * events themselves, 32 bytes per unit of queue depth (16 in the sorted
 * queue, 16 in the inbound ring), so depth is the knob that matters. The
 * ramp table is 24 bytes a slot. Adding the param handler, one ramp and
 * the MIDI parse to that sketch cost a further 48 bytes of flash.
 *
 *   bellows::Kernel<bellows::Va, 8, 64> kernel;   // voice, polyphony, queue
 *   kernel.Init(48000.0f);
 *   kernel.InitVoices(48000.0f, &rng);            // forwards to Voice::Init
 *   ...
 *   kernel.PushNoteOn(kernel.FrameAtSeconds(t), 60, 261.63f, 0.8f);
 *   ...
 *   kernel.Process(bufL, bufR, 128);              // in the audio callback
 */
#pragma once
#include <stdint.h>

#include "bellows/config.h"
#include "bellows/voicepool.h"

namespace bellows {

/*
 * Wire values match EventKind in src/types.ts exactly. The board and the
 * browser have to agree on these numbers, because the endgame is
 * bellows.live streaming events down a serial link into this queue.
 */
enum class EventKind : uint8_t {
  kNoteOn = 0,
  kNoteOff = 1,
  kParam = 2,
  kParamRamp = 3,
  kAllNotesOff = 4,
};

/*
 * One timestamped event. 16 bytes, no padding, no pointers, trivially
 * copyable: memcpy it into a serial frame or a DMA buffer as is.
 *
 *   offset 0  uint32 frame    absolute frame on the kernel clock
 *   offset 4  uint8  kind     EventKind
 *   offset 5  uint8  target   slot id, or kAnyTarget
 *   offset 6  uint16 a        note id, or param index
 *   offset 8  float  b        NoteOn frequency Hz, Param destination value
 *   offset 12 float  c        NoteOn velocity 0..1, ParamRamp seconds
 *
 * The JS carries `time` in seconds. This carries frames, because a float
 * second stops resolving single samples at 48 kHz after about 87 seconds
 * of uptime (the float ulp grows past half a sample period), and a board
 * that is going to run for hours has no reason to keep the host's units.
 * Convert once at the edge with FrameAtSeconds.
 *
 * The frame counter wraps every 24.8 hours at 48 kHz. All comparisons go
 * through signed differences, so ordering stays correct across the wrap
 * as long as no event sits in the queue for more than half the range.
 */
struct KernelEvent {
  uint32_t frame;
  uint8_t kind;
  uint8_t target;
  uint16_t a;
  float b;
  float c;
};

static_assert(sizeof(KernelEvent) == 16, "KernelEvent must stay 16 bytes on the wire");
static_assert(__is_trivially_copyable(KernelEvent), "KernelEvent must be memcpy-able");

/* A kernel with this accept id takes every event whatever its target. */
inline constexpr uint8_t kAnyTarget = 255;

namespace detail {
/* Local rounding for the ring size. Deliberately not the one in
 * delayline.h: pulling that header in for four lines would drag the whole
 * delay line into every sketch that only wanted an event queue. */
constexpr int NextPow2Int(int v) {
  int n = 1;
  while (n < v) n <<= 1;
  return n;
}
}  // namespace detail

/*
 * Lock-free SPSC ring for events crossing from the producer thread (or
 * main loop) into the audio callback. Capacity is a power of two so the
 * indices are free-running and the wrap is a mask; that also means the
 * full test is a subtraction, valid across index overflow.
 */
template <int kCapacity>
class EventRing {
 public:
  static_assert(kCapacity > 0 && (kCapacity & (kCapacity - 1)) == 0,
                "EventRing capacity must be a power of two");

  /* Producer side. False means the ring is full and the event is dropped. */
  bool Push(const KernelEvent& e) {
    const uint32_t w = w_;
    const uint32_t r = __atomic_load_n(&r_, __ATOMIC_ACQUIRE);
    if (w - r >= static_cast<uint32_t>(kCapacity)) return false;
    buf_[w & kMask] = e;
    /* Release: the slot write must be visible before the index move. */
    __atomic_store_n(&w_, w + 1, __ATOMIC_RELEASE);
    return true;
  }

  /* Consumer side. */
  bool Pop(KernelEvent* out) {
    const uint32_t r = r_;
    if (r == __atomic_load_n(&w_, __ATOMIC_ACQUIRE)) return false;
    *out = buf_[r & kMask];
    __atomic_store_n(&r_, r + 1, __ATOMIC_RELEASE);
    return true;
  }

  /* Consumer side. Drops everything queued; the producer may be pushing. */
  void Clear() {
    __atomic_store_n(&r_, __atomic_load_n(&w_, __ATOMIC_ACQUIRE), __ATOMIC_RELEASE);
  }

 private:
  static constexpr uint32_t kMask = static_cast<uint32_t>(kCapacity) - 1;
  KernelEvent buf_[kCapacity];
  uint32_t w_ = 0;
  uint32_t r_ = 0;
};

/*
 * Render core: one voice pool, one sample-accurate event queue.
 *
 * kQueue is the depth of the sorted queue the audio side drains from. The
 * inbound ring is sized to the next power of two at or above it.
 * kRamps is how many parameters may glide at once; automation is sparse
 * in practice, and past the table the kernel lands values immediately
 * rather than growing anything mid-render.
 */
template <class Voice, int kPoly, int kQueue = 64, int kRamps = 8>
class Kernel {
 public:
  using VoiceType = Voice;
  static constexpr int kPolyphony = kPoly;
  static constexpr int kQueueDepth = kQueue;

  /*
   * Called for EventKind::kParam and for every step of a kParamRamp.
   * There are no parameter names on a microcontroller (no <string>, and a
   * string compare on a control path is worse than useless), so the index
   * in KernelEvent::a means whatever the sketch says it means, usually a
   * switch that writes into the voice's Params struct. Without a handler
   * installed, param events are ignored.
   */
  using ParamFn = void (*)(void* ctx, uint8_t target, uint16_t param, float value);

  void Init(float sample_rate) {
    sr_ = sample_rate;
    frame_ = 0;
    head_ = 0;
    count_ = 0;
    held_n_ = 0;
    dropped_ = 0;
    ramp_count_ = 0;
    for (int i = 0; i < kRamps; ++i) ramps_[i].state = RampSlot::kFree;
  }

  /*
   * Construct every voice in the pool. Arguments forward straight to
   * Voice::Init, which is why the kernel does not try to do it itself:
   * Kick takes a sample rate, Va takes a sample rate and an Rng, and a
   * user voice takes whatever it likes.
   */
  template <class... Args>
  void InitVoices(Args&&... args) {
    for (int i = 0; i < kPoly; ++i) pool_.at(i).Init(static_cast<Args&&>(args)...);
  }

  /* Reach a voice directly, for per-voice setup the pool does not cover. */
  Voice& VoiceAt(int i) { return pool_.at(i); }
  VoicePool<Voice, kPoly>& Pool() { return pool_; }

  void SetParamHandler(ParamFn fn, void* ctx) {
    param_fn_ = fn;
    param_ctx_ = ctx;
  }

  /*
   * Ignore events aimed elsewhere. Two kernels sharing one event stream
   * (a drum kernel and a bass kernel, say) each accept their own id; the
   * default accepts everything, which is what a single-kernel sketch
   * wants and what target 0 from the JS side gets.
   */
  void SetTarget(uint8_t accept) { accept_ = accept; }

  /* ---------------- clock ---------------- */

  uint32_t CurrentFrame() const { return __atomic_load_n(&frame_, __ATOMIC_RELAXED); }
  float SampleRate() const { return sr_; }

  /*
   * Lock the kernel clock to a host frame counter, mirroring setFrame in
   * the JS. Only for hosts that hand one out; otherwise Process advances
   * the clock itself and this is never called.
   */
  void SetFrame(uint32_t frame) { __atomic_store_n(&frame_, frame, __ATOMIC_RELAXED); }

  /* Seconds on the kernel clock to an absolute frame. Producer side. */
  uint32_t FrameAtSeconds(float seconds) const {
    return static_cast<uint32_t>(seconds * sr_ + 0.5f);
  }

  /* Frames from now, for a producer that schedules relative to the present. */
  uint32_t FramesFromNow(float seconds) const {
    return CurrentFrame() + static_cast<uint32_t>(seconds * sr_ + 0.5f);
  }

  /* ---------------- producer side ---------------- */

  /* False means the inbound ring was full and the event was dropped. */
  bool Push(const KernelEvent& e) { return ring_.Push(e); }

  bool PushNoteOn(uint32_t frame, uint16_t note_id, float hz, float vel, uint8_t target = 0) {
    const KernelEvent e = {frame, static_cast<uint8_t>(EventKind::kNoteOn), target, note_id, hz, vel};
    return ring_.Push(e);
  }

  bool PushNoteOff(uint32_t frame, uint16_t note_id, uint8_t target = 0) {
    const KernelEvent e = {frame, static_cast<uint8_t>(EventKind::kNoteOff), target, note_id, 0.0f, 0.0f};
    return ring_.Push(e);
  }

  bool PushParam(uint32_t frame, uint16_t param, float value, uint8_t target = 0) {
    const KernelEvent e = {frame, static_cast<uint8_t>(EventKind::kParam), target, param, value, 0.0f};
    return ring_.Push(e);
  }

  bool PushParamRamp(uint32_t frame, uint16_t param, float value, float seconds, uint8_t target = 0) {
    const KernelEvent e = {frame, static_cast<uint8_t>(EventKind::kParamRamp), target, param, value, seconds};
    return ring_.Push(e);
  }

  bool PushAllNotesOff(uint32_t frame, uint8_t target = 0) {
    const KernelEvent e = {frame, static_cast<uint8_t>(EventKind::kAllNotesOff), target, 0, 0.0f, 0.0f};
    return ring_.Push(e);
  }

  /* ---------------- render ---------------- */

  /*
   * Render n frames into l and r, overwriting them. Voices add into the
   * buffer, so the kernel zeroes it first; effects run afterwards, in
   * place, and are the caller's to run.
   */
  void Process(float* l, float* r, int n) {
    Drain();

    const uint32_t base = frame_;
    if (ramp_count_ > 0) AdvanceRamps(base);

    for (int i = 0; i < n; ++i) {
      l[i] = 0.0f;
      r[i] = 0.0f;
    }

    int from = 0;
    while (head_ < count_) {
      const KernelEvent& e = q_[head_];
      const int32_t delta = static_cast<int32_t>(e.frame - base);
      if (delta >= n) break;
      int f = delta < from ? from : static_cast<int>(delta);
      if (f > from) {
        pool_.Process(l, r, from, f);
        from = f;
      }
      /* Voice steal order reads the frame, so it has to be the frame the
       * event actually lands on, not the top of the block. */
      frame_ = base + static_cast<uint32_t>(from);
      Apply(e);
      ++head_;
    }
    if (from < n) pool_.Process(l, r, from, n);

    if (head_ == count_) {
      head_ = 0;
      count_ = 0;
    } else if (head_ > kQueue / 2) {
      Compact();
    }

    __atomic_store_n(&frame_, base + static_cast<uint32_t>(n), __ATOMIC_RELAXED);
  }

  int ActiveVoices() const { return pool_.ActiveCount(); }

  /* Events dropped because the sorted queue was full. Diagnostics only. */
  uint32_t Dropped() const { return dropped_; }

  /*
   * Stop everything and forget what was scheduled. Ramps freeze where
   * they are rather than running on toward a destination nobody is
   * listening for, same as the JS panic message.
   */
  void Panic() {
    AllNotesOff();
    ring_.Clear();
    head_ = 0;
    count_ = 0;
    held_n_ = 0;
    ramp_count_ = 0;
    for (int i = 0; i < kRamps; ++i) ramps_[i].state = RampSlot::kFree;
  }

 private:
  /* ---------------- queue ---------------- */

  void Drain() {
    KernelEvent e;
    while (ring_.Pop(&e)) Insert(e);
  }

  /*
   * Binary insert by frame, keeping equal frames in arrival order, which
   * is what the JS splice does. The queue is near-sorted in practice, so
   * the shift is short.
   */
  void Insert(const KernelEvent& e) {
    if (count_ >= kQueue) {
      Compact();
      if (count_ >= kQueue) {
        ++dropped_;
        return;
      }
    }
    int lo = head_;
    int hi = count_;
    while (lo < hi) {
      const int mid = (lo + hi) >> 1;
      if (static_cast<int32_t>(q_[mid].frame - e.frame) <= 0) lo = mid + 1;
      else hi = mid;
    }
    for (int i = count_; i > lo; --i) q_[i] = q_[i - 1];
    q_[lo] = e;
    ++count_;
  }

  void Compact() {
    if (head_ == 0) return;
    const int n = count_ - head_;
    for (int i = 0; i < n; ++i) q_[i] = q_[head_ + i];
    head_ = 0;
    count_ = n;
  }

  void Apply(const KernelEvent& e) {
    if (accept_ != kAnyTarget && e.target != accept_ && e.target != kAnyTarget) return;
    switch (static_cast<EventKind>(e.kind)) {
      case EventKind::kNoteOn:
        HoldAdd(e.a);
        pool_.NoteOn(e.a, e.b, e.c, frame_);
        break;
      case EventKind::kNoteOff:
        HoldRemove(e.a);
        pool_.NoteOff(e.a);
        break;
      case EventKind::kParam:
        WriteParam(e.target, e.a, e.b, true);
        break;
      case EventKind::kParamRamp:
        StartRamp(e.target, e.a, e.b, e.c);
        break;
      case EventKind::kAllNotesOff:
        AllNotesOff();
        break;
      default:
        break;
    }
  }

  /* ---------------- held notes ---------------- */

  /*
   * The pool maps slots to note ids privately and only clears a slot's
   * held flag through NoteOff(id), so an all-notes-off has to name the
   * ids. The kernel keeps the list it turned on. Entries can go stale
   * when the pool steals a voice; releasing a stale id is a no-op.
   */
  void HoldAdd(uint16_t id) {
    for (int i = 0; i < held_n_; ++i) {
      if (held_[i] == id) return;
    }
    if (held_n_ >= kPoly) {
      for (int i = 1; i < kPoly; ++i) held_[i - 1] = held_[i];
      held_n_ = kPoly - 1;
    }
    held_[held_n_++] = id;
  }

  void HoldRemove(uint16_t id) {
    for (int i = 0; i < held_n_; ++i) {
      if (held_[i] != id) continue;
      for (int j = i + 1; j < held_n_; ++j) held_[j - 1] = held_[j];
      --held_n_;
      return;
    }
  }

  void AllNotesOff() {
    for (int i = 0; i < held_n_; ++i) pool_.NoteOff(held_[i]);
    held_n_ = 0;
  }

  /* ---------------- param ramps ---------------- */

  /*
   * A slot doing double duty. Free, resting (holding the last value the
   * kernel wrote for this parameter), or ramping. Resting matters
   * because a ramp needs somewhere to start from and there is no way to
   * read a value back out of a voice: the handler is one way. So the
   * kernel remembers what it last sent, and a ramp glides from there.
   * A parameter the kernel has never written jumps straight to its
   * destination, which beats dropping the automation on the floor.
   */
  struct RampSlot {
    enum : uint8_t { kFree = 0, kRest = 1, kRamp = 2 };
    uint16_t param;
    uint8_t target;
    uint8_t state;
    float value;
    float from;
    float to;
    uint32_t start;
    uint32_t end;
  };

  void WriteParam(uint8_t target, uint16_t param, float value, bool remember) {
    if (param_fn_ != nullptr) param_fn_(param_ctx_, target, param, value);
    if (!remember) return;
    RampSlot* s = FindSlot(target, param);
    if (s == nullptr) s = ClaimSlot(target, param);
    if (s == nullptr) return;
    if (s->state == RampSlot::kRamp) --ramp_count_;
    s->state = RampSlot::kRest;
    s->value = value;
  }

  void StartRamp(uint8_t target, uint16_t param, float to, float seconds) {
    RampSlot* s = FindSlot(target, param);
    /* Duration of zero or less is the documented way to say "now", and a
     * parameter with no remembered value has nothing to glide from. */
    if (seconds <= 0.0f || s == nullptr || s->state == RampSlot::kFree) {
      WriteParam(target, param, to, true);
      return;
    }
    uint32_t span = static_cast<uint32_t>(seconds * sr_ + 0.5f);
    if (span < 1) span = 1;
    if (s->state != RampSlot::kRamp) ++ramp_count_;
    /* Retarget rather than stack: two ramps on one parameter would fight,
     * two writes a block with neither winning. */
    s->state = RampSlot::kRamp;
    s->from = s->value;
    s->to = to;
    s->start = frame_;
    s->end = frame_ + span;
  }

  RampSlot* FindSlot(uint8_t target, uint16_t param) {
    for (int i = 0; i < kRamps; ++i) {
      RampSlot& s = ramps_[i];
      if (s.state != RampSlot::kFree && s.param == param && s.target == target) return &s;
    }
    return nullptr;
  }

  /* Free slot first, then the oldest resting one. Never steals a ramp in
   * flight: that would strand a parameter mid-glide. */
  RampSlot* ClaimSlot(uint8_t target, uint16_t param) {
    RampSlot* pick = nullptr;
    for (int i = 0; i < kRamps; ++i) {
      if (ramps_[i].state == RampSlot::kFree) {
        pick = &ramps_[i];
        break;
      }
    }
    if (pick == nullptr) {
      for (int i = 0; i < kRamps; ++i) {
        if (ramps_[i].state == RampSlot::kRest) {
          pick = &ramps_[i];
          break;
        }
      }
    }
    if (pick == nullptr) return nullptr;
    pick->target = target;
    pick->param = param;
    pick->state = RampSlot::kRest;
    pick->value = 0.0f;
    return pick;
  }

  /*
   * One step per block, not per sample. A param write on most engines
   * recomputes filter coefficients and phase increments, so per-sample
   * ramping would cost far more than the audio it buys. A block is 2.7 ms
   * at 48 kHz with 128 frames, below what the ear resolves as a step in
   * parameter movement.
   */
  void AdvanceRamps(uint32_t frame) {
    for (int i = 0; i < kRamps; ++i) {
      RampSlot& s = ramps_[i];
      if (s.state != RampSlot::kRamp) continue;
      if (static_cast<int32_t>(frame - s.end) >= 0) {
        /* Land exactly on the destination, never on the last step. */
        s.state = RampSlot::kRest;
        s.value = s.to;
        --ramp_count_;
        if (param_fn_ != nullptr) param_fn_(param_ctx_, s.target, s.param, s.to);
        continue;
      }
      if (static_cast<int32_t>(frame - s.start) <= 0) continue;
      const float t = static_cast<float>(frame - s.start) / static_cast<float>(s.end - s.start);
      s.value = s.from + (s.to - s.from) * t;
      if (param_fn_ != nullptr) param_fn_(param_ctx_, s.target, s.param, s.value);
    }
  }

  static constexpr int kRingCapacity = static_cast<int>(detail::NextPow2Int(kQueue));

  VoicePool<Voice, kPoly> pool_;
  EventRing<kRingCapacity> ring_;
  KernelEvent q_[kQueue];
  RampSlot ramps_[kRamps];
  uint16_t held_[kPoly];
  ParamFn param_fn_ = nullptr;
  void* param_ctx_ = nullptr;
  float sr_ = static_cast<float>(BELLOWS_SAMPLE_RATE);
  uint32_t frame_ = 0;
  uint32_t dropped_ = 0;
  int head_ = 0;
  int count_ = 0;
  int held_n_ = 0;
  int ramp_count_ = 0;
  uint8_t accept_ = kAnyTarget;
};

}  // namespace bellows

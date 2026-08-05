# 00_BringUp: the flash-and-listen checklist

Nothing in this repository has ever been flashed to a board and heard. This
sketch turns that first session into about twenty minutes of checklist. Work
top to bottom with the serial monitor open. Every stage states what it should
sound like before it plays, so silence is never ambiguous.

Two things come out of a successful run, and both belong in `docs/HANDOFF.md`
afterwards: a CPU number per stage, and the ratio between eight voices in the
bass and the same eight voices six octaves up. That ratio is the one
measurement no existing test covers and the reason to run this before
anything else.

## 1. What to buy

- [ ] Teensy 4.1, from PJRC or a distributor (Digi-Key, Mouser, SparkFun,
      Pimoroni). The version without pins soldered is fine and cheaper.
- [ ] Teensy Audio Adaptor Board, **Rev D**, the version for Teensy 4.x. The
      older Rev B is for Teensy 3.x and will not work here.
- [ ] Two 14-pin headers (male, 0.1 inch) for the Teensy, and two matching
      14-pin female headers for the shield. Both boards usually ship with a
      strip of pins in the bag.
- [ ] A micro-USB cable that carries data. A charge-only cable is the most
      common first hour wasted.
- [ ] Wired headphones or earbuds with a 3.5 mm jack. Not Bluetooth.
- [ ] A guitar tuner, or any phone tuner app that shows cents.

Soldering iron, solder, flux. This is a through-hole job: 28 joints on the
Teensy and 28 on the shield, so 56 in total.

## 2. Assemble

- [ ] Solder male headers into the first 14 pin positions of each long edge
      of the Teensy 4.1. The shield is Teensy 4.0 sized, so it sits over
      those 28 positions and the rest of the 4.1 sticks out past it.
- [ ] Solder the matching female headers to the audio shield.
- [ ] Inspect every joint before powering anything. A cold joint on pins
      18 or 19 (I2C to the codec) gives you a board that runs, prints, and
      makes no sound at all, which is the single most confusing failure
      available here.
- [ ] Seat the shield. Check it is not off by one position: the shield's
      GND pin must land on the Teensy's GND pin.
- [ ] Headphones into the jack **on the shield**, not into anything else.
- [ ] Turn the volume down on whatever you are listening through. Stage 9
      plays eight saw voices between 3.5 and 7 kHz.

## 3. Build and upload

The library resolves from git the first time, so the first build needs
network. After that it is offline.

```
cd packages/bellows-embedded/examples
PLATFORMIO_SRC_DIR=00_BringUp pio run -e teensy41_bringup
PLATFORMIO_SRC_DIR=00_BringUp pio run -e teensy41_bringup -t upload
pio device monitor -b 115200
```

If you would rather not set the variable every time, add this to the top of
`examples/platformio.ini`:

```
[platformio]
src_dir = 00_BringUp
```

- [ ] The build ends in `SUCCESS` and prints a `teensy_size` block.
- [ ] Upload succeeds. If PlatformIO cannot reboot the board, press the small
      white program button on the Teensy once and rerun the upload.
- [ ] `pio device monitor -b 115200` prints a header within a few seconds of
      the board being plugged in.

Nothing on serial:

- [ ] `pio device list` shows a `usbmodem` port. If not, suspect the cable.
- [ ] `build_flags` still contains `-D USB_MIDI_SERIAL`. The teensy platform
      silently ignores `board_build.usb_type`, so removing that define
      leaves the board enumerating as something without a serial endpoint.
- [ ] The sketch waits at most 4 seconds for a serial host and then runs
      regardless, so a board with no monitor attached still makes sound.

## 4. Read the header

The first thing printed is the sample rate from
`bellows::TeensySampleRate()`.

- [ ] Write it down. Every envelope coefficient, filter cutoff and delay
      length in the program is derived from it. If the codec is actually
      clocked somewhere else, stage 2 reads sharp or flat on a tuner by
      exactly that ratio, and a whole class of "it sounds wrong" results
      resolves to this one number.
- [ ] Check the expected update rate line: sample rate divided by 128, about
      344 per second. The drift figure in every stage result is measured
      against it.

## 5. The stages

Each takes 3 to 9 seconds, then prints its result. The whole sequence is
about a minute and then repeats, so you can listen to any stage again by
waiting for it to come round.

### 1. SILENCE (baseline)

- **Hear**: nothing. No hiss, no hum, no ticking.
- **PASS**: silence. Write down whatever `cpu max` reads: it is the audio
  graph's own cost with no DSP in it, and every later stage is worth reading
  as its figure minus this one. No expected value is given because no board
  has produced one yet, and inventing a threshold here would be the exact
  mistake this document is trying to avoid.
- **Hum or buzz**: USB ground loop from the host, or the headphone cable
  running across the board. Try the board on a battery or a phone charger.
- **Ticking at about 344 Hz**: blocks are not being produced. Check the
  `dropouts` line before assuming it is the DSP.

### 2. SINE A440 (pitch reference)

- **Hear**: one steady sine, equal in both ears, no wobble and no buzz.
- **PASS**: a tuner reads **A4 within a couple of cents of 0**.
- **Consistently sharp or flat**: the SAI clock is not where
  `AUDIO_SAMPLE_RATE_EXACT` says it is. Note the cents error; the frequency
  ratio is `2^(cents/1200)` and the real rate is the printed rate times that
  ratio. Nothing else in this checklist matters until this is understood,
  because every coefficient in the library is scaled by it.
- **Silent**: codec not enabled. Suspect the I2C joints (pins 18 and 19)
  first, then the shield seating, then the headphone plug not being pushed
  all the way in.
- **One ear only**: a partly inserted plug reads as mono, so try that first,
  then the I2S joints on pins 7, 20, 21 and 23.
- **Buzzing rather than pure**: the signal is clipping in the int16
  conversion. That clip is deliberate (a wrap would turn overdrive into
  full-scale noise) but it means something upstream is too loud.

### 3. SAW A440 (BLEP residual tables)

- **Hear**: the same pitch, now bright and buzzy, but even and clean.
- **PASS**: the same A4 reading on the tuner, with no grit or crackle riding
  on top.
- **Same pitch but gritty**: the 16 KB of Kaiser-sinc BLEP residual table in
  flash is being read wrong. Check that `-D BELLOWS_FAST_MATH=1` is **not**
  set; the default is off and this sketch has never been characterised with
  it on.
- **A different pitch from stage 2**: a table indexing bug, which would be a
  real finding. Record both readings.

### 4. KICK

- **Hear**: one kick every 500 ms, tuned to 50 Hz.
- **PASS**: a clean thump with a click on the front, and silence between hits.
- **A click with no body**: the envelope coefficients are wrong, which
  usually means `Init` got a sample rate of zero or something far from the
  printed one.
- **Rattle or fizz between hits**: the amplitude envelope is not reaching its
  idle threshold. Worth reporting.

### 5. DRUM KIT (euclidean patterns)

- **Hear**: kick, snare and hat over 16 sixteenths at 120 bpm.
- **PASS**: steady time, every hit distinct, nothing dropped or doubled.
- **Uneven time**: the sequencer runs inside the render and splits each block
  at the step boundary, so timing jitter here is a CPU overrun rather than
  scheduling. Check the `drift` line for the same stage.
- **Missing hits**: compare against `02_DrumMachine`, which uses the same
  three patterns (5 in 16, 4 in 16 rotated 4, 11 in 16 rotated 1).

### 6. POLY CHORD (8 VA voices)

- **Hear**: an A minor 9, three seconds on and three off.
- **PASS**: eight separate pitches, a smooth release, real silence between.
- **Mush or distortion**: clipping. Eight voices summing is where that first
  shows up.
- **Fewer than eight pitches**: voice stealing, which should not happen with
  eight notes in an eight voice pool. Check the `voices sounding` line, which
  should read 8 during the on half.

### 7. PITCH SWEEP

- **Hear**: a saw gliding 55 Hz to 7040 Hz over six seconds, then repeating.
- **PASS**: smooth the whole way up, no stepping.
- **A second tone descending against the rising one**: aliasing, which means
  the band-limiting is not working. This is the single most important thing
  to catch by ear, because the spectrum tests that guard it live in the
  TypeScript and cannot see the C++ tables.
- **Stepping**: the frequency updates once per 128 frame block, so audible
  stepping would mean blocks are far longer than 128 frames.

### 8. POLY LOW (8 voices, 55 to 110 Hz)

- **Hear**: a low sustained eight note cluster, held steady.
- **PASS**: steady sound, and a `cpu max` you write down.

### 9. POLY HIGH (8 voices, 3520 to 7040 Hz)

Turn the volume down before this one.

- **Hear**: the same eight notes six octaves up. Identical voices, identical
  polyphony, identical gain. Pitch is the only variable.
- **PASS**: steady sound and a `cpu max`. If it crackles, breaks up, or the
  `dropouts` line fails here and nowhere else, that is not a defect: it is
  the finding this sketch exists to produce, and the number to record.

## 6. The two numbers to write down

At the end of every pass the sketch prints a summary and then the block
headed `BLEP PITCH COST`.

- [ ] `cpu max` for every stage, from the summary table.
- [ ] The low and high poly figures and the ratio between them.
- [ ] The voice ceiling line: how many voices fit at 7 kHz before the block
      budget runs out.

The residual sum walks the edges inside the kernel half-width, and the
average count of those per sample is exactly `2 * KERNEL_HALF * dt`: 0.32 at
A440, 5.1 at 7040 Hz. Measured on the host as a ratio in one process, a bare
saw oscillator costs about 3.7x its A440 cost at 7040 Hz and peaks at 9.0x at
the dt clamp. The 14x quoted in `docs/AUDIT.md` is against 55 Hz, which is an
unusually cheap reference, and host ns figures are harness-dependent enough
that only the ratio is worth carrying over.

Expect a smaller ratio here again: these are whole `Va` voices, and the
ladder filter, the two envelopes and the control-rate update every 16 samples
cost the same at both pitches. The number that comes out is the one that
sizes a real voice budget, which is why the stage plays voices rather than
bare oscillators.

There is no host-derived threshold worth stating for this, because nothing
has run on a board yet: write the ratio and the ceiling down and compare them
against the block budget, not against a number from here. If the ceiling is
low enough to constrain the patch you want, the option to reach for is
`boundedHighFreq` in Milestone 2 of `docs/HANDOFF.md`, which is implemented
in the TypeScript and deliberately not ported to C++ until exactly this
measurement exists. Note that it only helps above about 9.7 kHz, so if the
pain is at 2 to 7 kHz the answer is a smaller voice count, not that option.

## 7. What the dropout line does and does not prove

The rig counts frames the render was actually asked to produce. The audio
library calls `update()` once per 128 frame block, so over the measured
window the count should equal `elapsed_ms * sample_rate / 1000`. Two real
failures move it: a graph that cannot finish a block inside its 2.9 ms budget
gets its software interrupt run less often, and an exhausted block pool makes
the adapter return before rendering anything. Both read as negative drift,
and the pool case also shows as `audio mem max` reaching the 24 blocks
`AudioMemory()` allocated.

What it cannot see:

- A single missed block. One block in a six second window is 0.05 percent,
  inside the measurement's own noise, since the counter is read from the main
  thread while the interrupt writes it and `millis()` has 1 ms granularity.
  Treat anything between -0.1 and -0.5 percent as "run it again".
- Whether the samples were right. A codec that is muted, mis-clocked or
  wired to the wrong pins gives a perfect drift of zero. That is what the
  stated sound of each stage is for.

`AudioProcessorUsage` is time spent inside the audio interrupt, so the serial
printing in `loop()` cannot inflate it. Both maxima are reset 900 ms after
each stage is requested, which is after the 10 ms fade, the 400 ms silent gap
between stages and the note-on transient, so every figure belongs to one
stage in steady state.

## 8. Build size

Measured with the toolchain in this repository, `pio run -e
teensy41_bringup`, complete firmware including the Arduino core and the Audio
Library:

| | bytes |
| --- | --- |
| FLASH code | 45320 |
| FLASH data | 32032 |
| FLASH headers | 8660 |
| FLASH total | 86012 of 8126464 |
| RAM1 variables | 34816 |
| RAM1 code | 42056 |
| RAM1 free for local variables | 423936 |
| RAM2 variables | 24320 |

Larger than the five numbered examples because it links every engine they use
between them plus the float formatting the serial report needs. It is
instrumentation, not a size reference. The examples `docs/HARDWARE.md` quotes
are deliberately untouched.

## 9. When you are done

- [ ] Take the photo of the board making a sound. That is the Milestone 1
      acceptance criterion in `docs/HANDOFF.md`.
- [ ] Paste the summary block into `docs/HANDOFF.md` under Milestone 1,
      including the sample rate line from the header.
- [ ] Then flash `01_OneKick` through `05_MidiInstrument` in order. They are
      the same DSP in ordinary use, and after this sketch you know what
      working sounds like.

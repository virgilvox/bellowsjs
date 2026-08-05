# daisy_onekick

`01_OneKick` on a Daisy Seed. This is the example that proves the claim the
rest of the library is built around: `main.cpp` here includes
`../01_OneKick/onekick.h` directly, not a copy of it, and that header has no
Daisy code in it and did not change to make this build.

The Teensy sketch drives the same header through an `AudioStream` node. This
one drives it through `bellows::DaisyAudio<Render>` behind a libDaisy audio
callback. Different codec, different sample rate, different SDK, same voice
class.

## Building

You need a libDaisy checkout built once with its own `make`, so that
`build/libdaisy.a` exists, and `arm-none-eabi-g++` on `PATH`.

```
git clone --recurse-submodules https://github.com/electro-smith/libDaisy
make -C libDaisy

make LIBDAISY_DIR=/path/to/libDaisy
make LIBDAISY_DIR=/path/to/libDaisy program-dfu
```

For `program-dfu`, put the board in DFU mode by holding BOOT, tapping RESET,
then releasing BOOT.

## Measured

libDaisy 8.1.0 (commit `c02245d`), `arm-none-eabi-g++` 9.2.1, libDaisy at
`-O3` and `main.cpp` at `-O2`, linked with `--gc-sections` against
`STM32H750IB_flash.lds`:

| region | used | size | |
| --- | --- | --- | --- |
| FLASH | 75784 B | 128 KB | 57.8 % |
| SRAM | 13956 B | 512 KB | 2.7 % |
| SDRAM | 0 B | 64 MB | 0 % |

That is complete firmware: HAL, SAI, DMA, the codec driver, the USB stack
and bellows. It fits in the H750's internal flash with 54 KB spare, so this
program needs no bootloader and no QSPI execute in place.

### What of that is bellows

Building the identical program with every bellows include removed and the
callback body emptied gives a baseline to subtract:

| | .text | .data + .bss |
| --- | --- | --- |
| this program | 74016 B | 31060 B |
| same program, no bellows | 70100 B | 30900 B |
| difference | 3916 B | 160 B |

Of those 160 bytes, 100 are newlib's `impure_data` and `_impure_ptr`, which
appear the first time anything in the program calls libm and are not bellows
state. The `onekick::Voice` object is 56 bytes. The remaining 4 is the
adapter's static render pointer.

The freestanding figure for the same voice, measured by
`tools/size-report.sh` with no SDK at all, is 3776 B of flash and 1100 B of
RAM, of which 1024 B is the test harness's own scratch buffers. That is what
the documented command prints on a stock checkout, because `size-report.sh`
finds whichever `arm-none-eabi-g++` is first under `~/.platformio/packages`
and that is the 11.3 Teensy toolchain. Building it with the 9.2.1 xPack
compiler this Daisy image uses gives 3768 B and 1088 B instead. The gap is
the compiler, not the code, which is worth knowing before treating an eight
byte drift as a regression. The freestanding and whole-firmware numbers are
measuring different things and both are in the table for that reason.

## Notes on the build

`CPP_STANDARD = -std=gnu++17` in the Makefile is not optional and has to be
set before the `include` of libDaisy's `core/Makefile`, which sets it with
`?=` and defaults to `-std=gnu++14`. Every bellows header uses inline
constexpr variables, which are C++17. GCC accepts them under `gnu++14` as an
extension and warns once per variable, so leaving the default produces a
binary that links and 16 warnings, all of them "inline variables are only
available with -std=c++17", from `daisy.h`, `config.h` and
`blep_tables.h`. This is the Daisy twin of the `build_unflags` the Teensy
PlatformIO env needs.

Nothing here has been flashed to a board or listened to. The numbers above
are from `arm-none-eabi-size` on a linked ELF.

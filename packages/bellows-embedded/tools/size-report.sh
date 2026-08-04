#!/bin/bash
#
# Flash and RAM report for the embedded library.
#
# Compiles every sketch in test/sketches freestanding for a chosen ARM
# target and prints .text (flash) and .data + .bss (RAM). No Arduino core
# and no BSP, so the numbers are the library and nothing else.
#
#   ./tools/size-report.sh                 # Cortex-M7, the Teensy 4.1 and Daisy target
#   ./tools/size-report.sh cortex-m4       # single-precision FPU
#   ./tools/size-report.sh cortex-m0plus   # no FPU
#
# Needs arm-none-eabi-g++ on PATH, or a PlatformIO toolchain in
# ~/.platformio/packages.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-cortex-m7}"

find_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  local found
  found=$(find "$HOME/.platformio/packages" -name "$name" -type f 2>/dev/null | head -1)
  [ -n "$found" ] && echo "$found"
}

CXX="$(find_tool arm-none-eabi-g++)"
SIZE="$(find_tool arm-none-eabi-size)"
if [ -z "$CXX" ] || [ -z "$SIZE" ]; then
  echo "arm-none-eabi toolchain not found. Install it, or 'pio pkg install -g -t toolchain-gccarmnoneeabi'." >&2
  exit 1
fi

case "$TARGET" in
  cortex-m7)      ARCH=(-mcpu=cortex-m7 -mfpu=fpv5-d16 -mfloat-abi=hard) ;;
  cortex-m4)      ARCH=(-mcpu=cortex-m4 -mfpu=fpv4-sp-d16 -mfloat-abi=hard) ;;
  cortex-m33)     ARCH=(-mcpu=cortex-m33 -mfpu=fpv5-sp-d16 -mfloat-abi=hard) ;;
  cortex-m0plus)  ARCH=(-mcpu=cortex-m0plus -mfloat-abi=soft) ;;
  *) echo "unknown target: $TARGET" >&2; exit 1 ;;
esac

FLAGS=(-mthumb -std=c++17 -Os
       -ffunction-sections -fdata-sections
       -fno-exceptions -fno-rtti -fno-threadsafe-statics
       -fno-unwind-tables -fno-asynchronous-unwind-tables
       -fsingle-precision-constant
       -I"$HERE/src" -I"$HERE/test/sketches"
       -nostdlib -nostartfiles
       -Wl,--gc-sections -Wl,-T,"$HERE/test/m7.ld")

OUT="$HERE/test/build"
mkdir -p "$OUT"
SUPPORT=("$HERE/test/sketches/common.cpp" "$HERE/test/sketches/zz_stubs.cpp")

echo "target: $TARGET   flags: -Os -ffunction-sections -fdata-sections -Wl,--gc-sections"
echo
printf "%-24s %10s %10s %10s\n" sketch flash data+bss ""
printf "%-24s %10s %10s\n" "------" "-----" "--------"
fail=0
for f in "$HERE"/test/sketches/[sp][0-9]*.cpp; do
  n=$(basename "$f" .cpp)
  if "$CXX" "${ARCH[@]}" "${FLAGS[@]}" "$f" "${SUPPORT[@]}" \
        -o "$OUT/$n.elf" -lm -lc -lgcc 2>"$OUT/$n.err"; then
    read -r text data bss _ <<<"$("$SIZE" "$OUT/$n.elf" | tail -1)"
    printf "%-24s %10s %10s\n" "$n" "$text" "$((data + bss))"
  else
    printf "%-24s %10s\n" "$n" "FAILED"
    head -3 "$OUT/$n.err" >&2
    fail=1
  fi
done
exit $fail

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
# EXTRA_CXXFLAGS is appended to every compile, which is how the fast-math
# figures in docs/HARDWARE.md are produced:
#
#   EXTRA_CXXFLAGS=-DBELLOWS_FAST_MATH=1 ./tools/size-report.sh
#
# It exists so those numbers come from this script like every other number
# in that document, rather than from a scratch file nobody can rerun.
#
# Needs arm-none-eabi-g++ on PATH, or a PlatformIO toolchain in
# ~/.platformio/packages. Which one it finds is part of the measurement: the
# rows this prints move between GCC 11.3.1 and 9.2.1, and a machine with
# PlatformIO on it can easily have both installed. That used to be settled by
# `find ... | head -1`, whose order is not stable: fifteen consecutive runs of
# it on one APFS box returned the two installs in a different order, nine
# times and six, so the first command in the docs/HARDWARE.md reproduction
# block quietly produced a different document on some runs. Selection order
# now: BELLOWS_CXX, then arm-none-eabi-g++ on PATH (which is how
# check-docs.mjs pins its own runs), then the install under
# ~/.platformio/packages whose -dumpversion matches the version
# docs/HARDWARE.md names, then the first install in sorted order with a
# warning. The compiler actually used is printed above the table.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-cortex-m7}"
DOC="$HERE/../../docs/HARDWARE.md"
WANT="$(sed -n 's/.*compiled with `arm-none-eabi-g++` \([0-9][0-9.]*\) at `-Os`.*/\1/p' "$DOC" 2>/dev/null | head -1)"

find_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  local found
  found=$(find "$HOME/.platformio/packages" -name "$name" -type f 2>/dev/null | LC_ALL=C sort | head -1)
  [ -n "$found" ] && echo "$found"
}

# The compiler the document names, rather than whichever one turns up first.
find_cxx() {
  local first="" c v
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    [ -n "$first" ] || first="$c"
    v="$("$c" -dumpversion 2>/dev/null)"
    [ -n "$WANT" ] && [ "$v" = "$WANT" ] && { echo "$c"; return; }
  done <<EOF
$(find "$HOME/.platformio/packages" -name arm-none-eabi-g++ -type f 2>/dev/null | LC_ALL=C sort)
EOF
  [ -n "$first" ] && echo "$first"
}

CXX="${BELLOWS_CXX:-$(command -v arm-none-eabi-g++ 2>/dev/null || true)}"
[ -n "$CXX" ] || CXX="$(find_cxx)"
# `size` comes from the same install as the compiler. Binutils from one
# toolchain against a compiler from another is not a combination anyone
# measured, and searching for the two independently could produce it.
if [ -n "$CXX" ] && [ -x "$(dirname "$CXX")/arm-none-eabi-size" ]; then
  SIZE="$(dirname "$CXX")/arm-none-eabi-size"
else
  SIZE="$(find_tool arm-none-eabi-size)"
fi
HAVE=""
[ -n "$CXX" ] && HAVE="$("$CXX" -dumpversion 2>/dev/null)"
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

# shellcheck disable=SC2206
EXTRA=(${EXTRA_CXXFLAGS:-})

OUT="$HERE/test/build"
mkdir -p "$OUT"
SUPPORT=("$HERE/test/sketches/common.cpp" "$HERE/test/sketches/zz_stubs.cpp")

echo "target: $TARGET   flags: -Os -ffunction-sections -fdata-sections -Wl,--gc-sections ${EXTRA_CXXFLAGS:-}"
echo "compiler: $CXX ($HAVE)"
if [ -z "$WANT" ]; then
  echo "warning: docs/HARDWARE.md no longer names a compiler version, so this run chose one on its own" >&2
elif [ "$HAVE" != "$WANT" ]; then
  echo "warning: docs/HARDWARE.md records arm-none-eabi-g++ $WANT, and the figures move between toolchains" >&2
fi
echo
printf "%-24s %10s %10s %10s\n" sketch flash data+bss ""
printf "%-24s %10s %10s\n" "------" "-----" "--------"
fail=0
for f in "$HERE"/test/sketches/[sp][0-9]*.cpp; do
  n=$(basename "$f" .cpp)
  if "$CXX" "${ARCH[@]}" "${FLAGS[@]}" ${EXTRA[@]+"${EXTRA[@]}"} "$f" "${SUPPORT[@]}" \
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

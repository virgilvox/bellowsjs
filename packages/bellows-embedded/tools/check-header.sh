#!/bin/bash
#
# Compile one or more headers in isolation for a real ARM target and print
# the flash and RAM they cost. Use this while writing a module: it does not
# touch the shared size report, so parallel work does not interfere.
#
#   ./tools/check-header.sh bellows/engines/fm.h
#   ./tools/check-header.sh bellows/fx/plate.h bellows/fx/saturator.h
#
# Exit code is the compiler's, so it doubles as a syntax check.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -lt 1 ] && { echo "usage: check-header.sh <header> [header...]" >&2; exit 2; }

find_tool() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; return; fi
  find "$HOME/.platformio/packages" -name "$1" -type f 2>/dev/null | head -1
}
CXX="$(find_tool arm-none-eabi-g++)"
SIZE="$(find_tool arm-none-eabi-size)"
[ -z "$CXX" ] && { echo "arm-none-eabi-g++ not found" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

{
  for h in "$@"; do echo "#include \"$h\""; done
  cat <<'EOF'
/* Touch every type so nothing is dead-stripped before it is measured. */
extern "C" volatile float g_sink;
volatile float g_sink = 0.0f;
static float bufL[128], bufR[128];
extern "C" int main() {
  float s = 0.0f;
  for (int i = 0; i < 128; ++i) s += bufL[i] + bufR[i];
  g_sink = s;
  return 0;
}
extern "C" {
static int errno_storage;
int* __errno() { return &errno_storage; }
void _exit(int) { for (;;) {} }
}
EOF
} > "$TMP/tu.cpp"

"$CXX" -mcpu=cortex-m7 -mfpu=fpv5-d16 -mfloat-abi=hard -mthumb \
  -std=c++17 -Os -Wall -Wextra -Wno-unused-parameter \
  -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti \
  -fno-threadsafe-statics -fno-unwind-tables -fno-asynchronous-unwind-tables \
  -fsingle-precision-constant \
  -I"$HERE/src" -nostdlib -nostartfiles \
  -Wl,--gc-sections -Wl,-T,"$HERE/test/m7.ld" \
  "$TMP/tu.cpp" -o "$TMP/tu.elf" -lm -lc -lgcc || exit 1

read -r text data bss _ <<<"$("$SIZE" "$TMP/tu.elf" | tail -1)"
echo "OK  $*  flash=${text}B  ram=$((data + bss))B (unused code is stripped, so this is the floor)"

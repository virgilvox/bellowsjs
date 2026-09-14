#!/bin/bash
#
# Compile checks for bellows/platform/esp32c3.h, in two halves.
#
#   ./tools/check-esp32c3.sh
#
# Half one always runs and needs only a host compiler. It proves the target
# guard: off an ESP32 the header has to expand to nothing but the ToInt16 it
# pulls through teensy.h, and it has to keep doing that when included next
# to the umbrella Bellows.h. That is the half worth running in CI, because
# it is the half that catches a guard WIDENED to fire off target. A guard
# narrowed to fire nowhere, which deletes the adapter on target, is caught
# only by half two, and half two is what a runner without arduino-cli skips.
# CI therefore checks one of the two directions, not both.
#
# Half two needs arduino-cli plus the esp32 core, and is skipped with a
# message when either is missing rather than passing silently. It builds a
# real ESP32-C3 image: one Kick through Esp32I2sAudio at the four flags this
# part needs, on the FQBN that matters. CDCOnBoot=cdc is not decoration.
# IO20 and IO21 are UART0 and are wired to I2S on this board, so the
# hardware console does not exist and USB CDC is the only serial there is.
#
# Exit code is the compiler's, so this doubles as a syntax check.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FQBN="esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio,FlashFreq=40,JTAGAdapter=builtin"
FLAGS="-DBELLOWS_FAST_MATH=1 -DBELLOWS_SAMPLE_RATE=22050 -DBELLOWS_BLOCK_SIZE=64 -DBELLOWS_TEMPO_SCALAR=float"

# ---------------------------------------------------------------- half one
cat > "$TMP/offtarget.cpp" <<'EOF'
#include "bellows/platform/esp32c3.h"
#include <Bellows.h>
int main() { return 0; }
EOF

c++ -std=c++17 -Wall -Wextra -Werror -I"$HERE/src" \
  -c "$TMP/offtarget.cpp" -o "$TMP/offtarget.o" || exit 1
echo "OK  off target, the guard expands to nothing and Bellows.h still compiles"

# ---------------------------------------------------------------- half two
if ! command -v arduino-cli >/dev/null 2>&1; then
  echo "SKIP  on target, arduino-cli is not on PATH. This half is unchecked."
  exit 0
fi
if ! arduino-cli core list 2>/dev/null | grep -q '^esp32:esp32'; then
  echo "SKIP  on target, the esp32:esp32 core is not installed. This half is unchecked."
  exit 0
fi

mkdir -p "$TMP/c3check/c3check"

# Arduino inserts generated prototypes above the first function in the .ino,
# so a struct named in a function signature has to live in a header. Patch is
# only a template argument here, but the rule is cheap to keep and this is
# the file a reader copies from.
cat > "$TMP/c3check/c3check/patch.h" <<'EOF'
#pragma once
#include "bellows/engines/drums.h"
struct Patch {
  bellows::Kick kick;
  void Init(float sr) { kick.Init(sr); }
  void operator()(float* l, float* r, int from, int to) {
    kick.Process(l, r, from, to);
  }
};
EOF

cat > "$TMP/c3check/c3check/c3check.ino" <<'EOF'
#include <ESP_I2S.h>
#include "bellows/platform/esp32c3.h"
#include "patch.h"

static I2SClass i2s;
static Patch patch;
static bellows::Esp32I2sAudio<Patch> audio;

void setup() {
  patch.Init(bellows::Esp32SampleRate());
  audio.Start(i2s, patch, 10, 20, 21);   /* bclk, lrclk, dout */
  patch.kick.NoteOn(50.0f, 0.9f);
}

void loop() {
  audio.Fill();
}
EOF

cd "$TMP/c3check" || exit 1
# LC_ALL=C on the child, because arduino-cli translates the size summary and
# resolves the locale from the environment. Without it the grep below finds
# nothing on a French or Spanish machine.
OUT="$(LC_ALL=C arduino-cli compile --fqbn "$FQBN" \
  --build-property "compiler.cpp.extra_flags=-I$HERE/src $FLAGS" \
  --build-path "$TMP/c3check/build" c3check 2>&1)" || {
  echo "$OUT" >&2
  exit 1
}
echo "OK  on target, links a complete ESP32-C3 image"
# The size line is a courtesy, not the verdict. Without the `|| true` and the
# explicit exit, this grep IS the script's exit status, so a build that passed
# reports failure the moment the summary wording changes. Measured: with the
# locale unpinned above, LC_ALL=fr_FR.UTF-8 printed both OK lines and exited 1.
echo "$OUT" | grep -E 'program storage|dynamic memory' || true
exit 0

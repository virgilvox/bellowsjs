#!/bin/bash
#
# Build every example for every Teensy the Audio Library supports, and
# print the result as a table. The board matrix in README.md is this
# script's output rather than a reading of data sheets.
#
#   ./build-matrix.sh              every example, every board
#   ./build-matrix.sh 15_Piezo     one example, every board
#
# Takes about an hour for the full sweep: 98 firmware builds, each with the
# Arduino core and the audio library, and PlatformIO does not share objects
# between board environments. Needs `pio` and the teensy platform:
#
#   pio pkg install --global --platform teensy
#
# Do not run anything else against this directory while it runs. Both
# invocations write .pio/build/<env>, and the second one to arrive gets
# "Fatal error: can't create ...", which reads like a compile failure and
# is not one.
#
# Columns:
#   ok NN%   built and linked; NN% is RAM used, which is the number that
#            decides whether a patch fits
#   RAM      linker refused: `region RAM overflowed`
#   n/a      the sketch declines this board on purpose, with an #error
#            that says why (12_DacOut on Teensy 4.x, which has no DAC)
#   FAIL     anything else, and worth reading the log for
#
# What ok means and does not mean is in OUTPUTS.md, under "What builds
# means". Short version: it fits and it is valid for the part. Whether the
# part is fast enough has never been measured on hardware.
set -u
cd "$(dirname "$0")" || exit 1

BOARDS="teensylc teensy31 teensy35 teensy36 teensy40 teensy41 teensymm"
ALL="00_BringUp 01_OneKick 02_DrumMachine 03_PolySynth 04_ScalesAndTuning
     05_MidiInstrument 06_FirstSteps 07_Workstation 10_AudioShield 11_I2SAmp
     12_DacOut 13_BareOutput 15_Piezo 20_Instruments"
EXAMPLES="${1:-$ALL}"

printf '%-22s' "example"
for b in $BOARDS; do printf '%-11s' "$b"; done
echo
for ex in $EXAMPLES; do
  printf '%-22s' "$ex"
  for b in $BOARDS; do
    out=$(PLATFORMIO_SRC_DIR="$ex" pio run -e "probe_$b" 2>&1)
    if echo "$out" | grep -q SUCCESS; then
      ram=$(echo "$out" | grep -oE 'RAM: *\[[^]]*\] *[0-9.]+%' | grep -oE '[0-9.]+%' | head -1)
      printf '%-11s' "ok ${ram:-}"
    elif echo "$out" | grep -q 'overflowed by'; then
      printf '%-11s' "RAM"
    elif echo "$out" | grep -q '#error'; then
      printf '%-11s' "n/a"
    else
      printf '%-11s' "FAIL"
    fi
  done
  echo
done

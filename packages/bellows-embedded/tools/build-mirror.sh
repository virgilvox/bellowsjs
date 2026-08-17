#!/bin/bash
#
# Assemble the Arduino Library Manager mirror: this package, flattened so that
# library.properties sits at the root of a repository.
#
# WHY A MIRROR EXISTS AT ALL
#
# The Arduino Library Manager indexes REPOSITORIES, not subdirectories. This
# library is one package inside a monorepo, so the Manager cannot see it where
# it lives. The decision recorded in docs/HANDOFF.md under "Decisions, made" is
# a mirror repository pushed from here on tag, rather than a release-zip
# submission, because a zip flow is manual forever and this is not.
#
# PlatformIO needs none of this. It consumes the subdirectory directly.
#
# WHAT SHIPS, and the list is deliberate rather than "everything"
#
# An installed Arduino library is read by the IDE, which scans examples/ for
# sketch folders and src/ for headers. Anything else in the tree is at best
# weight in every user's download and at worst something the IDE tries to
# interpret. So the dev infrastructure stays behind: test/ (the parity,
# safety and size harnesses), tools/ (this script and its siblings),
# package.json (npm scripts for harnesses that are not shipped),
# compile_flags.txt (clangd), and .DS_Store.
#
# examples/daisy_onekick is excluded too, and for a different reason: it is a
# Makefile and a main.cpp rather than a sketch, so it is not an Arduino example
# at all and the IDE would list a folder it cannot open. It stays in the
# monorepo where it is built.
#
#   ./tools/build-mirror.sh [destination]
#
# Default destination is ../../.mirror, which is gitignored.

set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$HERE/../../.mirror}"

rm -rf "$DEST"
mkdir -p "$DEST"

# The library itself.
cp -R "$HERE/src" "$DEST/src"
cp "$HERE/library.properties" "$DEST/library.properties"
cp "$HERE/library.json" "$DEST/library.json"
cp "$HERE/keywords.txt" "$DEST/keywords.txt"
cp "$HERE/README.md" "$DEST/README.md"
cp "$HERE/LICENSE" "$DEST/LICENSE"

# Examples, minus the ones that are not sketches and the build scaffolding.
mkdir -p "$DEST/examples"
for dir in "$HERE"/examples/*/; do
  name="$(basename "$dir")"
  [ "$name" = "daisy_onekick" ] && continue
  [ -f "$dir/$name.ino" ] || continue
  cp -R "$dir" "$DEST/examples/$name"
done
cp "$HERE/examples/README.md" "$DEST/examples/README.md"
cp "$HERE/examples/OUTPUTS.md" "$DEST/examples/OUTPUTS.md"

# ------------------------------------------------------------------ #
# Flatten the cross-folder includes.
#
# Six examples reach a sibling for a shared header, `#include
# "../10_AudioShield/audioshield.h"` and two of that shape, because the output
# examples deliberately share one patch so that comparing them compares
# converters rather than programs. PlatformIO resolves that: it compiles the
# folder in place. The Arduino IDE does not, and this is measured rather than
# assumed: before this step, `arduino-cli compile` failed on all five that
# reach the sketch (the sixth declines by #error first) with
# "fatal error: ../10_AudioShield/audioshield.h: No such file or directory".
#
# So the mirror copies the referenced header next to the sketch and rewrites
# the include to a local one. The monorepo keeps the shared header, which is
# what a reader reads and what the size sketches compile, and the mirror is
# regenerated from it on every tag, so the copies cannot drift the way a
# hand-made duplicate would.
#
# None of the three shared headers reaches across folders itself, checked, so
# one level is enough. If that ever stops being true this loop needs to
# recurse, and the assertion below is what will tell you.
# ------------------------------------------------------------------ #
flattened=0
for ino in "$DEST"/examples/*/*.ino; do
  dir="$(dirname "$ino")"
  while read -r rel; do
    [ -z "$rel" ] && continue
    hdr="$(basename "$rel")"
    srcpath="$HERE/examples/${rel#../}"
    if [ ! -f "$srcpath" ]; then
      echo "build-mirror: $ino includes $rel and $srcpath does not exist" >&2
      exit 1
    fi
    cp "$srcpath" "$dir/$hdr"
    # BSD and GNU sed disagree about -i, so write through a temp file.
    sed "s|#include \"$rel\"|#include \"$hdr\"|" "$ino" > "$ino.tmp" && mv "$ino.tmp" "$ino"
    flattened=$((flattened + 1))
  done < <(grep -oE '#include "\.\./[^"]+"' "$ino" | sed 's/#include "//; s/"$//')
done

# Nothing should still reach out of its own folder.
if grep -rlE '#include "\.\./' "$DEST/examples" >/dev/null 2>&1; then
  echo "build-mirror: a cross-folder include survived the flatten" >&2
  grep -rnE '#include "\.\./' "$DEST/examples" >&2
  exit 1
fi

# Anything the copies dragged in that should not ship.
find "$DEST" -name '.DS_Store' -delete
find "$DEST" -name '.pio' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" -name 'build' -type d -prune -exec rm -rf {} + 2>/dev/null || true

echo "mirror at $DEST"
echo "  headers:   $(find "$DEST/src" -name '*.h' | wc -l | tr -d ' ')"
echo "  examples:  $(find "$DEST/examples" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
echo "  flattened: $flattened cross-folder include(s)"
echo "  size:      $(du -sh "$DEST" | cut -f1 | tr -d ' ')"

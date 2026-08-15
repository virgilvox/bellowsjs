/*
 * Compiles every C++ snippet shown on the EMBEDDED tab of the code page.
 *
 * The javascript examples have check-examples.mjs, which resolves every
 * symbol they use against the built library, because an example that does
 * not run is worse than no example. The embedded snippets have the same
 * problem and a harder version of it: nobody reading the site can tell
 * whether the C++ compiles, and the failure is silent until somebody
 * pastes it into a sketch.
 *
 * So this wraps each snippet in the contract the page documents and runs a
 * real compiler over it. A snippet is:
 *
 *   - includes
 *   - file-scope statics
 *   - void setup()                        called once, rate is kSampleRate
 *   - void render(float*, float*, int, int)   the audio callback
 *   - optionally void loop()              board-side control, Arduino-ish
 *
 * Arduino calls are stubbed rather than avoided, because a potentiometer
 * example that cannot say analogRead is not the example anyone wants.
 *
 *   node scripts/check-embedded-examples.mjs
 *   node scripts/check-embedded-examples.mjs --keep   leave the temp dir
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const embeddedSrc = join(app, '../../packages/bellows-embedded/src');

/* The registry is TypeScript with extensionless imports, which vite
 * resolves and node does not. esbuild is already a dependency here, so
 * bundle it to one ESM file and import that rather than teaching this
 * script to parse TypeScript. */
const bundleDir = mkdtempSync(join(tmpdir(), 'bellows-embedded-reg-'));
const bundle = join(bundleDir, 'registry.mjs');
execFileSync(
  join(app, '../../node_modules/.bin/esbuild'),
  [
    join(app, 'src/examples/embedded/index.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--log-level=error',
    '--outfile=' + bundle,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);
const { EMBEDDED_EXAMPLES } = await import(bundle);
rmSync(bundleDir, { recursive: true, force: true });

/* Enough Arduino to compile a control snippet on a host. Deliberately
 * minimal and deliberately not a simulation: it exists so the compiler can
 * check types and names, not so the code runs. */
const STUBS = `
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <math.h>

static constexpr int A0 = 14, A1 = 15, A2 = 16, A3 = 17, A4 = 18, A5 = 19;
static constexpr int INPUT = 0, OUTPUT = 1, INPUT_PULLUP = 2;
static constexpr int HIGH = 1, LOW = 0;

inline int analogRead(int) { return 512; }
inline void analogWrite(int, int) {}
inline int digitalRead(int) { return 1; }
inline void digitalWrite(int, int) {}
inline void pinMode(int, int) {}
inline void delay(unsigned long) {}
inline void delayMicroseconds(unsigned long) {}
inline unsigned long millis() { return 0; }
inline unsigned long micros() { return 0; }
inline long map(long x, long a, long b, long c, long d) { return (x - a) * (d - c) / (b - a) + c; }
inline long constrain(long x, long a, long b) { return x < a ? a : (x > b ? b : x); }

struct SerialStub {
  void begin(unsigned long) {}
  void print(const char*) {}
  void print(float, int = 2) {}
  void print(int) {}
  void print(unsigned) {}
  void println(const char*) {}
  void println(float, int = 2) {}
  void println(int) {}
  void println(unsigned) {}
  void println() {}
  operator bool() const { return true; }
};
static SerialStub Serial;

/* usbMIDI, for the MIDI examples. */
struct MidiStub {
  bool read() { return false; }
  uint8_t getType() { return 0; }
  uint8_t getData1() { return 60; }
  uint8_t getData2() { return 100; }
  uint8_t getChannel() { return 1; }
  static constexpr uint8_t NoteOn = 0x90, NoteOff = 0x80, ControlChange = 0xB0;
};
static MidiStub usbMIDI;

inline float AudioProcessorUsage() { return 0.0f; }
inline float AudioProcessorUsageMax() { return 0.0f; }
inline void AudioProcessorUsageMaxReset() {}
inline void AudioMemory(int) {}
inline int AudioMemoryUsageMax() { return 0; }
`;

const MAIN = `
static float g_l[128], g_r[128];
extern "C" volatile float g_sink;
volatile float g_sink = 0.0f;

int main() {
  setup();
  for (int b = 0; b < 64; ++b) {
    for (int i = 0; i < 128; ++i) { g_l[i] = 0.0f; g_r[i] = 0.0f; }
    render(g_l, g_r, 0, 128);
    for (int i = 0; i < 128; ++i) g_sink += g_l[i] + g_r[i];
  }
  return 0;
}
`;

const dir = mkdtempSync(join(tmpdir(), 'bellows-embedded-check-'));
writeFileSync(join(dir, 'arduino_stubs.h'), STUBS);

let failed = 0;
let checked = 0;
const problems = [];

for (const ex of EMBEDDED_EXAMPLES) {
  const file = join(dir, `${ex.id.replace(/[^\w]/g, '_')}.cpp`);
  const source = `#include "arduino_stubs.h"\nstatic constexpr float kSampleRate = 48000.0f;\n\n${ex.cpp}\n${MAIN}`;
  writeFileSync(file, source);
  checked++;
  try {
    execFileSync(
      'c++',
      [
        '-std=c++17',
        '-O1',
        '-Wall',
        '-Wextra',
        '-Wno-unused-function',
        '-Wno-unused-parameter',
        '-I',
        embeddedSrc,
        '-I',
        dir,
        file,
        '-o',
        join(dir, 'a.out'),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    failed++;
    const msg = (err.stderr?.toString() ?? err.message)
      .split('\n')
      .filter((l) => /error:/.test(l))
      .slice(0, 3)
      .join('\n      ');
    problems.push(`  ${ex.id}\n      ${msg || 'compile failed'}`);
  }
}

if (!process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true });

if (failed) {
  console.log(`embedded examples: ${checked} checked, ${failed} do not compile\n`);
  for (const p of problems) console.log(p);
  process.exit(1);
}
console.log(`ok       ${checked} embedded examples compile against the real headers`);

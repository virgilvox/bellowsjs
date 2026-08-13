<!--
  The simulator: pick a firmware, hear it, change it, take it to a board.

  What this page is honest about, in the page itself and not only here: it
  does not emulate a Cortex-M7. It runs the TypeScript implementation of the
  same DSP that the C++ firmware compiles from, and this repository measures
  the difference between those two on every commit. That measurement is
  printed next to the transport rather than left as a promise.

  The three panels that matter are BOARD (what you would wire), FIRMWARE
  (what runs, and the real source), and OUTPUT (what the sound goes through
  on its way out, which is where most of the audible difference lives).
-->
<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { ensureBellows, disposeBellows, bellows, booted } from '../lib/audio';
import { FIRMWARES, FIRMWARE_BY_ID, applyParams, type FirmwareParam } from '../lib/sim/firmware';
import { OUTPUTS, OUTPUT_BY_ID, OutputStageGraph, noiseFloorDb, type OutputId } from '../lib/sim/output-stage';
import { buildVoice, VOICE_CAVEATS, type RunningVoice } from '../lib/sim/voices';
import { BOARDS, type BoardId } from '../lib/sim/board';
import BoardDiagram from '../components/sim/BoardDiagram.vue';
import FlashPanel from '../components/sim/FlashPanel.vue';

const firmwareId = ref(FIRMWARES[0].id);
const boardId = ref<BoardId>('teensy41');
const outputId = ref<OutputId>('shield');
const running = ref(false);
const status = ref('idle');
const potValue = ref(0.5);
const heldKeys = ref<number[]>([]);
const showSource = ref(true);

const fw = computed(() => FIRMWARE_BY_ID.get(firmwareId.value)!);
const board = computed(() => BOARDS.find((b) => b.id === boardId.value)!);
const out = computed(() => OUTPUT_BY_ID.get(outputId.value)!);
const caveats = computed(() => VOICE_CAVEATS[fw.value.voice] ?? []);

/** A working copy of the firmware's parameters, so edits do not mutate the catalogue. */
const params = ref<FirmwareParam[]>(cloneParams());
function cloneParams(): FirmwareParam[] {
  return fw.value.params.map((p) => ({ ...p }));
}

/** Outputs this board actually has. A Teensy 4.x has no DAC at all. */
const availableOutputs = computed(() =>
  OUTPUTS.filter((o) => o.boards.includes(boardId.value) && fw.value.outputs.includes(o.id)),
);

const parityDb = computed(() => {
  const r = fw.value.parityRelRms;
  return r === null ? null : Math.round(20 * Math.log10(r));
});

const exported = computed(() => applyParams(fw.value.headerSource, params.value));

/* ---------------- audio ---------------- */

let voice: RunningVoice | null = null;
let stage: OutputStageGraph | null = null;
let timer: number | null = null;
let stepIndex = 0;

async function start(): Promise<void> {
  if (running.value) return;
  status.value = 'booting';
  const b = await ensureBellows('sim/' + fw.value.id);
  insertStage(b);
  voice = buildVoice(b, fw.value, params.value);
  running.value = true;
  status.value = 'running';
  stepIndex = 0;
  tick();
}

function tick(): void {
  if (!running.value || !voice || !bellows.value) return;
  const b = bellows.value;
  const bpm = params.value.find((p) => p.key === 'bpm')?.value ?? 120;
  const effectiveBpm = fw.value.inputs.some((i) => i.kind === 'pot')
    ? 60 + potValue.value * 120
    : bpm;
  const stepSec = voice.stepSec ?? 60 / effectiveBpm / voice.stepsPerBeat;
  voice.step(stepIndex++, b.now() + 0.05);
  timer = window.setTimeout(tick, stepSec * 1000);
}

function stop(): void {
  running.value = false;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  voice?.dispose();
  voice = null;
  removeStage();
  disposeBellows();
  status.value = 'idle';
}

/**
 * Splice the output stage between the library's analyser and the speakers.
 *
 * `analyser` is public API and the scope panel already reads it. The chain
 * the facade builds is kernel -> analyser -> destination, so breaking the
 * second link and rebuilding it through the stage needs nothing private and
 * no change to the library.
 */
function insertStage(b: NonNullable<typeof bellows.value>): void {
  const ctx = b.analyser.context;
  stage = new OutputStageGraph(ctx, outputId.value);
  b.analyser.disconnect();
  b.analyser.connect(stage.inputNode);
  stage.outputNode.connect(ctx.destination);
}

function removeStage(): void {
  const b = bellows.value;
  if (b && stage) {
    try {
      b.analyser.disconnect();
      stage.dispose();
      b.analyser.connect(b.analyser.context.destination);
    } catch {
      /* the context may already be gone during teardown */
    }
  }
  stage = null;
}

watch(outputId, (id) => stage?.setOutput(id));

watch(firmwareId, () => {
  const wasRunning = running.value;
  stop();
  params.value = cloneParams();
  if (!availableOutputs.value.some((o) => o.id === outputId.value)) {
    outputId.value = availableOutputs.value[0]?.id ?? 'shield';
  }
  if (wasRunning) void start();
});

watch(boardId, () => {
  if (!availableOutputs.value.some((o) => o.id === outputId.value)) {
    outputId.value = availableOutputs.value[0]?.id ?? 'shield';
  }
});

function onParam(p: FirmwareParam): void {
  voice?.setParam(p.key, p.value);
}

/* Keyboard for the firmwares that take notes. Two rows, one octave. */
const KEYS = [60, 62, 64, 65, 67, 69, 71, 72];
function keyDown(midi: number): void {
  if (!voice?.noteOn) return;
  voice.noteOn(midi);
  if (!heldKeys.value.includes(midi)) heldKeys.value = [...heldKeys.value, midi];
}
function keyUp(midi: number): void {
  voice?.noteOff?.(midi);
  heldKeys.value = heldKeys.value.filter((k) => k !== midi);
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* KeepAlive wraps every view, so unmount may never fire. */
onDeactivated(stop);
onBeforeUnmount(stop);
onActivated(() => {
  status.value = 'idle';
});
</script>

<template>
  <div class="sim">
    <aside class="rail">
      <div class="panel">
        <div class="panel-title">firmware <em>01</em></div>
        <button
          v-for="f in FIRMWARES"
          :key="f.id"
          class="entry"
          :class="{ lit: f.id === firmwareId }"
          @click="firmwareId = f.id"
        >
          {{ f.title }}
        </button>
      </div>

      <div class="panel">
        <div class="panel-title">board <em>02</em></div>
        <select v-model="boardId">
          <option v-for="b in BOARDS" :key="b.id" :value="b.id">{{ b.label }}</option>
        </select>
        <p class="note">{{ board.blurb }}</p>
      </div>
    </aside>

    <main class="main">
      <section class="panel board-panel">
        <div class="panel-title">
          board <em>03 // {{ board.label }}</em>
        </div>
        <BoardDiagram
          :board="board"
          :inputs="fw.inputs"
          :indicators="fw.indicators"
          :output="out"
          :active="running"
        />
      </section>

      <section class="panel run-panel">
        <div class="panel-title">
          transport <em>04</em>
        </div>
        <div class="row">
          <button class="big" :class="{ lit: running }" @click="running ? stop() : start()">
            {{ running ? 'STOP' : 'RUN' }}
          </button>
          <span class="lamp-dot" :class="{ hot: booted }"></span>
          <span class="meta">{{ status }}</span>
        </div>

        <p class="accuracy">
          This runs the TypeScript implementation of the same DSP, not an emulated Cortex-M7.
          <template v-if="fw.parityRelRms !== null">
            The repository diffs the two on every commit: for
            <code>{{ fw.parityRow }}</code> the measured difference is
            <b>{{ fw.parityRelRms.toExponential(2) }}</b> relative RMS, about
            <b>{{ parityDb }} dB</b>.
          </template>
          Timing is not simulated: whether this board renders it in time has never been measured
          on hardware, for any board.
        </p>
        <ul v-if="caveats.length" class="caveats">
          <li v-for="c in caveats" :key="c">{{ c }}</li>
        </ul>
      </section>

      <section class="panel out-panel">
        <div class="panel-title">output <em>05</em></div>
        <div class="chips">
          <button
            v-for="o in availableOutputs"
            :key="o.id"
            :class="{ lit: o.id === outputId }"
            @click="outputId = o.id"
          >
            {{ o.label }}
          </button>
        </div>
        <p class="note">{{ out.blurb }}</p>
        <div class="facts">
          <span v-if="out.bits">{{ out.bits }} bit</span>
          <span v-if="noiseFloorDb(out.bits)">floor {{ noiseFloorDb(out.bits) }} dB</span>
          <span>{{ out.mono ? 'mono' : 'stereo' }}</span>
          <span>{{ out.example }}</span>
        </div>
        <p class="basis">{{ out.basis }}</p>
      </section>

      <section v-if="params.length" class="panel">
        <div class="panel-title">parameters <em>06</em></div>
        <div class="field" v-for="p in params" :key="p.key">
          <label>{{ p.label }}<span v-if="p.unit"> // {{ p.unit }}</span></label>
          <div class="slider-row">
            <input
              type="range"
              :min="p.min"
              :max="p.max"
              :step="p.step"
              v-model.number="p.value"
              @input="onParam(p)"
            />
            <output>{{ p.value }}</output>
          </div>
          <p class="hint">{{ p.hint }}</p>
        </div>
      </section>

      <section v-if="fw.inputs.length" class="panel">
        <div class="panel-title">inputs <em>07</em></div>
        <div v-for="inp in fw.inputs" :key="inp.label" class="input-block">
          <label>{{ inp.label }}<span v-if="inp.pin !== null"> // PIN {{ inp.pin }}</span></label>
          <p class="hint">{{ inp.hint }}</p>

          <div v-if="inp.kind === 'pot'" class="slider-row">
            <input type="range" min="0" max="1" step="0.001" v-model.number="potValue" />
            <output>{{ Math.round(potValue * 1023) }}</output>
          </div>

          <div v-else-if="inp.kind === 'keys'" class="keys">
            <button
              v-for="k in KEYS"
              :key="k"
              class="key"
              :class="{ lit: heldKeys.includes(k) }"
              @pointerdown="keyDown(k)"
              @pointerup="keyUp(k)"
              @pointerleave="keyUp(k)"
            >
              {{ k }}
            </button>
          </div>
        </div>
      </section>

      <section class="panel wide">
        <div class="panel-title">
          firmware source <em>08 // {{ fw.folder }}/{{ fw.headerName }}</em>
        </div>
        <p class="note">
          The real file, generated from the example rather than copied, so it cannot drift from
          what compiles. Your parameter changes are written back into it, so what downloads is
          this example with your numbers and every comment its author wrote still in place.
        </p>
        <div class="row">
          <button @click="showSource = !showSource">{{ showSource ? 'HIDE' : 'SHOW' }} SOURCE</button>
          <button @click="download(fw.headerName, exported.text)">DOWNLOAD .H</button>
          <button @click="download(fw.folder + '.ino', fw.inoSource)">DOWNLOAD .INO</button>
          <span class="meta">{{ exported.applied }} value(s) written</span>
        </div>
        <pre v-if="showSource">{{ exported.text }}</pre>
      </section>

      <div class="wide"><FlashPanel :board="board" :firmware="fw" /></div>
    </main>
  </div>
</template>

<style scoped>
.sim {
  display: grid;
  grid-template-columns: 232px 1fr;
  gap: 16px;
  align-items: start;
}

/*
 * The main column is itself a two-up grid rather than a stack.
 *
 * Stacked full-width panels meant the board diagram sat next to a metre of
 * empty paper and everything else was a scroll away. Pairing them puts the
 * board beside the transport and the output beside the parameters, which is
 * how they are actually used: you change one and listen to the other. The
 * source and the flasher stay full width because both are long text.
 */
.main {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.main > .panel {
  margin-bottom: 0;
}
.wide {
  grid-column: 1 / -1;
}
.board-panel {
  grid-row: span 2;
}
.rail .entry {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 4px;
}
.note {
  font-size: 11.5px;
  color: var(--tick);
  line-height: 1.6;
  margin-top: 8px;
}
.hint {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.06em;
  margin-top: 3px;
}
.meta {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.facts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.facts span {
  border: 1px solid var(--seam);
  padding: 2px 6px;
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.basis,
.accuracy {
  font-size: 11px;
  color: var(--tick);
  line-height: 1.6;
  margin-top: 10px;
  max-width: 74ch;
}
.accuracy b {
  color: var(--phosphor-hot);
}
.caveats {
  margin: 8px 0 0 16px;
  font-size: 11px;
  color: var(--faded);
  line-height: 1.6;
}
.big {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  padding: 9px 22px;
}
.keys {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.key {
  min-width: 44px;
  min-height: 44px;
  touch-action: none;
}
.input-block {
  margin-bottom: 12px;
}
.input-block label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--tick);
}
pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow-x: auto;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  margin-top: 10px;
  max-height: 420px;
}
/* The two-up main column needs about 560px per side before the board
 * diagram and its legend stop fitting, so it collapses first and the rail
 * follows at the app's usual 900. */
@media (max-width: 1180px) {
  .main {
    grid-template-columns: 1fr;
  }
  .board-panel {
    grid-row: auto;
  }
}
@media (max-width: 900px) {
  .sim {
    grid-template-columns: 1fr;
  }
  .rail {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }
  .rail .panel {
    margin-bottom: 0;
  }
}
@media (max-width: 560px) {
  .rail {
    grid-template-columns: 1fr;
  }
}
</style>

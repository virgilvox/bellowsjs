<!--
  The simulator: pick a firmware, hear it, change it, take it to a board.

  What this page is honest about, in the page itself and not only here: it
  does not emulate a Cortex-M7. It runs the TypeScript implementation of the
  same DSP that the C++ firmware compiles from, and this repository measures
  the difference between those two on every commit. That measurement is
  printed next to the transport rather than left as a promise.

  LAID OUT AS A CONSOLE, WHICH IS THE THIRD SHAPE THIS PAGE HAS HAD.

  It was one column, then a two-up grid, and both were a scroll: sixteen
  panels is sixteen panels however they are arranged, and the controls you
  use continuously (RUN, the output path, the status lamp) went off the top
  of the screen the moment you looked at anything else.

  So the panels are not rearranged here, they are collapsed. One strip stays
  put, holding the transport, the pickers and the one sentence about what
  this actually runs, and everything else takes turns in a single area under
  it. That removes the scroll rather than moving it: the strip and the tabs
  are about 170 px, and whichever area is showing gets the rest of the
  window without competing with five others.

  The strip is `position: sticky; top: 16px`, which is the app's one sticky
  convention (DocsView's sidebar uses the same 16). It is not `fixed`,
  because the page header should still scroll away.
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

const fw = computed(() => FIRMWARE_BY_ID.get(firmwareId.value)!);

/**
 * The picker, grouped by what kind of thing an entry is.
 *
 * Twenty-two flat entries is a list you scroll rather than read, and the
 * groups are a real distinction: four rungs of primitives, four programs
 * that teach one idea each, one that puts them together, eleven patches
 * sharing a note source, and two about getting sound off the board.
 *
 * The group order is written down rather than taken from the array,
 * because the order to READ them in is not the order the examples are
 * numbered in: 06 is the rung below 01, and 20 is a library rather than a
 * lesson. Order within a group stays as FIRMWARES has it.
 */
const GROUP_ORDER = [
  'first steps',
  'learn the library',
  'the whole thing',
  'instruments',
  'getting sound out',
];

const FIRMWARE_GROUPS = computed(() =>
  GROUP_ORDER.map((name) => ({ name, items: FIRMWARES.filter((f) => f.group === name) })).filter(
    (g) => g.items.length > 0,
  ),
);
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

/* ---------------- the switchable area ---------------- */

type TabId = 'board' | 'code' | 'params' | 'inputs' | 'flash';

/**
 * One area at a time, in the order you meet them: what you would wire, what
 * runs, what you can turn, what you can play, how it gets to the board.
 *
 * A tab with nothing in it is disabled rather than removed, so the row does
 * not reflow when you change firmware and the same tab stays under the same
 * finger.
 */
const TABS: Array<{ id: TabId; label: string; num: string }> = [
  { id: 'board', label: 'board', num: '02' },
  { id: 'code', label: 'code', num: '03' },
  { id: 'params', label: 'parameters', num: '04' },
  { id: 'inputs', label: 'inputs', num: '05' },
  { id: 'flash', label: 'flash', num: '06' },
];
const tab = ref<TabId>('board');

function tabEnabled(id: TabId): boolean {
  if (id === 'params') return params.value.length > 0;
  if (id === 'inputs') return fw.value.inputs.length > 0;
  return true;
}
const activeTab = computed(() => TABS.find((t) => t.id === tab.value)!);

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
  /* A firmware with no pot leaves you looking at an empty INPUTS. */
  if (!tabEnabled(tab.value)) tab.value = 'board';
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
    <!--
      The strip. Everything in here is either something you press while
      listening or something you need to be able to read while listening,
      which is the whole rule for what earns a place in it.
    -->
    <div class="deck">
      <section class="panel strip">
        <div class="panel-title">
          simulator <em>01 // {{ fw.folder }}</em>
        </div>

        <div class="row transport">
          <button class="big" :class="{ lit: running }" @click="running ? stop() : start()">
            {{ running ? 'STOP' : 'RUN' }}
          </button>
          <span class="lamp-dot" :class="{ hot: booted }"></span>
          <span class="meta status">{{ status }}</span>

          <label class="pick">
            <span class="pick-label">firmware</span>
            <select v-model="firmwareId">
              <optgroup v-for="g in FIRMWARE_GROUPS" :key="g.name" :label="g.name">
                <option v-for="f in g.items" :key="f.id" :value="f.id">{{ f.title }}</option>
              </optgroup>
            </select>
          </label>

          <label class="pick">
            <span class="pick-label">board</span>
            <select v-model="boardId">
              <option v-for="b in BOARDS" :key="b.id" :value="b.id">{{ b.label }}</option>
            </select>
          </label>
        </div>

        <div class="row outs">
          <span class="pick-label">output</span>
          <button
            v-for="o in availableOutputs"
            :key="o.id"
            :class="{ lit: o.id === outputId }"
            @click="outputId = o.id"
          >
            {{ o.label }}
          </button>
        </div>

        <!--
          The claim, on one line, where it cannot be scrolled away from. The
          paragraph that explains it is under BOARD; this is the part that
          has to stay in front of you while you listen.
        -->
        <p class="accuracy">
          TypeScript, not an emulated Cortex-M7.
          <template v-if="fw.parityRelRms !== null">
            <code>{{ fw.parityRow }}</code> measured against the C++ at
            <b>{{ fw.parityRelRms.toExponential(2) }}</b> relative RMS, about
            <b>{{ parityDb }} dB</b>.
          </template>
          Timing is not simulated.
        </p>
      </section>

      <nav class="tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          :class="{ lit: t.id === tab }"
          :disabled="!tabEnabled(t.id)"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>
    </div>

    <section class="panel stage">
      <div class="panel-title">
        {{ activeTab.label }}
        <em>
          {{ activeTab.num }}
          <template v-if="tab === 'board'"> // {{ board.label }}</template>
          <template v-else-if="tab === 'code'"> // {{ fw.folder }}/{{ fw.headerName }}</template>
        </em>
      </div>

      <!-- BOARD: what you would wire, and what the page is claiming -->
      <div v-if="tab === 'board'">
        <BoardDiagram
          :board="board"
          :inputs="fw.inputs"
          :indicators="fw.indicators"
          :output="out"
          :active="running"
        />

        <div class="split">
          <div>
            <div class="sub">output path // {{ out.label }}</div>
            <p class="note">{{ out.blurb }}</p>
            <div class="facts">
              <span v-if="out.bits">{{ out.bits }} bit</span>
              <span v-if="noiseFloorDb(out.bits)">floor {{ noiseFloorDb(out.bits) }} dB</span>
              <span>{{ out.mono ? 'mono' : 'stereo' }}</span>
              <span>{{ out.example }}</span>
            </div>
            <p class="basis">{{ out.basis }}</p>
          </div>

          <div>
            <div class="sub">what this is, in full</div>
            <p class="note">
              This runs the TypeScript implementation of the same DSP, not an emulated
              Cortex-M7.
              <template v-if="fw.parityRelRms !== null">
                The repository diffs the two on every commit: for
                <code>{{ fw.parityRow }}</code> the measured difference is
                <b>{{ fw.parityRelRms.toExponential(2) }}</b> relative RMS, about
                <b>{{ parityDb }} dB</b>.
              </template>
              Timing is not simulated: whether this board renders it in time has never been
              measured on hardware, for any board.
            </p>
            <ul v-if="caveats.length" class="caveats">
              <li v-for="c in caveats" :key="c">{{ c }}</li>
            </ul>
            <p class="note">{{ board.blurb }}</p>
          </div>
        </div>
      </div>

      <!-- CODE: the real file, with your numbers written into it -->
      <div v-else-if="tab === 'code'">
        <p class="note">
          The real file, generated from the example rather than copied, so it cannot drift from
          what compiles. Your parameter changes are written back into it, so what downloads is
          this example with your numbers and every comment its author wrote still in place.
        </p>
        <div class="row">
          <button @click="download(fw.headerName, exported.text)">DOWNLOAD .H</button>
          <button @click="download(fw.folder + '.ino', fw.inoSource)">DOWNLOAD .INO</button>
          <span class="meta">{{ exported.applied }} value(s) written</span>
        </div>
        <pre>{{ exported.text }}</pre>
      </div>

      <!-- PARAMETERS -->
      <div v-else-if="tab === 'params'" class="fields">
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
      </div>

      <!-- INPUTS -->
      <div v-else-if="tab === 'inputs'">
        <div v-for="inp in fw.inputs" :key="inp.label" class="input-block">
          <label>{{ inp.label }}<span v-if="inp.pin !== null"> // PIN {{ inp.pin }}</span></label>
          <p class="hint">{{ inp.hint }}</p>

          <div v-if="inp.kind === 'pot'" class="slider-row narrow">
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
      </div>

      <!-- FLASH -->
      <FlashPanel v-else :board="board" :firmware="fw" />
    </section>
  </div>
</template>

<style scoped>
.sim {
  display: block;
}

/*
 * The strip and the tabs travel together, so the tab you are on is always
 * visible next to the transport that is driving it. The background matters:
 * without it the page shows through the gap between the two as the content
 * scrolls under them.
 */
.deck {
  position: sticky;
  top: 16px;
  z-index: 5;
  background: var(--forge);
  padding-bottom: 10px;
}
.strip {
  margin-bottom: 10px;
}
.tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tabs button {
  font-family: var(--disp);
  font-weight: 600;
  padding: 8px 16px;
}
.stage {
  min-height: 380px;
}
/* The flash panel is a panel of its own, so it must not draw a second box
 * inside this one. Capped, because its select is width 100% and would
 * otherwise stretch across the whole console. */
.stage :deep(.panel) {
  background: none;
  border: none;
  box-shadow: none;
  padding: 0;
  margin-bottom: 0;
  max-width: 780px;
}
.stage :deep(.panel > .panel-title) {
  display: none;
}

.transport {
  margin-bottom: 8px;
}
.outs {
  border-top: 1px dashed var(--seam);
  padding-top: 8px;
}
.pick {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pick select {
  width: auto;
  min-width: 168px;
}
.pick-label,
.sub {
  font-size: 10px;
  color: var(--tick);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.sub {
  border-bottom: 1px dashed var(--seam);
  padding-bottom: 5px;
  margin-bottom: 8px;
}
.status {
  min-width: 62px;
}

.split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 18px;
  border-top: 1px dashed var(--seam);
  padding-top: 14px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 20px;
}

.note {
  font-size: 11.5px;
  color: var(--tick);
  line-height: 1.6;
  margin-top: 8px;
  max-width: 74ch;
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
.accuracy {
  margin-top: 8px;
}
.accuracy b,
.note b {
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
  margin-bottom: 16px;
  max-width: 520px;
}
.input-block label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--tick);
}
.slider-row.narrow {
  max-width: 320px;
}
pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  margin-top: 10px;
  /* The strip and the tabs are about 170 px, so this is the rest of a
   * short window with the panel's own chrome taken off. */
  max-height: calc(100vh - 330px);
  min-height: 300px;
}
code {
  font-family: var(--mono);
  background: var(--char);
  border: 1px solid var(--seam);
  padding: 0 4px;
  color: var(--phosphor-hot);
}

@media (max-width: 900px) {
  .split {
    grid-template-columns: 1fr;
  }
  /* Below this the strip is tall enough that pinning it costs more room
   * than it saves. */
  .deck {
    position: static;
  }
}
</style>

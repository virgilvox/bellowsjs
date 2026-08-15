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
import {
  FIRMWARES,
  FIRMWARE_BY_ID,
  GROUP_ORDER,
  applyParams,
  type FirmwareParam,
} from '../lib/sim/firmware';
import { OUTPUTS, OUTPUT_BY_ID, OutputStageGraph, noiseFloorDb, type OutputId } from '../lib/sim/output-stage';
import { buildVoice, VOICE_CAVEATS, type RunningVoice } from '../lib/sim/voices';
import { BOARDS, wiringFor, type BoardId } from '../lib/sim/board';
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

/**
 * Outputs this board actually has. A Teensy 4.x has no DAC at all.
 *
 * Ordered by the FIRMWARE's list rather than by the OUTPUTS declaration,
 * because `Firmware.outputs` is documented as "first is the default" and
 * filtering the global list silently made that false. 15_Piezo and
 * 16_WorkstationPiezo both name `piezo` first and both were landing on MQS,
 * which is the same patch with no high pass, no resonance lift and no disc
 * at all: exactly the comparison those two entries exist to prevent. Every
 * other entry lists the outputs in the declaration order already, so this
 * changes the button row for those two and for nothing else.
 */
const availableOutputs = computed(() =>
  fw.value.outputs
    .map((id) => OUTPUT_BY_ID.get(id))
    .filter((o): o is (typeof OUTPUTS)[number] => !!o && o.boards.includes(boardId.value)),
);

const parityDb = computed(() => {
  const r = fw.value.parityRelRms;
  return r === null ? null : Math.round(20 * Math.log10(r));
});

const exported = computed(() => applyParams(fw.value.headerSource, params.value));

/** Exact connections for this output on this board. */
const wiring = computed(() => wiringFor(board.value, outputId.value));

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
  /* A choice list counts: 21_Presets has no sliders and one picker, and
   * that picker is the only control it has. */
  if (id === 'params') return params.value.length > 0 || (fw.value.choices?.length ?? 0) > 0;
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
  /* The builder starts on the first choice, so a rebuild after a stop
   * would otherwise play preset 1 while the picker still reads the one
   * you chose. */
  if (fw.value.choices && choiceIndex.value !== 0) voice.select?.(choiceIndex.value);
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
  choiceIndex.value = 0;
  /*
   * Take the new firmware's own default rather than keeping the last
   * output, which is what this used to do and only changed the selection
   * when the old one was unavailable.
   *
   * That was survivable while every entry offered most of the paths. It
   * stopped being once two entries existed whose whole point is one
   * converter: coming off 16_WorkstationPiezo left PIEZO DISC selected, so
   * the next program you picked played through a 1.2 kHz high pass and a
   * resonance lift and sounded broken. Comparing converters is done inside
   * one entry, with the row below, and it still is.
   */
  outputId.value = availableOutputs.value[0]?.id ?? 'shield';
  /* A firmware with no pot leaves you looking at an empty INPUTS. */
  if (!tabEnabled(tab.value)) tab.value = 'board';
  if (wasRunning) void start();
});

watch(boardId, () => {
  if (!availableOutputs.value.some((o) => o.id === outputId.value)) {
    outputId.value = availableOutputs.value[0]?.id ?? 'shield';
  }
});

const PIEZO_KEYS: Record<string, 'highpassHz' | 'resonanceHz' | 'resonanceDb'> = {
  highpass_hz: 'highpassHz',
  resonance_hz: 'resonanceHz',
  resonance_db: 'resonanceDb',
};

function onParam(p: FirmwareParam): void {
  /* The piezo voicing lives in the output stage, not in the voice: those
   * three are Voicing fields in piezo.h and there is no engine parameter
   * they could reach. */
  const piezoKey = PIEZO_KEYS[p.key];
  if (piezoKey && stage) {
    stage.setPiezo({ [piezoKey]: p.value });
    return;
  }
  voice?.setParam(p.key, p.value);
}

/*
 * The selected entry of `fw.choices`, for the one firmware that picks
 * rather than adjusts.
 *
 * It survives a stop and start, because the voice is rebuilt on start and
 * would otherwise silently snap back to the first preset while the control
 * still read the one you chose.
 */
const choiceIndex = ref(0);
function onChoice(): void {
  voice?.select?.(choiceIndex.value);
  /*
   * Back to bar 0, step 0, which is what presets.h does: its Select ends
   * with `step_ = 0` so a new preset always enters on the line.
   *
   * Without this the free-running counter carries on, and a preset picked
   * during a chord bar lands somewhere in the middle of one. A chord bar
   * only acts on step 0 and step 12, so the new instrument could sit
   * silent for up to thirteen sixteenths, about two seconds at 96 bpm,
   * and read as a preset that does not work.
   */
  stepIndex = 0;
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

      <!-- BOARD: what you would wire -->
      <div v-if="tab === 'board'">
        <BoardDiagram
          :board="board"
          :inputs="fw.inputs"
          :indicators="fw.indicators"
          :output="out"
          :active="running"
        />

        <div class="split">
          <div v-if="wiring">
            <div class="sub">wiring // {{ out.label }} on {{ board.label }}</div>
            <p class="parts">{{ wiring.parts }}</p>
            <table class="wires">
              <tr v-for="(w, i) in wiring.rows" :key="i">
                <td class="from">{{ w.from }}</td>
                <td class="arrow">-&gt;</td>
                <td>{{ w.to }}</td>
              </tr>
            </table>
            <p v-if="wiring.gotcha" class="gotcha">{{ wiring.gotcha }}</p>
          </div>
          <div v-else>
            <div class="sub">wiring // {{ out.label }}</div>
            <p class="note">This board has no {{ out.label.toLowerCase() }}.</p>
          </div>

          <div>
            <div class="sub">what you are hearing</div>
            <div class="facts">
              <span v-if="out.bits">{{ out.bits }} bit</span>
              <span v-if="noiseFloorDb(out.bits)">floor {{ noiseFloorDb(out.bits) }} dB</span>
              <span>{{ out.mono ? 'mono' : 'stereo' }}</span>
              <span>{{ out.example }}</span>
            </div>
            <p class="note">{{ out.blurb }}</p>
            <p class="basis">{{ out.basis }}</p>
            <ul v-if="caveats.length" class="caveats">
              <li v-for="c in caveats" :key="c">{{ c }}</li>
            </ul>
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
        <div class="field" v-if="fw.choices">
          <label>preset<span> // {{ choiceIndex + 1 }} of {{ fw.choices.length }}</span></label>
          <select v-model.number="choiceIndex" @change="onChoice">
            <option v-for="c in fw.choices" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
          <p class="hint">
            Every one of these is a row in the preset table, and the same table
            compiles into the firmware. Changing it rebuilds the voice, which is
            what the board does too.
          </p>
        </div>
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
.wires {
  border-collapse: collapse;
  font-size: 11px;
  line-height: 1.7;
  margin-top: 8px;
}
.wires td {
  padding: 1px 10px 1px 0;
  vertical-align: top;
  color: var(--tick);
}
.wires .from {
  color: var(--phosphor-hot);
  white-space: nowrap;
}
.wires .arrow {
  color: var(--faded);
}
.parts {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.gotcha {
  font-size: 11px;
  color: var(--tick);
  line-height: 1.6;
  margin-top: 10px;
  padding-left: 10px;
  border-left: 2px solid var(--slag);
  max-width: 62ch;
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

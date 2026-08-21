<!--
  A play button inside a documentation page.

  WHY THIS EXISTS

  Until this component, a docs page could only describe a sound. The body
  goes through `v-html`, which cannot mount a component, so a tutorial
  about audio was a tutorial you read. Everything in docs/DOCS-PLAN.md
  depends on that stopping being true: a reader hears a kick drum in the
  first thirty seconds, without a board, without a toolchain, without
  buying anything.

  WHAT IT PLAYS

  A firmware from the simulator's catalogue, by id, through the same
  `buildVoice` the simulator uses. So the sound here is the same sound the
  playground makes, from the same TypeScript implementation of the same
  DSP the C++ compiles from, and the parity harness measures the distance
  between those two on every commit.

  It does NOT install the output stage the simulator splices in. That stage
  models a piezo disc or an 8-bit DAC, and it belongs on the page where you
  are choosing an output path, not on the page where you are hearing a
  patch for the first time.

  THE PREDICT SLOT IS NOT DECORATION

  `predict` renders above the button and stays up while it plays. It is the
  P in PRIMM: research on teaching programming is consistent that
  committing to a guess before seeing the answer is what turns running
  somebody else's code into learning, and it is the cheapest intervention a
  written page has. A block with sliders and no question is a toy.

  WHY THE IMPORTS ARE DYNAMIC

  `firmware.ts` and `voices.ts` are over a thousand lines together and pull
  the whole engine catalogue with them. Loading that into the docs bundle
  for every reader, including the ones who never press play, is a cost with
  no return, so both arrive on the click.
-->
<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref } from 'vue';
import { ensureBellows, bellows } from '../../lib/audio';
import { claim, release } from '../../lib/docs-player';
import type { FirmwareParam } from '../../lib/sim/firmware';
import type { RunningVoice } from '../../lib/sim/voices';

const props = defineProps<{
  firmware: string;
  /** Param keys to expose as sliders. Everything else keeps its default. */
  params?: string[];
  caption?: string;
  predict?: string;
}>();

const running = ref(false);
const busy = ref(false);
const failed = ref('');

/** The sliders, built on first play from the firmware's own param specs. */
const knobs = ref<FirmwareParam[]>([]);

/*
 * The full param list handed to buildVoice, kept raw rather than in a ref.
 * The slider writes through to the matching entry by key, so the tick loop
 * reads a current bpm without either list proxying the other.
 */
let params: FirmwareParam[] = [];
let voice: RunningVoice | null = null;
let timer: number | null = null;
let stepIndex = 0;

async function start(): Promise<void> {
  if (running.value || busy.value) return;
  busy.value = true;
  failed.value = '';
  try {
    const [{ FIRMWARE_BY_ID }, { buildVoice }] = await Promise.all([
      import('../../lib/sim/firmware'),
      import('../../lib/sim/voices'),
    ]);
    const fw = FIRMWARE_BY_ID.get(props.firmware);
    if (!fw) throw new Error(`no firmware called ${props.firmware}`);

    /* Copy, so dragging a slider here does not edit the catalogue that the
     * simulator and every other block on the page read from. */
    params = fw.params.map((p) => ({ ...p }));
    knobs.value = (props.params ?? [])
      .map((k) => params.find((p) => p.key === k))
      .filter((p): p is FirmwareParam => p !== undefined);

    /* No seed: ensureBellows(seed) REBOOTS, which would kill any other
     * player mid-note. The docs do not need a reproducible stream. */
    const b = await ensureBellows();
    claim(stop);
    voice = buildVoice(b, fw, params);
    running.value = true;
    stepIndex = 0;
    tick();
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function tick(): void {
  if (!running.value || !voice || !bellows.value) return;
  const b = bellows.value;
  const bpm = params.find((p) => p.key === 'bpm')?.value ?? 120;
  const stepSec = voice.stepSec ?? 60 / bpm / voice.stepsPerBeat;
  /* The same 50 ms of lookahead the simulator schedules with. */
  voice.step(stepIndex++, b.now() + 0.05);
  timer = window.setTimeout(tick, stepSec * 1000);
}

function stop(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  running.value = false;
  voice?.dispose();
  voice = null;
  release(stop);
}

function onKnob(p: FirmwareParam, raw: string): void {
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  p.value = v;
  const target = params.find((q) => q.key === p.key);
  if (target) target.value = v;
  voice?.setParam(p.key, v);
}

/* Leaving the page is silence. Both hooks, because DocsView is kept alive
 * by <KeepAlive> on some routes and unmounted on others. */
onDeactivated(stop);
onBeforeUnmount(stop);
</script>

<template>
  <div class="listen" :class="{ live: running }">
    <p v-if="predict" class="predict">
      <span class="tag">before you press play</span>
      {{ predict }}
    </p>

    <div class="row">
      <button class="play" :class="{ lit: running }" :disabled="busy" @click="running ? stop() : start()">
        {{ busy ? 'starting' : running ? 'stop' : 'play' }}
      </button>
      <p v-if="caption" class="caption">{{ caption }}</p>
    </div>

    <p v-if="failed" class="failed">{{ failed }}</p>

    <div v-if="knobs.length" class="knobs">
      <label v-for="k in knobs" :key="k.key" class="knob">
        <span class="name">{{ k.label }}</span>
        <input
          type="range"
          :min="k.min"
          :max="k.max"
          :step="k.step"
          :value="k.value"
          @input="onKnob(k, ($event.target as HTMLInputElement).value)"
        />
        <span class="value">{{ k.value }}<em v-if="k.unit"> {{ k.unit }}</em></span>
        <span class="hint">{{ k.hint }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
/*
 * Everything here is a forge.css token, so night mode comes free and this
 * block cannot drift from the rest of the app. The first draft invented
 * names like --panel and --line, which do not exist, so every fallback fired
 * and the block rendered dark on a light page: readable in neither theme.
 */
.listen {
  margin: 24px 0;
  padding: 14px 16px;
  background: var(--soot);
  border: 2px solid var(--seam);
  border-left: 4px solid var(--phosphor);
  box-shadow: var(--shadow-sm);
}

.listen.live {
  border-left-color: var(--slag);
}

.predict {
  margin: 0 0 12px;
  line-height: 1.55;
}

.tag {
  display: block;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--phosphor);
  margin-bottom: 5px;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.play {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  padding: 9px 22px;
  min-width: 96px;
}

.caption {
  margin: 0;
  color: var(--faded);
  line-height: 1.5;
}

.failed {
  margin: 10px 0 0;
  color: var(--slag);
  font-family: var(--mono);
  font-size: 12px;
}

.knobs {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed var(--seam);
  display: grid;
  gap: 14px;
}

.knob {
  display: grid;
  grid-template-columns: 7rem 1fr 5.5rem;
  grid-template-areas: 'name slider value' 'hint hint hint';
  align-items: center;
  gap: 3px 14px;
}

.name {
  grid-area: name;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.knob input {
  grid-area: slider;
  width: 100%;
  accent-color: var(--phosphor);
}

.value {
  grid-area: value;
  font-family: var(--mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--phosphor);
}

.value em {
  font-style: normal;
  color: var(--faded);
}

.hint {
  grid-area: hint;
  color: var(--faded);
  font-size: 13px;
  line-height: 1.4;
}

@media (max-width: 620px) {
  .knob {
    grid-template-columns: 1fr 4.5rem;
    grid-template-areas: 'name value' 'slider slider' 'hint hint';
  }
}
</style>

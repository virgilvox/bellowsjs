<!--
  The board, drawn to scale enough to wire from.

  Not a photograph and not a full pinout: it shows the pins the current
  firmware and output path actually use, so the picture answers one question
  (where does the wire go) rather than reproducing PJRC's pin card badly.

  Colours come from CSS custom properties rather than literals, so the
  NIGHT/DAY toggle works without this component knowing about themes.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { outputPins, type Board } from '../../lib/sim/board';
import type { FirmwareIndicator, FirmwareInput } from '../../lib/sim/firmware';
import type { OutputSpec } from '../../lib/sim/output-stage';

const props = defineProps<{
  board: Board;
  inputs: FirmwareInput[];
  indicators: FirmwareIndicator[];
  output: OutputSpec;
  active: boolean;
}>();

const PITCH = 15;
const TOP = 26;
const WIDTH = 168;

const height = computed(() => TOP * 2 + props.board.rows * PITCH);

const audioPins = computed(() => new Set(outputPins(props.board, props.output.id)));
const inputPins = computed(
  () => new Set(props.inputs.map((i) => i.pin).filter((p): p is number => p !== null)),
);
const indicatorPins = computed(() => new Set(props.indicators.map((i) => i.pin)));

interface Dot {
  n: number;
  x: number;
  y: number;
  anchor: 'start' | 'end';
  role: 'audio' | 'input' | 'led' | 'plain';
}

/**
 * Teensy numbering runs 0 up the left side and continues down the right,
 * which is what makes a drawn pin findable on the real board.
 */
const dots = computed<Dot[]>(() => {
  const out: Dot[] = [];
  const rows = props.board.rows;
  for (let r = 0; r < rows; r++) {
    out.push({ ...place(r, 'left'), n: r, ...role(r) });
    const rn = rows * 2 - 1 - r;
    out.push({ ...place(r, 'right'), n: rn, ...role(rn) });
  }
  return out;

  function place(row: number, side: 'left' | 'right') {
    return {
      x: side === 'left' ? 14 : WIDTH - 14,
      y: TOP + row * PITCH + PITCH / 2,
      anchor: (side === 'left' ? 'start' : 'end') as 'start' | 'end',
    };
  }
  function role(n: number): { role: Dot['role'] } {
    if (audioPins.value.has(n)) return { role: 'audio' };
    if (inputPins.value.has(n)) return { role: 'input' };
    if (n === props.board.led || indicatorPins.value.has(n)) return { role: 'led' };
    return { role: 'plain' };
  }
});

const legend = computed(() => {
  const items: Array<{ role: string; text: string }> = [];
  const pins = [...audioPins.value];
  if (pins.length) items.push({ role: 'audio', text: `audio out // pin ${pins.join(', ')}` });
  for (const i of props.inputs) {
    if (i.pin !== null) items.push({ role: 'input', text: `${i.label.toLowerCase()} // pin ${i.pin}` });
    else items.push({ role: 'input', text: `${i.label.toLowerCase()} // usb` });
  }
  items.push({ role: 'led', text: `led // pin ${props.board.led}` });
  return items;
});
</script>

<template>
  <div class="diagram">
    <svg :viewBox="`0 0 ${WIDTH} ${height}`" :style="{ maxHeight: height + 'px' }" role="img"
         :aria-label="`${board.label} pin diagram`">
      <rect
        x="6" y="6" :width="WIDTH - 12" :height="height - 12"
        class="pcb" rx="0"
      />
      <rect x="52" :y="14" width="64" height="26" class="usb" />
      <text :x="WIDTH / 2" :y="height - 14" class="brand" text-anchor="middle">
        {{ board.label }}
      </text>

      <!-- the onboard LED, which blinks when a firmware is running -->
      <circle :cx="WIDTH - 30" :cy="52" r="4" class="led" :class="{ on: active }" />

      <g v-for="d in dots" :key="d.n">
        <rect
          :x="d.x - 5" :y="d.y - 5" width="10" height="10"
          class="pad" :class="d.role"
        />
        <text
          :x="d.anchor === 'start' ? d.x + 10 : d.x - 10"
          :y="d.y + 3.5"
          :text-anchor="d.anchor"
          class="pin-label"
          :class="d.role"
        >{{ d.n }}</text>
      </g>
    </svg>

    <div class="legend">
      <div v-for="l in legend" :key="l.text" class="legend-row">
        <span class="swatch" :class="l.role"></span>{{ l.text }}
      </div>
      <div class="specs">
        {{ board.core }}{{ board.fpu ? ' with FPU' : ', no FPU' }} // {{ board.clockMhz }} MHz //
        {{ board.flashKb >= 1024 ? Math.round(board.flashKb / 1024) + ' MB' : board.flashKb + ' KB' }} flash //
        {{ board.ramKb }} KB RAM
      </div>
      <p class="blurb">{{ board.blurb }}</p>
    </div>
  </div>
</template>

<style scoped>
.diagram {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 16px;
  align-items: start;
}
svg {
  width: 168px;
  height: auto;
}
.pcb {
  fill: var(--char);
  stroke: var(--seam);
  stroke-width: 2;
}
.usb {
  fill: var(--iron);
  stroke: var(--seam);
  stroke-width: 1;
}
.brand {
  font-family: var(--disp);
  font-size: 7px;
  letter-spacing: 0.14em;
  fill: var(--faded);
}
.pad {
  fill: var(--iron);
  stroke: var(--seam);
  stroke-width: 1;
}
.pad.audio {
  fill: var(--phosphor);
  stroke: var(--phosphor);
}
.pad.input {
  fill: var(--slag);
  stroke: var(--slag);
}
.pad.led {
  fill: var(--phosphor-dim);
  stroke: var(--phosphor);
}
.pin-label {
  font-family: var(--mono);
  font-size: 6px;
  fill: var(--faded);
}
.pin-label.audio,
.pin-label.input {
  fill: var(--phosphor-hot);
}
.led {
  fill: var(--iron);
  stroke: var(--seam);
}
.led.on {
  fill: var(--phosphor);
  stroke: var(--phosphor);
}
.legend {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--faded);
}
.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.swatch {
  width: 9px;
  height: 9px;
  border: 1px solid var(--seam);
  display: inline-block;
}
.swatch.audio {
  background: var(--phosphor);
}
.swatch.input {
  background: var(--slag);
}
.swatch.led {
  background: var(--phosphor-dim);
}
.specs {
  margin-top: 10px;
  color: var(--tick);
  letter-spacing: 0.08em;
}
.blurb {
  margin-top: 8px;
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--tick);
  line-height: 1.6;
  max-width: 52ch;
}
@media (max-width: 700px) {
  .diagram {
    grid-template-columns: 1fr;
  }
}
</style>

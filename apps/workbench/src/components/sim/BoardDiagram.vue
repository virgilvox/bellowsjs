<!--
  The board, drawn to scale enough to wire from.

  Not a photograph and not a full pinout: it shows the pins the current
  firmware and output path actually use, so the picture answers one question
  (where does the wire go) rather than reproducing PJRC's pin card badly.

  DRAWN LANDSCAPE, WHICH IS THE SHAPE THE PART IS. An earlier version drew
  it portrait, 168 px wide and up to 412 tall, so a 24 row board stood in a
  narrow column beside a metre of empty paper. This is that drawing rotated
  a quarter turn anticlockwise, which is why the numbering reads the way it
  does: the left column of pins, 0 downward, becomes the bottom edge left to
  right, and the right column becomes the top edge. A Teensy 4.1 is now 404
  units wide and 116 tall and fills the room it is given.

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

/** Pin pitch along the long edge, and the room the USB end takes. */
const PITCH = 15;
const MARGIN = 22;
const HEIGHT = 116;
const TOP_Y = 20;
const BOTTOM_Y = 96;

const width = computed(() => MARGIN * 2 + props.board.rows * PITCH);

const audioPins = computed(() => new Set(outputPins(props.board, props.output.id)));
const inputPins = computed(
  () => new Set(props.inputs.map((i) => i.pin).filter((p): p is number => p !== null)),
);
const indicatorPins = computed(() => new Set(props.indicators.map((i) => i.pin)));

interface Dot {
  n: number;
  x: number;
  y: number;
  labelY: number;
  role: 'audio' | 'input' | 'led' | 'plain';
}

/**
 * Teensy numbering runs 0 up one side and continues back down the other,
 * which is what makes a drawn pin findable on the real board. Held with the
 * USB at the left, that is 0 rising along the bottom edge and the highest
 * number falling along the top.
 */
const dots = computed<Dot[]>(() => {
  const out: Dot[] = [];
  const rows = props.board.rows;
  for (let i = 0; i < rows; i++) {
    const x = MARGIN + i * PITCH + PITCH / 2;
    /* Labels sit inside the board: there is height to spare and no room
     * outside it once the diagram is this wide. */
    out.push({ n: i, x, y: BOTTOM_Y, labelY: BOTTOM_Y - 10, ...role(i) });
    const top = rows * 2 - 1 - i;
    out.push({ n: top, x, y: TOP_Y, labelY: TOP_Y + 14, ...role(top) });
  }
  return out;

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
    <svg
      class="board"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="`${board.label} pin diagram`"
    >
      <rect x="4" y="6" :width="width - 8" :height="HEIGHT - 12" class="pcb" />

      <!-- the USB end, which is how you know which way round it is -->
      <rect x="0" y="38" width="20" height="40" class="usb" />

      <!-- the onboard LED, which lights while a firmware is running -->
      <circle cx="34" cy="58" r="4" class="led" :class="{ on: active }" />

      <text :x="width / 2" y="61" class="brand" text-anchor="middle">{{ board.label }}</text>

      <g v-for="d in dots" :key="d.n">
        <rect :x="d.x - 5" :y="d.y - 5" width="10" height="10" class="pad" :class="d.role" />
        <text :x="d.x" :y="d.labelY" text-anchor="middle" class="pin-label" :class="d.role">
          {{ d.n }}
        </text>
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
/*
 * The board takes the width and the legend takes a fixed column beside it,
 * because the legend is short lines and would look ragged if it stretched.
 * The board is capped so a 14 row part does not blow up to twice life size
 * on a wide screen.
 */
.diagram {
  display: grid;
  /* The board column is capped rather than 1fr, so the legend sits next to
   * the drawing instead of at the far edge with a hole between them. */
  grid-template-columns: minmax(0, 720px) minmax(200px, 1fr);
  gap: 20px;
  align-items: start;
}
.board {
  width: 100%;
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
  font-size: 9px;
  letter-spacing: 0.2em;
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
  font-size: 6.5px;
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
}
@media (max-width: 760px) {
  .diagram {
    grid-template-columns: 1fr;
  }
}
</style>

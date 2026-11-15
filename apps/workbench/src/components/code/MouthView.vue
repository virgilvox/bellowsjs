<script setup lang="ts">
/*
 * A midsagittal view of the voice's tract: the shape bellows-voice's own geometry gives for the
 * current posture (TractModel.shape(), centimetres, glottis to lips). Tissue is filled above the
 * upper wall and below the lower one, so the air between them reads as the open tract; the nasal
 * port lights when the velum is down and the lips mark how far they are open.
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TractShape } from 'bellows-voice/view';

const props = defineProps<{
  shape: TractShape | null;
  phoneme: string;
  /** Fixed drawing bounds in cm, so the picture does not rescale as the mouth moves. */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let ro: ResizeObserver | null = null;

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function draw(): void {
  const c = canvas.value;
  const s = props.shape;
  const bb = props.bounds;
  if (!c || !s || !bb) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  /* fixed anatomical colours, so the picture reads the same in the day and night themes */
  const flesh = '#b98a6a';
  const fleshDark = '#8e6249';
  const air = '#17120e';
  const wall = '#f0b04a';
  const faded = '#d9c6b2';
  const hot = '#ffd27a';
  g.fillStyle = flesh;
  g.fillRect(0, 0, w, h);

  // fit the fixed bounds, y up
  const pad = 14;
  const scale = Math.min((w - 2 * pad) / (bb.x1 - bb.x0), (h - 2 * pad) / (bb.y1 - bb.y0));
  const ox = pad + ((w - 2 * pad) - (bb.x1 - bb.x0) * scale) / 2;
  const oy = pad + ((h - 2 * pad) - (bb.y1 - bb.y0) * scale) / 2;
  const X = (x: number) => ox + (x - bb.x0) * scale;
  const Y = (y: number) => h - (oy + (y - bb.y0) * scale);
  const n = s.lower.length / 2;
  if (n < 2) return;

  // outside the face, past the lips
  const lipX = Math.max(X(s.upper[2 * n - 2]), X(s.lower[2 * n - 2]));
  g.fillStyle = air;
  g.fillRect(lipX, 0, w - lipX, h);
  g.fillStyle = fleshDark;
  g.fillRect(lipX - 2, 0, 2, h);

  // the air column: the upper wall out, the lower wall back
  g.fillStyle = air;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const px = X(s.upper[2 * i]);
    const py = Y(s.upper[2 * i + 1]);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.lineTo(X(s.upper[2 * n - 2]) + 3, Y(s.upper[2 * n - 1]));
  g.lineTo(X(s.lower[2 * n - 2]) + 3, Y(s.lower[2 * n - 1]));
  for (let i = n - 1; i >= 0; i--) g.lineTo(X(s.lower[2 * i]), Y(s.lower[2 * i + 1]));
  g.closePath();
  g.fill();
  // the windpipe below the glottis
  g.fillRect(Math.min(X(s.lower[0]), X(s.upper[0])), Y(Math.min(s.lower[1], s.upper[1])), Math.abs(X(s.upper[0]) - X(s.lower[0])), h);

  // narrow places glow: a line across the airway at each point, brighter where the area is small
  for (let i = 1; i < n; i++) {
    const a = s.area[i];
    const k = Math.max(0, Math.min(1, 1 - Math.log10(1 + a) / Math.log10(1 + 6)));
    g.strokeStyle = hot;
    g.globalAlpha = 0.04 + 0.6 * k * k * k;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(s.lower[2 * i]), Y(s.lower[2 * i + 1]));
    g.lineTo(X(s.upper[2 * i]), Y(s.upper[2 * i + 1]));
    g.stroke();
  }
  g.globalAlpha = 1;

  // the walls
  g.strokeStyle = wall;
  g.lineWidth = 2;
  for (const line of [s.lower, s.upper]) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const px = X(line[2 * i]);
      const py = Y(line[2 * i + 1]);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }

  // the nasal port, at the turn from pharynx to mouth
  if (s.split > 0 && s.split < n) {
    const i = s.split;
    const ux = X(s.upper[2 * i]);
    const uy = Y(s.upper[2 * i + 1]);
    const open = Math.max(0, Math.min(1, s.velumPort / 0.8));
    g.strokeStyle = open > 0.02 ? hot : faded;
    g.globalAlpha = 0.3 + 0.7 * open;
    g.lineWidth = 2 + 8 * open;
    g.beginPath();
    g.moveTo(ux, uy);
    g.lineTo(ux - 4, uy - 36);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = open > 0.02 ? hot : faded;
    g.font = '10px ' + css('--mono', 'monospace');
    g.fillText(open > 0.02 ? 'NOSE OPEN' : 'nose', ux - 24, uy - 40);
  }

  // the tongue tip
  g.fillStyle = hot;
  g.beginPath();
  g.arc(X(s.tipX), Y(s.tipY), 3, 0, 2 * Math.PI);
  g.fill();

  // labels
  g.fillStyle = faded;
  g.font = '10px ' + css('--mono', 'monospace');
  g.fillText('glottis', X(s.upper[0]) + 6, Y(Math.min(s.lower[1], s.upper[1])) + 4);
  g.fillText('lips ' + s.lipArea.toFixed(2) + ' cm²', lipX + 8, Y(s.lower[2 * n - 1]) + 4);
  g.fillStyle = hot;
  g.font = 'bold 34px ' + css('--disp', 'sans-serif');
  g.fillText(props.phoneme === '_' ? '' : props.phoneme, 14, 40);
}

watch(() => [props.shape, props.phoneme, props.bounds], draw);

onMounted(() => {
  draw();
  if (canvas.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(draw);
    ro.observe(canvas.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <canvas ref="canvas" class="mouth" aria-label="the voice's vocal tract, seen from the side"></canvas>
</template>

<style scoped>
.mouth {
  display: block;
  width: 100%;
  height: 380px;
  border: 1px solid var(--seam);
  background: var(--char);
}
</style>

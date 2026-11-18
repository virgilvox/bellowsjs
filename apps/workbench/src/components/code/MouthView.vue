<script setup lang="ts">
/*
 * The voice's head in profile, drawn from bellows-voice's own geometry (TractModel.shape() and its
 * drawing, headProfile() around it: both CHIMERA's anatomy, ported), as a vector display on a dark
 * screen. Deep structures are dim (skull, spine, nasal cavity and turbinates, hyoid, larynx, trachea);
 * the parts that move are each in their own colour: the tongue (a filled muscle), the jaw bone, the
 * lips, the soft palate, the teeth. Over them:
 *
 *   - the air: particles from the glottis to the lips at a speed that rises where the tract narrows
 *     (continuity, v = U / A), crowding behind a closure, out of the nose with the velum down, and
 *     backwards when the breath is drawn in (`flow` below 0);
 *   - the narrowest place, marked as a closure or with its area: where the sound is made;
 *   - labels with leader lines, and in edit mode six handles to drag (tongue, tip, jaw, lips, soft
 *     palate, voice box), which the parent turns into voice settings.
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MouthHandle, Pt, TractShape } from 'bellows-voice/view';
import { drawMouth, type ViewTransform } from './voice-lab/mouth-render';
import { airState } from './voice-lab/mouth-air';

const props = withDefaults(
  defineProps<{
    /** The shape now: a getter, read once a frame (a new object is a new frame to draw). */
    shape: () => TractShape | null;
    /** What to print large: the IPA or the beat being made. */
    phoneme: string;
    /** The breath: 0 still, 1 out, below 0 drawn in. */
    flow?: number;
    labels?: boolean;
    /** 'mouth' frames the tract and face, 'head' the whole head. */
    zoom?: 'mouth' | 'head';
    /** Handle positions, body cm: shown and draggable when given. */
    handles?: Record<MouthHandle, [number, number]> | null;
    /** A line under the big symbol (the shape's resonances, say). */
    caption?: string;
  }>(),
  { flow: 0, labels: true, zoom: 'mouth', handles: null, caption: '' },
);
const emit = defineEmits<{ drag: [handle: MouthHandle, x: number, y: number] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let ro: ResizeObserver | null = null;
let raf = 0;

const air = airState();

/* the view transform, kept for the pointer */
let tf: ViewTransform = { s: 1, ox: 0, oy: 0, h: 0 };
/* Drawn only when something changed: the shape, a prop, the size, a drag; every frame while air flows. */
let drawn: TractShape | null = null;
let stale = true;
function draw(): void {
  const s = props.shape();
  if (!canvas.value || !s) return;
  if (!stale && s === drawn && props.flow === 0 && !dragging) return;
  stale = false;
  drawn = s;
  tf =
    drawMouth(
      canvas.value,
      { shape: s, phoneme: props.phoneme, flow: props.flow, labels: props.labels, zoom: props.zoom, handles: props.handles },
      air,
      dragging,
    ) ?? tf;
}
const restale = () => {
  stale = true;
};
const toBody = (px: number, py: number): Pt => [(px - tf.ox) / tf.s, (tf.h - py - tf.oy) / tf.s];

/* dragging a handle */
let dragging: MouthHandle | null = null;
function pointer(e: PointerEvent): [number, number] {
  const r = canvas.value!.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function onDown(e: PointerEvent): void {
  const H = props.handles;
  if (!H) return;
  const [px, py] = pointer(e);
  let best: MouthHandle | null = null;
  let bd = 18;
  for (const key of Object.keys(H) as MouthHandle[]) {
    const [hx, hy] = H[key];
    const dd = Math.hypot(tf.ox + hx * tf.s - px, tf.h - (tf.oy + hy * tf.s) - py);
    if (dd < bd) {
      bd = dd;
      best = key;
    }
  }
  if (!best) return;
  dragging = best;
  canvas.value!.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onMove(e: PointerEvent): void {
  if (!dragging) return;
  const [px, py] = pointer(e);
  const [bx, by] = toBody(px, py);
  emit('drag', dragging, bx, by);
}
function onUp(): void {
  if (!dragging) return;
  dragging = null;
  stale = true;
}

function loop(): void {
  draw();
  raf = requestAnimationFrame(loop);
}
watch(() => [props.zoom, props.labels, props.handles, props.phoneme], restale);
onMounted(() => {
  raf = requestAnimationFrame(loop);
  if (canvas.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(restale);
    ro.observe(canvas.value);
  }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
});
</script>

<template>
  <div class="mouth-view">
    <canvas
      ref="canvas"
      class="mouth"
      :class="{ editing: !!handles }"
      role="img"
      :aria-label="`The voice's head in profile, making ${phoneme === '_' || !phoneme ? 'no sound' : phoneme}: tongue, jaw, lips, soft palate and voice box, with the air moving through`"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @lostpointercapture="onUp"
    ></canvas>
    <p v-if="caption" class="caption">{{ caption }}</p>
  </div>
</template>

<style scoped>
.caption {
  margin: 4px 0 0;
  font-family: var(--mono, monospace);
  font-size: 12px;
  color: var(--tick);
  overflow-wrap: anywhere;
}
.mouth {
  display: block;
  width: 100%;
  height: 380px;
  border: 1px solid var(--seam);
  background: #0f0c0a;
  touch-action: none;
}
.mouth.editing {
  cursor: grab;
}
@media (max-width: 560px) {
  .mouth {
    height: 330px;
  }
}
</style>

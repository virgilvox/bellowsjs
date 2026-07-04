<script setup lang="ts">
/*
 * Div-based piano. The full range is C2..C7; the visible window is 2, 3,
 * or 4 octaves depending on width and follows the octave shift, so the
 * keys you see are the notes you get: presses send absolute midi numbers.
 * Vertical click position sets velocity (top soft, bottom hard). Pointer
 * events give press, glide (drag across keys with the button or a finger
 * held), and independent multi-touch.
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { activeNotes, instState, noteOff, noteOn } from '../../lib/instrument-store';

const RANGE_LO = 36; // C2
const RANGE_HI = 96; // C7
const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

const rootEl = ref<HTMLElement | null>(null);
const visibleOctaves = ref(4);
let observer: ResizeObserver | null = null;

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 1024;
    visibleOctaves.value = w < 640 ? 2 : w < 1024 ? 3 : 4;
  });
  if (rootEl.value) observer.observe(rootEl.value);
  window.addEventListener('pointerup', onGlobalUp);
  window.addEventListener('pointercancel', onGlobalUp);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('pointerup', onGlobalUp);
  window.removeEventListener('pointercancel', onGlobalUp);
  releaseAll();
});

const startMidi = computed(() => {
  const n = visibleOctaves.value;
  const centered = 60 + instState.octave * 12 - Math.floor(n / 2) * 12;
  return Math.max(RANGE_LO, Math.min(centered, RANGE_HI - n * 12));
});

interface WhiteKey {
  midi: number;
  label: string;
}
interface BlackKey {
  midi: number;
  left: number;
  width: number;
}

const layout = computed<{ whites: WhiteKey[]; blacks: BlackKey[] }>(() => {
  const start = startMidi.value;
  const end = start + visibleOctaves.value * 12;
  const whites: WhiteKey[] = [];
  const pending: Array<{ midi: number; whitesBefore: number }> = [];
  for (let m = start; m <= end; m++) {
    const pc = m % 12;
    if (BLACK_PCS.has(pc)) pending.push({ midi: m, whitesBefore: whites.length });
    else whites.push({ midi: m, label: pc === 0 ? 'C' + (m / 12 - 1) : '' });
  }
  const whiteW = 100 / whites.length;
  const blackW = whiteW * 0.62;
  const blacks: BlackKey[] = pending.map((p) => ({
    midi: p.midi,
    left: p.whitesBefore * whiteW - blackW / 2,
    width: blackW,
  }));
  return { whites, blacks };
});

/* pointerId -> midi currently held by that pointer */
const held = new Map<number, number>();

function velocityFrom(e: PointerEvent): number {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const t = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 1;
  return 0.2 + 0.8 * Math.max(0, Math.min(1, t));
}

function onDown(e: PointerEvent, midi: number): void {
  e.preventDefault();
  // drop the implicit capture so pointerenter fires on neighbors (glide)
  const el = e.currentTarget as Element & { releasePointerCapture?: (id: number) => void };
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture?.(e.pointerId);
  held.set(e.pointerId, midi);
  noteOn(midi, velocityFrom(e), 'ptr');
}

function onEnter(e: PointerEvent, midi: number): void {
  const engaged = held.has(e.pointerId) || (e.buttons & 1) !== 0 || e.pointerType === 'touch';
  if (!engaged) return;
  const prev = held.get(e.pointerId);
  if (prev === midi) return;
  if (prev !== undefined) noteOff(prev, 'ptr');
  held.set(e.pointerId, midi);
  noteOn(midi, velocityFrom(e), 'ptr');
}

function onGlobalUp(e: PointerEvent): void {
  const prev = held.get(e.pointerId);
  if (prev !== undefined) {
    noteOff(prev, 'ptr');
    held.delete(e.pointerId);
  }
}

function onBoardLeave(e: PointerEvent): void {
  // dragging off the board releases; re-entering a key re-engages
  onGlobalUp(e);
}

function releaseAll(): void {
  for (const [, midi] of held) noteOff(midi, 'ptr');
  held.clear();
}
</script>

<template>
  <div ref="rootEl" class="piano-root">
    <div class="board" @pointerleave="onBoardLeave" @contextmenu.prevent>
      <div class="whites">
        <div
          v-for="k in layout.whites"
          :key="k.midi"
          class="key white"
          :class="{ pressed: activeNotes.has(k.midi) }"
          @pointerdown="onDown($event, k.midi)"
          @pointerenter="onEnter($event, k.midi)"
        >
          <span v-if="k.label" class="clabel">{{ k.label }}</span>
        </div>
      </div>
      <div
        v-for="k in layout.blacks"
        :key="k.midi"
        class="key black"
        :class="{ pressed: activeNotes.has(k.midi) }"
        :style="{ left: k.left + '%', width: k.width + '%' }"
        @pointerdown="onDown($event, k.midi)"
        @pointerenter="onEnter($event, k.midi)"
      ></div>
    </div>
    <p class="hint">
      click height sets velocity: top of a key is soft, bottom is hard. drag across keys to glide.
      drum engines fire on every key, pitched by the key.
    </p>
  </div>
</template>

<style scoped>
.piano-root {
  /* black keys: the darkest ink token in each theme (see the global
     override below for night mode) so they read as black on both looks */
  --key-black: var(--bone);
  --key-black-lit: var(--phosphor);
}

.board {
  position: relative;
  height: clamp(130px, 24vw, 190px);
  border: 2px solid var(--seam);
  box-shadow: var(--shadow);
  background: var(--iron);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.whites {
  display: flex;
  height: 100%;
}

.key {
  cursor: pointer;
}

.key.white {
  flex: 1 1 0;
  background: var(--soot);
  border-right: 1px solid var(--seam);
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.key.white:last-child {
  border-right: none;
}

.key.white.pressed {
  background: var(--phosphor);
}

.key.white.pressed .clabel {
  color: var(--lit-text);
}

.clabel {
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--tick);
  padding-bottom: 4px;
  pointer-events: none;
}

.key.black {
  position: absolute;
  top: 0;
  height: 60%;
  background: var(--key-black);
  border: 1px solid var(--seam);
  border-top: none;
  box-shadow: 2px 3px 0 rgba(0, 0, 0, 0.35);
  z-index: 2;
}

.key.black.pressed {
  background: var(--key-black-lit);
  box-shadow: 0 0 8px var(--phosphor-glow);
}

.hint {
  margin-top: 6px;
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.08em;
}
</style>

<style>
/* night forge: bone is light there, so black keys drop to the deepest
   background token instead, edged by the seam to stand off the soot whites */
:root[data-theme='dark'] .piano-root {
  --key-black: var(--forge);
}
</style>

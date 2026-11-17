/*
 * The mouth a page draws: bellows-voice's TractModel following what the voice is doing, once an
 * animation frame. While a line plays it follows the line's spans by the context's clock (latency
 * taken off); while a sound is held it shows that sound; on the Shape tab, with nothing playing, it
 * holds that tab's vowel with the shape's settings and offers handles to drag, and its caption gives
 * the shape's resonances and the hVd word they sound most like. Also the air's direction for the view.
 */

import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { VOCAL_BEATS, nearestVowel } from 'bellows-voice';
import { TractModel, mouthHandles, settingsForHandle, type MouthHandle, type TractShape } from 'bellows-voice/view';

export interface MouthInputs {
  body: () => number;
  /** The voice settings and anatomy, by param. */
  settings: () => Record<string, number>;
  /** The Shape tab is open. */
  shaping: () => boolean;
  /** The vowel the Shape tab holds. */
  shapeIpa: () => string;
  /** The audio context, once there is one. */
  context: () => AudioContext | null;
  spans: Ref<readonly { ipa: string; start: number; end: number }[]>;
  playing: Ref<boolean>;
  /** The sound held now, or null. */
  held: () => string | null;
  /** Which span sounds now, -1 for none (written here). */
  nowIndex: Ref<number>;
}

const BEAT_NAMES = new Map(VOCAL_BEATS.map((b) => [b.id, b.name]));

/** Which way the air moves for a sound: out, in (an inward snare, a breath in), half for a hum, still in a rest. */
function airFor(ipa: string): number {
  if (ipa === '_' || ipa === 'beat:.') return 0;
  if (ipa.startsWith('beat:^K') || ipa.startsWith('beat:in')) return -1;
  return ipa.startsWith('beat:m') ? 0.5 : 1;
}

export function useMouth(i: MouthInputs) {
  const tract = new TractModel(i.body());
  const shape = shallowRef<TractShape | null>(null);
  const phoneme = ref('_');
  const flow = ref(0);
  const handles = shallowRef<Record<MouthHandle, [number, number]> | null>(null);
  const caption = ref('');

  /** The Shape tab's handles and caption, when it shows its vowel. */
  function readShape(): void {
    if (!i.shaping() || i.playing.value || i.held()) {
      handles.value = null;
      caption.value = '';
      return;
    }
    tract.target(i.shapeIpa());
    tract.settle();
    handles.value = mouthHandles(tract);
    const [f1, f2, f3] = tract.formants();
    const near = nearestVowel(f1, f2, i.body());
    caption.value = `resonances ${Math.round(f1)} · ${Math.round(f2)} · ${Math.round(f3)} Hz: most like "${near.word}"`;
  }

  /** The settings that put a dragged handle under the pointer (body cm). */
  function drag(h: MouthHandle, x: number, y: number): Record<string, number> {
    const next = settingsForHandle(tract, h, x, y, i.shapeIpa());
    const keep: Record<string, number> = {};
    for (const [k, v] of Object.entries(next)) if (typeof v === 'number') keep[k] = v;
    return keep;
  }

  watch(
    () => [i.settings(), i.shapeIpa(), i.shaping(), i.body()],
    () => {
      tract.setBody(i.body());
      tract.setSettings(i.settings());
      readShape();
    },
    { deep: true },
  );

  let raf = 0;
  let last = 0;
  function frame(now: number): void {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const held = i.held();
    let want = held ?? '_';
    const ctx = i.context();
    if (!held && ctx && i.playing.value) {
      const t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      const spans = i.spans.value;
      const k = spans.findIndex((x) => t >= x.start && t < x.end);
      i.nowIndex.value = k;
      if (k >= 0) {
        want = spans[k].ipa;
        flow.value = airFor(want);
      } else if (spans.length && t > spans[spans.length - 1].end) {
        i.playing.value = false;
        i.nowIndex.value = -1;
        readShape();
      }
    }
    if (held) flow.value = 1;
    else if (!i.playing.value) flow.value = 0;
    if (!held && !i.playing.value && i.shaping()) want = i.shapeIpa();
    if (want !== tract.current) tract.target(want);
    tract.step(dt);
    const beat = want.startsWith('beat:') ? want.slice(5).replace(/>$/, '') : '';
    phoneme.value = beat ? (beat === '.' ? '' : beat === 'in' ? 'breath in' : `${beat} ${BEAT_NAMES.get(beat) ?? ''}`) : want;
    shape.value = tract.shape();
    raf = requestAnimationFrame(frame);
  }
  onMounted(() => {
    tract.settle();
    raf = requestAnimationFrame(frame);
  });
  onBeforeUnmount(() => cancelAnimationFrame(raf));

  return { shape, phoneme, flow, handles, caption, readShape, drag };
}

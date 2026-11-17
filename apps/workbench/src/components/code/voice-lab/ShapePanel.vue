<script setup lang="ts">
/*
 * Shaping the mouth: ready-made shapes, the shape in a sentence, a vowel to hold and hear, and every
 * voice setting as a slider whose ends are named in words, with the one last touched explained (what
 * it does, and its acoustics). The mouth to drag comes in through the `stage` slot, beside the sliders
 * on a wide screen and above them on a narrow one.
 */

import { computed, ref } from 'vue';
import { SHAPE_PRESETS, VOICE_SETTINGS, describeShape } from 'bellows-voice';

const shape = defineModel<Record<string, number>>('shape', { required: true });
const ipa = defineModel<string>('ipa', { required: true });
const emit = defineEmits<{ hear: []; release: [] }>();

const VOWELS = ['ɑ', 'i', 'u', 'ɛ', 'æ', 'o', 'ə'];
const GROUPS: Array<[string, string[]]> = [
  ['Mouth', ['jawSet', 'lipRound', 'lipOpen', 'tongueFront', 'tongueHigh']],
  ['Throat', ['larynxSet', 'throat', 'twang', 'nasal', 'cheeks']],
  ['Anatomy', ['size', 'pharynx', 'piriform']],
];
const byParam = new Map(VOICE_SETTINGS.map((x) => [x.param, x]));
const value = (param: string) => shape.value[param] ?? byParam.get(param)?.neutral ?? 0;
const set = (param: string, v: number) => (shape.value = { ...shape.value, [param]: v });
const use = (id: string) => {
  const p = SHAPE_PRESETS.find((x) => x.id === id);
  if (p) shape.value = { ...p.values };
};
const words = computed(() => describeShape(shape.value));
const focus = ref('jawSet');
</script>

<template>
  <div class="shape-wrap">
    <div class="shape">
      <p class="shape-lead">
        Drag the tongue, jaw, lips, soft palate or voice box in the picture, or use the sliders. The voice plays the shape
        you make, and it carries into Speak and Sing.
      </p>
      <div class="examples">
        <span>Shapes</span>
        <button v-for="p in SHAPE_PRESETS" :key="p.id" class="link" :title="p.plain" @click="use(p.id)">{{ p.name }}</button>
      </div>
      <p class="shape-now">{{ words }}</p>
      <div class="vowels" role="group" aria-label="the vowel to hold">
        <span>Hold</span>
        <button v-for="v in VOWELS" :key="v" class="chip" :class="{ on: ipa === v }" @click="ipa = v">
          <b class="ipa-font">{{ v }}</b>
        </button>
        <button class="chip hear" @pointerdown="emit('hear')" @pointerup="emit('release')" @pointerleave="emit('release')">Press to hear</button>
      </div>
      <div v-for="[title, params] in GROUPS" :key="title" class="set-group">
        <h4>{{ title }}</h4>
        <label
          v-for="param in params"
          :key="param"
          class="set slider"
          :title="byParam.get(param)?.acoustics"
          @pointerenter="focus = param"
          @focusin="focus = param"
        >
          <span class="set-label">{{ byParam.get(param)?.name }}</span>
          <span class="ends">
            <em>{{ byParam.get(param)?.low }}</em>
            <input
              type="range"
              :min="byParam.get(param)?.min"
              :max="byParam.get(param)?.max"
              :step="param === 'piriform' ? 1 : 0.01"
              :value="value(param)"
              @input="set(param, ($event.target as HTMLInputElement).valueAsNumber)"
            />
            <em>{{ byParam.get(param)?.high }}</em>
          </span>
        </label>
      </div>
      <p class="explain-setting" aria-live="polite">
        <b>{{ byParam.get(focus)?.name }}:</b> {{ byParam.get(focus)?.plain }}
        <span>{{ byParam.get(focus)?.acoustics }}</span>
      </p>
      <button class="link reset" @click="shape = {}">Back to a neutral mouth</button>
    </div>
    <div class="shape-stage"><slot name="stage" /></div>
  </div>
</template>

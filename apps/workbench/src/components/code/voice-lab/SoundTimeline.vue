<script setup lang="ts">
/*
 * The sounds of a line as they play: one segment a sound, as wide as it lasts, coloured by kind (vowel,
 * consonant, beat, breath), the one sounding lit. Hovering a segment says how the mouth makes it.
 */

import { computed } from 'vue';
import { describeSound } from 'bellows-voice';

export interface TimedSound {
  ipa: string;
  start: number;
  end: number;
  kind: string;
}

const props = defineProps<{ spans: readonly TimedSound[]; nowIndex: number }>();

/** A span's sound as people read it: IPA, or a beat's symbol. */
function shown(ipa: string): string {
  if (!ipa.startsWith('beat:')) return ipa;
  const id = ipa.slice(5).replace(/>$/, '');
  return id === '.' ? '' : id === 'in' ? 'breath' : id;
}

const segments = computed(() =>
  props.spans.map((sp) => ({
    text: shown(sp.ipa),
    words: describeSound(sp.ipa) ?? '',
    grow: Math.max(0.001, sp.end - sp.start),
    kind: sp.ipa.startsWith('beat:in') ? 'breath' : sp.ipa.startsWith('beat:') ? (sp.ipa === 'beat:.' ? 'rest' : 'beat') : sp.kind,
  })),
);
</script>

<template>
  <div v-if="segments.length" class="timeline-wrap">
    <span class="ipa-label">As it plays, each sound as long as it lasts</span>
    <div class="timeline" aria-hidden="true">
      <span v-for="(sp, i) in segments" :key="i" class="seg" :class="[sp.kind, { on: i === nowIndex }]" :style="{ flexGrow: sp.grow }" :title="sp.words">{{ sp.text }}</span>
    </div>
    <div class="legend"><i class="nucleus"></i>vowel <i class="onset"></i>consonant <i class="beat"></i>beat <i class="breath"></i>breath</div>
  </div>
</template>

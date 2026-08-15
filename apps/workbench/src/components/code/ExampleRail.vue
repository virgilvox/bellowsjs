<script setup lang="ts">
/*
 * The left rail: one panel per example category, entries as flat buttons,
 * the active example lit phosphor.
 */

import { computed } from 'vue';
import { categories as jsCategories } from '../../examples';

/*
 * The rail is generic over its list now, because the CODE page has two
 * trees: javascript and embedded. Given nothing it shows the javascript
 * one, which is what every existing caller expects.
 */
interface RailCategory {
  name: string;
  examples: Array<{ id: string; title: string }>;
}

const props = withDefaults(
  defineProps<{ activeId: string; categories?: RailCategory[] }>(),
  { categories: undefined },
);

const cats = computed<RailCategory[]>(() => props.categories ?? jsCategories);
defineEmits<{ (e: 'select', id: string): void }>();

function num(i: number): string {
  return String(i + 1).padStart(2, '0');
}
</script>

<template>
  <div class="rail">
    <div v-for="(cat, ci) in cats" :key="cat.name" class="panel">
      <div class="panel-title">
        {{ num(ci) }} {{ cat.name }}
        <em>{{ cat.examples.length }}</em>
      </div>
      <button
        v-for="ex in cat.examples"
        :key="ex.id"
        class="entry"
        :class="{ lit: ex.id === activeId }"
        @click="$emit('select', ex.id)"
      >
        {{ ex.title }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.rail .panel {
  margin-bottom: 12px;
  padding: 10px;
}

.entry {
  display: block;
  width: 100%;
  text-align: left;
  font-size: 10px;
  letter-spacing: 0.12em;
  padding: 6px 8px;
  margin-bottom: 3px;
  background: transparent;
  border: 1px solid transparent;
  border-left: 2px solid var(--seam);
  box-shadow: none;
  color: var(--tick);
}

.entry:hover {
  transform: none;
  border-left-color: var(--phosphor);
  color: var(--phosphor-hot);
}

.entry:active {
  transform: none;
  box-shadow: none;
}

.entry.lit {
  background: var(--phosphor);
  border-color: var(--phosphor);
  color: var(--lit-text);
}

.entry.lit:hover {
  color: var(--lit-text);
}
</style>

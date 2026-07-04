<script setup lang="ts">
import { MOODS } from '../../lib/composer';
import { bench, setMood } from '../../lib/bench-store';

const moods = Object.keys(MOODS);
</script>

<template>
  <div class="panel">
    <div class="panel-title">mood <em>02</em></div>
    <div class="mood-grid">
      <button
        v-for="m in moods"
        :key="m"
        :class="{ lit: bench.mood === m }"
        :disabled="bench.busy"
        @click="setMood(m)"
      >
        {{ m }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.mood-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mood-grid button {
  font-size: 10px;
  padding: 8px 4px;
}
</style>

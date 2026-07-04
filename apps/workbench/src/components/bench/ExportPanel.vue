<script setup lang="ts">
import { bench, renderEight } from '../../lib/bench-store';
</script>

<template>
  <div class="panel">
    <div class="panel-title">export <em>05</em></div>
    <button
      class="render-btn"
      :disabled="!bench.ready || bench.render.busy || bench.busy"
      @click="renderEight()"
    >
      {{ bench.render.busy ? 'RENDERING...' : 'RENDER 8 BARS' }}
    </button>
    <div class="render-note">
      <template v-if="!bench.ready">press play first: the render replays the seeded piece offline</template>
      <template v-else-if="bench.render.busy">forging the phrase sample by sample</template>
      <template v-else-if="bench.render.ms > 0">
        rendered in {{ bench.render.ms }} ms //
        <a :href="bench.render.url" :download="bench.render.name">{{ bench.render.name }}</a>
      </template>
      <template v-else>same clock, same seeds, no audio context: a wav of the current 8 bar phrase</template>
    </div>
  </div>
</template>

<style scoped>
.render-btn {
  width: 100%;
  font-family: var(--disp);
  font-size: 13px;
  font-weight: 700;
  padding: 11px 8px;
}

.render-note {
  margin-top: 8px;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--faded);
  text-transform: uppercase;
  min-height: 12px;
  word-break: break-all;
}

.render-note a {
  color: var(--phosphor);
  text-decoration: none;
  border-bottom: 1px dashed var(--phosphor);
}
</style>

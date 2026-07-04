<script setup lang="ts">
/*
 * The run console: log lines from the current run, autoscrolling, capped
 * at 200 lines by the runner. Errors render in slag red, run/boot notices
 * in phosphor.
 */

import { nextTick, ref, watch } from 'vue';
import { runner } from '../../lib/runner';

const scroller = ref<HTMLElement | null>(null);

watch(
  () => runner.lines.length,
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <div class="panel">
    <div class="panel-title">
      10 CONSOLE
      <em>
        <span class="lamp-dot" :class="{ hot: runner.running }"></span>
        {{ runner.running ? 'RUNNING' : 'IDLE' }} // {{ runner.lines.length }} LINES
      </em>
    </div>
    <div ref="scroller" class="console">
      <div v-if="runner.lines.length === 0" class="line idle">// console idle. select an example and press RUN.</div>
      <div v-for="(line, i) in runner.lines" :key="i" class="line" :class="line.kind">{{ line.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.console {
  background: var(--forge);
  border: 1px solid var(--seam);
  height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.55;
}

.line {
  color: var(--tick);
  white-space: pre-wrap;
  word-break: break-word;
}

.line.info {
  color: var(--phosphor);
}

.line.error {
  color: var(--slag);
}

.line.idle {
  color: var(--faded);
}
</style>

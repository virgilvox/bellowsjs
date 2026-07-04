<script setup lang="ts">
/*
 * Code mode: an interactive example explorer. Left rail picks an example,
 * the main column shows its brief, an editable CodeMirror source, run
 * controls, and the console. #code/example-id in the url selects on load.
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { defaultExample, exampleById, type Example } from '../examples';
import { runner, runExample, stopRun } from '../lib/runner';
import ExampleRail from '../components/code/ExampleRail.vue';
import CodeEditor from '../components/code/CodeEditor.vue';
import RunConsole from '../components/code/RunConsole.vue';

function exampleFromHash(): Example {
  const m = /^#code\/(.+)$/.exec(location.hash);
  if (m) {
    const found = exampleById(decodeURIComponent(m[1]));
    if (found) return found;
  }
  return defaultExample;
}

const active = ref<Example>(exampleFromHash());
const code = ref<string>(active.value.code);

/* unsaved edits per example, so switching examples keeps work in flight */
const drafts = new Map<string, string>();

watch(code, (value) => {
  if (value !== active.value.code) drafts.set(active.value.id, value);
  else drafts.delete(active.value.id);
});

function select(id: string): void {
  const ex = exampleById(id);
  if (!ex || ex.id === active.value.id) return;
  active.value = ex;
  code.value = drafts.get(ex.id) ?? ex.code;
  history.replaceState(null, '', '#code/' + ex.id);
}

function onHashChange(): void {
  const ex = exampleFromHash();
  if (ex.id !== active.value.id) {
    active.value = ex;
    code.value = drafts.get(ex.id) ?? ex.code;
  }
}

const isEdited = computed(() => drafts.has(active.value.id) && code.value !== active.value.code);
const isRunningThis = computed(() => runner.running && runner.runningId === active.value.id);

async function onRun(): Promise<void> {
  // every entry into sound goes through ensureBellows, inside the runner,
  // from this click handler
  await runExample(active.value, code.value);
}

function onStop(): void {
  stopRun();
}

function onReset(): void {
  drafts.delete(active.value.id);
  code.value = active.value.code;
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  if (!location.hash.startsWith('#code/')) {
    history.replaceState(null, '', '#code/' + active.value.id);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHashChange);
  stopRun();
});

// the view lives inside a KeepAlive: leaving code mode deactivates rather
// than unmounts, and the workbench needs the audio engine back
onDeactivated(() => {
  stopRun();
});

// coming back from bench mode, the shell has set a bare #code; put the
// deep link for the kept-alive selection back
onActivated(() => {
  if (!location.hash.startsWith('#code/')) {
    history.replaceState(null, '', '#code/' + active.value.id);
  }
});
</script>

<template>
  <div class="code-deck">
    <aside>
      <ExampleRail :active-id="active.id" @select="select" />
    </aside>

    <section>
      <div class="panel">
        <div class="panel-title">
          08 BRIEF // {{ active.category }}
          <em>#code/{{ active.id }}</em>
        </div>
        <h2 class="ex-title">{{ active.title }}</h2>
        <p class="ex-desc">{{ active.description }}</p>
      </div>

      <div class="panel">
        <div class="panel-title">
          09 SOURCE
          <em>async (b, lib, log, onCleanup) {{ isEdited ? '// EDITED' : '' }}</em>
        </div>
        <CodeEditor v-model="code" />
        <div class="control-row">
          <button class="big" :class="{ lit: isRunningThis }" @click="onRun">RUN</button>
          <button class="big" :disabled="!runner.running" @click="onStop">STOP</button>
          <button :disabled="!isEdited" @click="onReset">RESET CODE</button>
          <span class="seed">
            <span class="lamp-dot" :class="{ hot: runner.running }"></span>
            SEED "{{ active.seed }}"
          </span>
        </div>
      </div>

      <RunConsole />
    </section>
  </div>
</template>

<style scoped>
.code-deck {
  display: grid;
  grid-template-columns: 264px 1fr;
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .code-deck {
    grid-template-columns: 1fr;
  }
}

.ex-title {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.14em;
  color: var(--phosphor);
  margin-bottom: 6px;
}

.ex-desc {
  font-size: 12px;
  color: var(--tick);
  max-width: 72ch;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.control-row .big {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  padding: 9px 22px;
}

.seed {
  margin-left: auto;
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
</style>

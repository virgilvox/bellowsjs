<script setup lang="ts">
/*
 * Code mode: an interactive example explorer. Left rail picks an example,
 * the main column shows its brief, an editable CodeMirror source, run
 * controls, and the console. #code/example-id in the url selects on load.
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { defaultExample, exampleById, type Example } from '../examples';
import {
  EMBEDDED_CATEGORIES,
  defaultEmbeddedExample,
  embeddedById,
  type EmbeddedExample,
} from '../examples/embedded';
import { runner, runExample, stopRun } from '../lib/runner';
import ExampleRail from '../components/code/ExampleRail.vue';
import CodeEditor from '../components/code/CodeEditor.vue';
import RunConsole from '../components/code/RunConsole.vue';

/*
 * Two trees on one page: javascript, and the C++ port.
 *
 * They are not two renderings of the same thing. A javascript example IS
 * the thing that runs. An embedded example is C++ that compiles to a board,
 * shown next to a browser equivalent you can hear, and the page says which
 * is which rather than implying the browser is the firmware.
 *
 * The hash carries the tree, so a link to an embedded example comes back to
 * the embedded tab: #code/eng-drum-kit works because ids are unique across
 * both registries.
 */
type Lang = 'js' | 'embedded';

function fromHash(): { lang: Lang; ex: Example | EmbeddedExample } {
  const m = /^#code\/(.+)$/.exec(location.hash);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const js = exampleById(id);
    if (js) return { lang: 'js', ex: js };
    const emb = embeddedById(id);
    if (emb) return { lang: 'embedded', ex: emb };
  }
  return { lang: 'js', ex: defaultExample };
}

const initial = fromHash();
const lang = ref<Lang>(initial.lang);
const active = ref<Example>(initial.lang === 'js' ? (initial.ex as Example) : defaultExample);
const activeEmbedded = ref<EmbeddedExample>(
  initial.lang === 'embedded' ? (initial.ex as EmbeddedExample) : defaultEmbeddedExample,
);

/** Whichever tree is showing. */
const current = computed<Example>(() =>
  lang.value === 'js' ? active.value : (activeEmbedded.value as Example),
);
const embedded = computed<EmbeddedExample | null>(() =>
  lang.value === 'embedded' ? activeEmbedded.value : null,
);
const showEquivalent = ref(false);

function setLang(next: Lang): void {
  if (next === lang.value) return;
  stopRun();
  lang.value = next;
  code.value = drafts.get(current.value.id) ?? current.value.code;
  history.replaceState(null, '', '#code/' + current.value.id);
}

const code = ref<string>(initial.ex.code);

/* unsaved edits per example, so switching examples keeps work in flight */
const drafts = new Map<string, string>();

watch(code, (value) => {
  if (value !== current.value.code) drafts.set(current.value.id, value);
  else drafts.delete(current.value.id);
});

function select(id: string): void {
  if (lang.value === 'js') {
    const ex = exampleById(id);
    if (!ex || ex.id === active.value.id) return;
    active.value = ex;
  } else {
    const ex = embeddedById(id);
    if (!ex || ex.id === activeEmbedded.value.id) return;
    activeEmbedded.value = ex;
  }
  code.value = drafts.get(id) ?? current.value.code;
  history.replaceState(null, '', '#code/' + id);
}

function onHashChange(): void {
  const next = fromHash();
  if (next.ex.id === current.value.id && next.lang === lang.value) return;
  lang.value = next.lang;
  if (next.lang === 'js') active.value = next.ex as Example;
  else activeEmbedded.value = next.ex as EmbeddedExample;
  code.value = drafts.get(next.ex.id) ?? next.ex.code;
}

const isEdited = computed(() => drafts.has(current.value.id) && code.value !== current.value.code);
const isRunningThis = computed(() => runner.running && runner.runningId === current.value.id);

async function onRun(): Promise<void> {
  // every entry into sound goes through ensureBellows, inside the runner,
  // from this click handler
  await runExample(current.value, code.value);
}

function onStop(): void {
  stopRun();
}

function onReset(): void {
  drafts.delete(current.value.id);
  code.value = current.value.code;
}

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  if (!location.hash.startsWith('#code/')) {
    history.replaceState(null, '', '#code/' + current.value.id);
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
    history.replaceState(null, '', '#code/' + current.value.id);
  }
});
</script>

<template>
  <div class="code-deck">
    <aside>
      <nav class="langs">
        <button :class="{ lit: lang === 'js' }" @click="setLang('js')">JAVASCRIPT</button>
        <button :class="{ lit: lang === 'embedded' }" @click="setLang('embedded')">EMBEDDED</button>
      </nav>
      <ExampleRail
        v-if="lang === 'js'"
        :active-id="current.id"
        @select="select"
      />
      <ExampleRail
        v-else
        :active-id="current.id"
        :categories="EMBEDDED_CATEGORIES"
        @select="select"
      />
    </aside>

    <section>
      <div class="panel">
        <div class="panel-title">
          08 BRIEF // {{ current.category }}
          <em>#code/{{ current.id }}</em>
        </div>
        <h2 class="ex-title">{{ current.title }}</h2>
        <p class="ex-desc">{{ current.description }}</p>
        <div v-if="embedded" class="facts">
          <span v-for="h in embedded.needs" :key="h">{{ h }}</span>
        </div>
        <p v-if="embedded && embedded.parityRow" class="ex-meta">
          The C++ and the browser run the same DSP. For
          <code>{{ embedded.parityRow }}</code> the measured difference is
          <b>{{ embedded.parityRelRms?.toExponential(2) }}</b> relative RMS.
        </p>
        <p v-else-if="embedded" class="ex-meta">
          No parity row covers this one: the browser version is an illustration of the
          same idea rather than a measured match.
        </p>
        <p v-if="embedded && embedded.caveat" class="ex-meta caveat">{{ embedded.caveat }}</p>
      </div>

      <!-- EMBEDDED: the C++ is the thing that ships, so it is the source. -->
      <div v-if="embedded" class="panel">
        <div class="panel-title">
          09 FIRMWARE
          <em>c++ // compiled on every build</em>
        </div>
        <pre class="cpp">{{ embedded.cpp }}</pre>
        <div class="control-row">
          <button class="big" :class="{ lit: isRunningThis }" @click="onRun">HEAR IT</button>
          <button class="big" :disabled="!runner.running" @click="onStop">STOP</button>
          <button @click="showEquivalent = !showEquivalent">
            {{ showEquivalent ? 'HIDE' : 'SHOW' }} BROWSER EQUIVALENT
          </button>
          <span class="seed">
            <span class="lamp-dot" :class="{ hot: runner.running }"></span>
            SEED "{{ current.seed }}"
          </span>
        </div>
        <p class="ex-meta">
          HEAR IT plays the browser equivalent. The C++ above is what compiles to a
          board, and it is compiled on every build so it cannot drift.
        </p>
      </div>

      <div v-if="embedded && showEquivalent" class="panel">
        <div class="panel-title">
          10 BROWSER EQUIVALENT
          <em>async (b, lib, log, onCleanup) {{ isEdited ? '// EDITED' : '' }}</em>
        </div>
        <CodeEditor v-model="code" />
        <div class="control-row">
          <button :disabled="!isEdited" @click="onReset">RESET CODE</button>
        </div>
      </div>

      <!-- JAVASCRIPT: the source IS the thing that runs. -->
      <div v-if="!embedded" class="panel">
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
            SEED "{{ current.seed }}"
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

.langs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.langs button {
  flex: 1;
  font-family: var(--disp);
  font-weight: 600;
  padding: 8px 6px;
}
.cpp {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  margin-bottom: 10px;
  max-height: 60vh;
}
.ex-meta {
  font-size: 11px;
  color: var(--tick);
  line-height: 1.6;
  margin-top: 8px;
  max-width: 74ch;
}
.ex-meta.caveat {
  border-left: 2px solid var(--slag);
  padding-left: 10px;
}
.ex-meta b {
  color: var(--phosphor-hot);
}
.ex-meta code {
  font-family: var(--mono);
  background: var(--char);
  border: 1px solid var(--seam);
  padding: 0 4px;
  color: var(--phosphor-hot);
}
.facts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.facts span {
  border: 1px solid var(--seam);
  padding: 2px 6px;
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.08em;
}
.seed {
  margin-left: auto;
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
</style>

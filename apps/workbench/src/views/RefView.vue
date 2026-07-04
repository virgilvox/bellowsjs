<script setup lang="ts">
/*
 * The LLM reference: the whole library in one machine-readable document,
 * generated from source and type declarations by scripts/gen-llm-ref.mjs.
 * One copy button, plus the raw file at /llm.txt for direct fetching.
 */

import { onMounted, ref } from 'vue';

const text = ref('');
const failed = ref(false);
const copied = ref(false);

onMounted(async () => {
  try {
    const res = await fetch('/llm.txt');
    if (!res.ok) throw new Error(String(res.status));
    text.value = await res.text();
  } catch {
    failed.value = true;
  }
});

async function copyAll() {
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    // selection fallback: the text is selectable below
  }
}

function sizeLabel(): string {
  if (!text.value) return '';
  return (text.value.length / 1024).toFixed(1) + ' KB // ' + text.value.split('\n').length + ' lines';
}
</script>

<template>
  <div class="refpage">
    <section class="panel">
      <div class="panel-title">
        llm reference <em>{{ sizeLabel() }}</em>
        <span class="actions">
          <a class="raw" href="/llm.txt" target="_blank" rel="noopener">RAW /llm.txt</a>
          <button class="lit" :disabled="!text" @click="copyAll">{{ copied ? 'COPIED' : 'COPY ALL' }}</button>
        </span>
      </div>
      <p class="lead">
        Paste this into any AI assistant and it will know the entire bellowsjs API:
        every engine and effect with exact parameter ranges, the facade, theory,
        sequencing, analysis, and the rules that keep integrations correct.
        Generated from the library source and its type declarations, so it matches
        the published package exactly.
      </p>
      <pre v-if="text"><code>{{ text }}</code></pre>
      <p v-else-if="failed" class="lead">Could not load /llm.txt. The raw file link above may still work.</p>
      <p v-else class="lead">loading...</p>
    </section>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.actions button {
  box-shadow: none;
  padding: 4px 12px;
  font-size: 10px;
}

.raw {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--tick);
  text-decoration: none;
  border: 1px solid var(--seam);
  padding: 4px 10px;
}

.raw:hover {
  color: var(--phosphor);
  border-color: var(--phosphor);
}

.lead {
  font-size: 12px;
  color: var(--tick);
  line-height: 1.6;
  margin-bottom: 12px;
  max-width: 760px;
}

pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 16px;
  overflow: auto;
  max-height: 70vh;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  user-select: all;
}
</style>

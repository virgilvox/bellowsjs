<script setup lang="ts">
/*
 * CodeMirror 6 wrapper themed for the forge: soot background, phosphor
 * cursor and accents, char gutter, JetBrains Mono. v-model carries the
 * document; external writes (example switch, reset) replace the doc.
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const forgeTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--soot)',
      color: 'var(--bone)',
      fontSize: '13px',
      border: '1px solid var(--seam)',
    },
    '&.cm-focused': { outline: 'none', borderColor: 'var(--phosphor)' },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', monospace",
      lineHeight: '1.5',
      maxHeight: '420px',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--phosphor)', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--phosphor)',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(255, 176, 0, 0.16)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 176, 0, 0.04)' },
    '.cm-gutters': {
      backgroundColor: 'var(--char)',
      color: 'var(--faded)',
      border: 'none',
      borderRight: '1px solid var(--seam)',
      fontSize: '10px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--phosphor)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(255, 176, 0, 0.18)',
      outline: '1px solid rgba(255, 176, 0, 0.4)',
    },
  },
  { dark: true },
);

const forgeHighlight = HighlightStyle.define([
  { tag: tags.comment, color: '#57503d', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#57503d', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#ffb000' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#ffb000' },
  { tag: tags.string, color: '#ffd257' },
  { tag: tags.number, color: '#ffd257' },
  { tag: tags.regexp, color: '#ffd257' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#e9e2d0' },
  { tag: tags.propertyName, color: '#c9bfa4' },
  { tag: tags.variableName, color: '#e9e2d0' },
  { tag: tags.definition(tags.variableName), color: '#e9e2d0' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#8f8571' },
]);

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        javascript(),
        forgeTheme,
        syntaxHighlighting(forgeHighlight),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit('update:modelValue', update.state.doc.toString());
          }
        }),
      ],
    }),
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  },
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="editor-host"></div>
</template>

<style scoped>
.editor-host {
  margin-bottom: 10px;
}
</style>

<script setup lang="ts">
/*
 * A searchable picker: a field that shows the current choice and opens a grouped, filterable list,
 * the WAI-ARIA combobox pattern (an input with role combobox driving a listbox). It looks like a
 * form field, not a button, because it is one: choosing from many options (thirty-one accents,
 * thirteen voices) is a search, and a field with a chevron says "open me and pick".
 *
 * Keyboard: Enter, Space or Down opens; typing filters; Up and Down move; Enter picks; Escape
 * closes and returns focus to the field.
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface PickerOption {
  id: string;
  label: string;
  /** A short second line: region, range, what it is. */
  detail?: string;
  /** Heading the option is listed under. */
  group?: string;
  /** Extra words the search matches. */
  keywords?: string;
}

const props = defineProps<{
  label: string;
  options: PickerOption[];
  modelValue: string;
  /** Shown under the field. */
  hint?: string;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [id: string] }>();

const uid = 'pk' + Math.random().toString(36).slice(2, 8);
const open = ref(false);
const query = ref('');
const active = ref(0);
const root = ref<HTMLElement | null>(null);
const field = ref<HTMLButtonElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);

const current = computed(() => props.options.find((o) => o.id === props.modelValue));

const words = (t: string | undefined) => (t ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/*
 * Search matches the start of words, not any substring ("ir" finds Irish, not Birmingham), every
 * query word must start some word of the option's name, id, keywords or group, and the results are
 * ranked: the name starting with the query first, then a word of the name, then the rest.
 */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  const qs = words(q);
  const scored: Array<[number, number, PickerOption]> = [];
  props.options.forEach((o, i) => {
    const nameWords = words(o.label);
    const all = [...nameWords, ...words(o.keywords), ...words(o.group)];
    if (!qs.every((w) => all.some((t) => t.startsWith(w)))) return;
    const rank = o.label.toLowerCase().startsWith(q) ? 0 : qs.every((w) => nameWords.some((t) => t.startsWith(w))) ? 1 : 2;
    scored.push([rank, i, o]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , o]) => o);
});

/* browsing: grouped under headings; searching: one ranked list */
const rows = computed(() => {
  const out: Array<{ heading: string } | { option: PickerOption; index: number }> = [];
  const searching = query.value.trim() !== '';
  let last: string | undefined;
  filtered.value.forEach((o, index) => {
    if (!searching && o.group && o.group !== last) {
      out.push({ heading: o.group });
      last = o.group;
    }
    out.push({ option: o, index });
  });
  return out;
});

async function show(): Promise<void> {
  open.value = true;
  query.value = '';
  active.value = Math.max(0, filtered.value.findIndex((o) => o.id === props.modelValue));
  await nextTick();
  search.value?.focus();
  scrollActive();
}

function hide(refocus = true): void {
  open.value = false;
  if (refocus) field.value?.focus();
}

function pick(o: PickerOption): void {
  emit('update:modelValue', o.id);
  hide();
}

function scrollActive(): void {
  nextTick(() => list.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
}

function onFieldKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    void show();
  }
}

function onSearchKey(e: KeyboardEvent): void {
  const n = filtered.value.length;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = n ? (active.value + 1) % n : 0;
    scrollActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = n ? (active.value - 1 + n) % n : 0;
    scrollActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const o = filtered.value[active.value];
    if (o) pick(o);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hide();
  } else if (e.key === 'Tab') {
    hide(false);
  }
}

watch(query, () => {
  active.value = 0;
});

function onDocDown(e: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) hide(false);
}
onMounted(() => document.addEventListener('pointerdown', onDocDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown));
</script>

<template>
  <div ref="root" class="picker">
    <span :id="uid + '-label'" class="label">{{ label }}</span>
    <button
      ref="field"
      type="button"
      class="field"
      :aria-labelledby="uid + '-label ' + uid + '-value'"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open ? hide() : show()"
      @keydown="onFieldKey"
    >
      <span :id="uid + '-value'" class="value">
        <span class="main">{{ current?.label ?? placeholder ?? 'Choose' }}</span>
        <span v-if="current?.detail" class="detail">{{ current.detail }}</span>
      </span>
      <span class="chevron" aria-hidden="true"></span>
    </button>
    <p v-if="hint" class="hint">{{ hint }}</p>

    <div v-if="open" class="pop">
      <input
        ref="search"
        v-model="query"
        class="search"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="true"
        :aria-controls="uid + '-list'"
        :aria-activedescendant="filtered[active] ? uid + '-o-' + filtered[active].id : undefined"
        :aria-label="'search ' + label.toLowerCase()"
        :placeholder="'Search ' + label.toLowerCase()"
        spellcheck="false"
        @keydown="onSearchKey"
      />
      <ul :id="uid + '-list'" ref="list" class="list" role="listbox" :aria-label="label">
        <template v-for="(row, i) in rows" :key="i">
          <li v-if="'heading' in row" class="heading" role="presentation">{{ row.heading }}</li>
          <li
            v-else
            :id="uid + '-o-' + row.option.id"
            class="option"
            role="option"
            :aria-selected="row.option.id === modelValue"
            :data-active="row.index === active"
            @pointerenter="active = row.index"
            @click="pick(row.option)"
          >
            <span class="main">{{ row.option.label }}<span v-if="query.trim() && row.option.group" class="tag">{{ row.option.group }}</span></span>
            <span v-if="row.option.detail" class="detail">{{ row.option.detail }}</span>
          </li>
        </template>
        <li v-if="!filtered.length" class="empty" role="presentation">Nothing matches "{{ query }}".</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  display: grid;
  gap: 5px;
  min-width: 0;
}
.label {
  font-size: 11px;
  font-weight: 600;
  color: var(--tick);
}
/* a field, not a button: no raised shadow, no hover lift, the site's input look */
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  font-size: 14px;
  background: var(--iron);
  color: var(--bone);
  border: 2px solid var(--seam);
  box-shadow: none;
  padding: 9px 12px;
  min-height: 48px;
}
.field:hover {
  transform: none;
  color: var(--bone);
  border-color: var(--phosphor);
}
.field:active {
  transform: none;
  box-shadow: none;
}
.field:focus-visible,
.search:focus-visible {
  outline: 2px solid var(--phosphor);
  outline-offset: 2px;
}
.value {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.main {
  font-family: var(--disp);
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail {
  font-size: 11px;
  color: var(--tick);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  flex: none;
  width: 9px;
  height: 9px;
  border-right: 2px solid var(--tick);
  border-bottom: 2px solid var(--tick);
  transform: translateY(-3px) rotate(45deg);
}
.hint {
  font-size: 11px;
  color: var(--tick);
  margin: 0;
  line-height: 1.5;
}
.pop {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 260px;
  background: var(--soot);
  border: 2px solid var(--phosphor);
  box-shadow: var(--shadow);
}
.search {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--seam);
  background: var(--iron);
  color: var(--bone);
  font-family: var(--mono);
  font-size: 14px;
  letter-spacing: 0;
  padding: 10px 12px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 320px;
  overflow: auto;
}
.heading {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--faded);
  padding: 10px 12px 4px;
}
.option {
  display: grid;
  gap: 1px;
  padding: 7px 12px 7px 20px;
  cursor: pointer;
}
.option[data-active='true'] {
  background: var(--phosphor-dim);
}
.option[aria-selected='true'] .main {
  color: var(--phosphor-hot);
}
.option[aria-selected='true'] .main::after {
  content: '  (current)';
  font-family: var(--mono);
  font-weight: 400;
  font-size: 10px;
  color: var(--faded);
}
.option .main {
  font-size: 14px;
  white-space: normal;
}
.option .detail {
  white-space: normal;
}
.tag {
  font-family: var(--mono);
  font-weight: 400;
  font-size: 10px;
  color: var(--faded);
  margin-left: 8px;
}
.empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--tick);
}
</style>

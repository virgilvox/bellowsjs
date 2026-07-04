<script setup lang="ts">
/*
 * Soundfont and sample loader for the bench. Descends from prototype 0's
 * panel 04: load .sf2 banks, activate presets as sampler engines the voice
 * strips can run, and build a user kit from dropped audio files. All state
 * lives in the shared soundfonts seam; this component only renders it.
 */
import { computed, ref } from 'vue';
import {
  sfState,
  addSf2,
  activatePreset,
  deactivate,
  addUserSample,
  setUserSampleRoot,
  removeUserSample,
  rootKeyLabel,
  type PresetRef,
} from '../../lib/soundfonts';
import { sfNotice } from '../../lib/bench-store';
import { bellows } from '../../lib/audio';

const loading = ref('');
/** currently picked 'bank:program' per font index */
const picks = ref<Record<number, string>>({});

const status = computed(() => {
  if (loading.value) return loading.value;
  if (sfState.error) return 'error: ' + sfState.error;
  if (sfNotice.value) return sfNotice.value;
  if (!sfState.fonts.length && !sfState.userSamples.length) {
    return 'load a bank or drop samples: they show up as SAMPLES engines on every melodic strip';
  }
  return sfState.active.length + ' bank(s) active';
});

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function onSf2Files(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  sfState.error = '';
  for (const f of files) {
    loading.value = 'parsing ' + f.name + ' ...';
    try {
      await addSf2(f);
    } catch (err) {
      sfState.error = f.name + ': ' + errText(err);
    }
  }
  loading.value = '';
}

/*
 * Structural view of a loaded font: the template only needs the name and
 * the preset list, never the parsed (markRaw) SoundFont itself.
 */
interface FontView {
  name: string;
  presets: PresetRef[];
}

function presetValue(font: FontView, fi: number): string {
  return picks.value[fi] ?? (font.presets.length ? presetKey(font, 0) : '');
}

function presetKey(font: FontView, i: number): string {
  const p = font.presets[i];
  return p.bank + ':' + p.program;
}

function onPresetPick(fi: number, e: Event): void {
  picks.value[fi] = (e.target as HTMLSelectElement).value;
  activatePick(fi);
}

function activatePick(fi: number): void {
  const font = sfState.fonts[fi];
  if (!font) return;
  const v = presetValue(font, fi);
  if (!v) return;
  const [bank, program] = v.split(':').map(Number);
  try {
    activatePreset(fi, bank, program);
    sfState.error = '';
    sfNotice.value = '';
  } catch (err) {
    sfState.error = errText(err);
  }
}

async function onSampleFiles(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  sfState.error = '';
  for (const f of files) {
    loading.value = 'decoding ' + f.name + ' ...';
    try {
      await addUserSample(f, bellows.value?.ctx);
    } catch (err) {
      sfState.error = f.name + ': ' + errText(err);
    }
  }
  loading.value = '';
}

function bumpRoot(i: number, dir: number): void {
  const s = sfState.userSamples[i];
  if (!s) return;
  setUserSampleRoot(i, Math.min(108, Math.max(12, s.rootKey + dir)));
}
</script>

<template>
  <div class="panel">
    <div class="panel-title">soundfont + samples <em>04b</em></div>

    <label class="filebtn" for="sfFile">LOAD .SF2 BANK</label>
    <input id="sfFile" type="file" accept=".sf2,.SF2" multiple class="hidden-input" @change="onSf2Files" />

    <div v-for="(font, fi) in sfState.fonts" :key="fi" class="font-block">
      <div class="font-head">
        <span class="font-name">{{ font.name }}</span>
        <span class="font-count">{{ font.presets.length }} presets</span>
      </div>
      <div class="preset-row">
        <select :value="presetValue(font, fi)" @change="onPresetPick(fi, $event)">
          <option v-for="(p, pi) in font.presets" :key="pi" :value="presetKey(font, pi)">
            {{ p.bank }}:{{ p.program }} {{ p.name }}
          </option>
        </select>
        <button type="button" class="mini-btn" @click="activatePick(fi)">ACTIVATE</button>
      </div>
    </div>

    <div v-if="sfState.active.length" class="field active-field">
      <label>active banks</label>
      <div v-for="a in sfState.active" :key="a.engineId" class="active-row">
        <span class="active-label">{{ a.label }}</span>
        <button type="button" class="mini-btn" @click="deactivate(a.engineId)">X</button>
      </div>
    </div>

    <label class="filebtn samples-btn" for="userSampleFile">ADD SAMPLES</label>
    <input id="userSampleFile" type="file" accept="audio/*" multiple class="hidden-input" @change="onSampleFiles" />

    <div v-if="sfState.userSamples.length" class="field sample-field">
      <label>user kit</label>
      <div v-for="(s, si) in sfState.userSamples" :key="si" class="sample-row">
        <span class="sample-name" :title="s.name">{{ s.name }}</span>
        <span class="root-readout">{{ rootKeyLabel(s) }}</span>
        <span class="root-step">
          <button type="button" @click="bumpRoot(si, -1)">-</button>
          <button type="button" @click="bumpRoot(si, 1)">+</button>
        </span>
        <button type="button" class="mini-btn" @click="removeUserSample(si)">X</button>
      </div>
      <div class="dim-note">root keys are pitch-detected where the material is tonal; step to correct them</div>
    </div>

    <div class="sf-status" :class="{ err: !!sfState.error }">{{ status }}</div>

    <div class="dim-note footer-note">
      need soundfonts?
      <a href="https://www.polyphone.io/en/soundfonts" target="_blank" rel="noopener">polyphone.io</a>
      hosts free .sf2 banks
    </div>
  </div>
</template>

<style scoped>
.filebtn {
  display: block;
  width: 100%;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  background: var(--char);
  border: 2px dashed var(--seam);
  color: var(--tick);
  padding: 10px 8px;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
}

.filebtn:hover {
  border-color: var(--phosphor);
  color: var(--phosphor-hot);
}

.samples-btn {
  margin-top: 10px;
}

.hidden-input {
  display: none;
}

.font-block {
  margin-top: 10px;
}

.font-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.font-name {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--bone);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.font-count {
  font-size: 9.5px;
  color: var(--faded);
  letter-spacing: 0.1em;
  flex: 0 0 auto;
}

.preset-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.preset-row select {
  flex: 1;
  min-width: 0;
}

.mini-btn {
  flex: 0 0 auto;
  padding: 4px 7px;
  font-size: 9.5px;
  box-shadow: none;
}

.active-field,
.sample-field {
  margin-top: 10px;
  margin-bottom: 0;
}

.active-row,
.sample-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--seam);
  background: var(--char);
  padding: 4px 6px;
  margin-bottom: 4px;
}

.active-label {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--phosphor-hot);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sample-name {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: var(--bone);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.root-readout {
  font-size: 9.5px;
  color: var(--phosphor-hot);
  letter-spacing: 0.05em;
  flex: 0 0 auto;
}

.root-step {
  display: flex;
  border: 1px solid var(--seam);
  background: var(--iron);
  flex: 0 0 auto;
}

.root-step button {
  border: none;
  box-shadow: none;
  padding: 2px 6px;
  font-size: 10px;
  background: transparent;
}

.root-step button:hover {
  transform: none;
  color: var(--phosphor);
}

.sf-status {
  margin-top: 10px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--faded);
  letter-spacing: 0.04em;
}

.sf-status.err {
  color: var(--slag);
}

.dim-note {
  font-size: 9.5px;
  color: var(--faded);
  letter-spacing: 0.04em;
  line-height: 1.5;
}

.sample-field .dim-note {
  margin-top: 2px;
}

.footer-note {
  margin-top: 8px;
  border-top: 1px dashed var(--seam);
  padding-top: 6px;
}

.footer-note a {
  color: var(--phosphor);
  text-decoration: none;
  border-bottom: 1px dotted var(--phosphor);
}

.footer-note a:hover {
  color: var(--phosphor-hot);
}
</style>

<script setup lang="ts">
/*
 * Web MIDI input. ENABLE runs inside the click gesture so the permission
 * prompt and the audio boot both work; after that a device select binds a
 * MidiInput whose notes land in the shared store ledger (absolute pitch,
 * no octave shift) and whose cc64 drives sustain.
 */

import { onBeforeUnmount, ref } from 'vue';
import { MidiInput, noteName, type MidiPortInfo } from 'bellowsjs';
import { boot, noteOff, noteOn, setSustain } from '../../lib/instrument-store';

const supported =
  typeof navigator !== 'undefined' &&
  typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

const enabled = ref(false);
const busy = ref(false);
const ports = ref<MidiPortInfo[]>([]);
const selectedId = ref('');
const connected = ref(false);
const lastEvent = ref('none');
const error = ref('');

let input: MidiInput | null = null;

async function enable(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await boot();
    ports.value = await MidiInput.list();
    enabled.value = true;
    if (ports.value.length) await connect(ports.value[0].id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function refresh(): Promise<void> {
  try {
    ports.value = await MidiInput.list();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function connect(portId: string): Promise<void> {
  disconnect();
  selectedId.value = portId;
  if (!portId) return;
  try {
    const mi = new MidiInput(portId);
    await mi.ready;
    input = mi;
    connected.value = true;
    mi.onNote((e) => {
      if (e.on) noteOn(e.note, e.velocity, 'midi');
      else noteOff(e.note, 'midi');
      lastEvent.value =
        (e.on ? 'ON  ' : 'OFF ') + noteName(e.note) + ' vel ' + Math.round(e.velocity * 127);
    });
    mi.onControl((e) => {
      if (e.controller === 64) {
        setSustain(e.value >= 0.5);
        lastEvent.value = 'SUSTAIN ' + (e.value >= 0.5 ? 'ON' : 'OFF');
      }
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    connected.value = false;
  }
}

function disconnect(): void {
  input?.close();
  input = null;
  connected.value = false;
}

function onPick(e: Event): void {
  void connect((e.target as HTMLSelectElement).value);
}

onBeforeUnmount(disconnect);
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      web midi
      <em><span class="lamp-dot" :class="{ hot: connected }"></span>{{ connected ? 'connected' : 'offline' }}</em>
    </div>

    <p v-if="!supported" class="note">
      Web MIDI is not supported in this browser (Safari lacks it). Chrome, Edge, and Firefox work.
    </p>

    <template v-else>
      <button v-if="!enabled" :disabled="busy" @click="enable">
        {{ busy ? 'requesting...' : 'enable midi' }}
      </button>

      <template v-else>
        <div class="field">
          <label>input device</label>
          <select :value="selectedId" @change="onPick" @focus="refresh">
            <option value="">no device</option>
            <option v-for="p in ports" :key="p.id" :value="p.id">{{ p.name || p.id }}</option>
          </select>
        </div>
        <p v-if="!ports.length" class="note">no MIDI inputs found. plug in a device and reopen the select.</p>
        <div class="readout">
          <span class="ro-label">last event</span>
          <span class="ro-value">{{ lastEvent }}</span>
        </div>
        <p class="note">notes play at their real pitch (octave shift stays on the computer keys); cc64 works the sustain pedal.</p>
      </template>
    </template>

    <p v-if="error" class="err">{{ error }}</p>
  </section>
</template>

<style scoped>
.note {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.05em;
  margin-top: 8px;
}

.readout {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border: 1px solid var(--seam);
  background: var(--char);
  padding: 6px 8px;
  margin-top: 4px;
}

.ro-label {
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--tick);
}

.ro-value {
  font-size: 11px;
  color: var(--phosphor-hot);
  letter-spacing: 0.06em;
}

.err {
  margin-top: 8px;
  font-size: 10px;
  color: var(--slag);
}
</style>

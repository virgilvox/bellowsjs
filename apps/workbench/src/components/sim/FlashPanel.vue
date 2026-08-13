<!--
  Flashing, and an honest account of what is known to work.

  The WebHID path is written from the HalfKay protocol and has never been
  run against a board, so the panel says that where you can see it rather
  than in a comment. The build-and-flash command underneath is the path that
  is known to work, and it is not hidden behind the shiny one.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Board } from '../../lib/sim/board';
import type { Firmware } from '../../lib/sim/firmware';
import {
  TEENSY_VID,
  TEENSY_PID,
  flash,
  hidAvailable,
  loaderCommand,
  parseIntelHex,
  targetFor,
} from '../../lib/sim/flash';

const props = defineProps<{ board: Board; firmware: Firmware }>();

const supported = hidAvailable();

const busy = ref(false);
const note = ref('');
const pct = ref(0);
const error = ref('');
/* The hex to flash, from the dropdown or from a file the user picked. */
const hexText = ref('');
const hexName = ref('');


/*
 * The prebuilt binaries, and the commit they came from.
 *
 * public/firmware/manifest.json is written by scripts/gen-firmware-binaries.mjs.
 * A committed binary goes stale the moment a DSP header changes, and no CI
 * gate can regenerate twelve firmware links at a sensible cost, so instead
 * of pretending the panel prints the commit each one was built from. That
 * makes a stale binary visible rather than silent.
 */
interface Manifest {
  commit: string;
  builtAt: string;
  entries: Array<{ example: string; board: string; file: string; bytes: number; sha256: string }>;
}
const manifest = ref<Manifest | null>(null);
const chosen = ref('');

onMounted(async () => {
  try {
    const res = await fetch('/firmware/manifest.json');
    if (res.ok) manifest.value = (await res.json()) as Manifest;
  } catch {
    /* no prebuilt binaries deployed; the panel falls back to build-it-yourself */
  }
});

/** Prebuilt binaries for the board that is selected, this example first. */
const prebuilt = computed(() => {
  const all = (manifest.value?.entries ?? []).filter((e) => e.board === props.board.id);
  const mine = all.filter((e) => e.example === props.firmware.folder);
  const rest = all.filter((e) => e.example !== props.firmware.folder);
  return [...mine, ...rest];
});

watch(
  prebuilt,
  (list) => {
    if (!list.some((e) => e.file === chosen.value)) chosen.value = list[0]?.file ?? '';
  },
  { immediate: true },
);

const chosenEntry = computed(() => prebuilt.value.find((e) => e.file === chosen.value) ?? null);

async function loadPrebuilt(): Promise<void> {
  const e = chosenEntry.value;
  if (!e) return;
  error.value = '';
  try {
    const res = await fetch(`/firmware/${e.file}`);
    if (!res.ok) throw new Error(`could not fetch ${e.file}`);
    hexText.value = await res.text();
    hexName.value = e.file;
  } catch (err) {
    error.value = String((err as Error).message ?? err);
  }
}
const cmd = computed(() => loaderCommand(props.board.id, 'firmware.hex'));
const pioCmd = computed(
  () =>
    `cd packages/bellows-embedded/examples\nPLATFORMIO_SRC_DIR=${props.firmware.folder} pio run -e probe_${props.board.id.replace('teensy', 'teensy')} -t upload`,
);

async function pick(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  error.value = '';
  if (!f) return;
  hexText.value = await f.text();
  hexName.value = f.name;
}

async function doFlash(): Promise<void> {
  error.value = '';
  if (!hexText.value) {
    error.value = 'Load a prebuilt binary or choose a .hex first.';
    return;
  }
  busy.value = true;
  note.value = 'requesting device';
  try {
    const { data } = parseIntelHex(hexText.value);

    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: TEENSY_VID, productId: TEENSY_PID }],
    });
    const device = devices[0];
    if (!device) {
      error.value = 'No device chosen. Press the program button on the board first.';
      return;
    }
    if (!device.opened) await device.open();

    await flash(device, data, targetFor(props.board.id), (done, total, n) => {
      pct.value = Math.round((done / total) * 100);
      note.value = n;
    });
    note.value = 'done, board rebooting';
    await device.close();
  } catch (e) {
    error.value = String((e as Error).message ?? e);
    note.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">flash a board <em>09</em></div>

    <p class="warn">
      This has never been run against a board. It is the HalfKay protocol transcribed from PJRC's
      teensy_loader_cli, which is simple enough that transcribing it is low risk, and that is
      still not the same as having flashed something. The command underneath is the path that is
      known to work.
    </p>

    <template v-if="supported">
      <p class="note">
        Put the board in bootloader mode first: press the white program button. There is no
        reliable way for a page to do that for you on a board that is not already running
        firmware which offers one.
      </p>
      <div v-if="prebuilt.length" class="field">
        <label>prebuilt binary</label>
        <div class="row">
          <select v-model="chosen">
            <option v-for="e in prebuilt" :key="e.file" :value="e.file">
              {{ e.example }} // {{ (e.bytes / 1024).toFixed(0) }} KB
            </option>
          </select>
          <button @click="loadPrebuilt">LOAD</button>
          <a v-if="chosenEntry" class="dl" :href="'/firmware/' + chosenEntry.file" download>
            DOWNLOAD
          </a>
        </div>
        <p class="hint" v-if="manifest">
          Built from commit <b>{{ manifest.commit }}</b> on {{ manifest.builtAt }}. If the
          repository has moved since, these are the older program and the source above is the
          newer one. Rebuild with the command below to be sure.
        </p>
      </div>

      <div class="row">
        <input type="file" accept=".hex" @change="pick" />
        <button :disabled="busy || !hexText" @click="doFlash">
          {{ busy ? 'FLASHING' : 'FLASH OVER WEBHID' }}
        </button>
        <span v-if="hexName" class="meta">{{ hexName }}</span>
      </div>
      <div v-if="note" class="progress">
        <div class="bar"><div class="fill" :style="{ width: pct + '%' }"></div></div>
        <span class="meta">{{ pct }}% // {{ note }}</span>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </template>

    <div v-else-if="prebuilt.length" class="field">
      <label>prebuilt binary</label>
      <div class="row">
        <select v-model="chosen">
          <option v-for="e in prebuilt" :key="e.file" :value="e.file">
            {{ e.example }} // {{ (e.bytes / 1024).toFixed(0) }} KB
          </option>
        </select>
        <a v-if="chosenEntry" class="dl" :href="'/firmware/' + chosenEntry.file" download>DOWNLOAD</a>
      </div>
    </div>

    <p v-else class="note">
      This browser has no WebHID, so the button is not offered. Chromium desktop has it; Firefox
      and Safari have both objected to the standard and no mobile browser implements it. Use the
      command below, which does not care what browser you have.
    </p>

    <div class="known">
      <div class="label">build and flash, known to work</div>
      <pre>{{ pioCmd }}</pre>
      <div class="label">or flash a .hex you already have</div>
      <pre>{{ cmd }}</pre>
      <p class="note">
        Teensy Loader, PJRC's own tool, does the same thing with a window and a button.
      </p>
    </div>
  </section>
</template>

<style scoped>
.warn {
  border-left: 2px solid var(--slag);
  padding-left: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--tick);
  max-width: 74ch;
}
.note {
  font-size: 11.5px;
  color: var(--tick);
  line-height: 1.6;
  margin-top: 10px;
  max-width: 74ch;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}
.progress {
  margin-top: 10px;
}
.bar {
  height: 8px;
  border: 1px solid var(--seam);
  background: var(--iron);
}
.fill {
  height: 100%;
  background: var(--phosphor);
  transition: width 0.1s linear;
}
.meta {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.dl {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: var(--char);
  color: var(--bone);
  border: 2px solid var(--seam);
  padding: 7px 10px;
  text-decoration: none;
  box-shadow: var(--shadow-sm);
}
.dl:hover {
  border-color: var(--phosphor);
  color: var(--phosphor-hot);
}
.hint {
  font-size: 10px;
  color: var(--faded);
  line-height: 1.6;
  margin-top: 6px;
  max-width: 72ch;
}
.hint b {
  color: var(--phosphor-hot);
}
.field label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--tick);
  margin: 12px 0 6px;
}
.err {
  margin-top: 8px;
  color: var(--slag);
  font-size: 11px;
}
.known {
  margin-top: 16px;
  border-top: 1px dashed var(--seam);
  padding-top: 12px;
}
.label {
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--tick);
  margin-bottom: 6px;
}
pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  margin-bottom: 10px;
}
</style>

<!--
  Flashing, and an honest account of what is known to work.

  The WebHID path is written from the HalfKay protocol and has never been
  run against a board, so the panel says that where you can see it rather
  than in a comment. The build-and-flash command underneath is the path that
  is known to work, and it is not hidden behind the shiny one.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
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
const hexFile = ref<File | null>(null);

const cmd = computed(() => loaderCommand(props.board.id, 'firmware.hex'));
const pioCmd = computed(
  () =>
    `cd packages/bellows-embedded/examples\nPLATFORMIO_SRC_DIR=${props.firmware.folder} pio run -e probe_${props.board.id.replace('teensy', 'teensy')} -t upload`,
);

function pick(e: Event): void {
  const input = e.target as HTMLInputElement;
  hexFile.value = input.files?.[0] ?? null;
  error.value = '';
}

async function doFlash(): Promise<void> {
  error.value = '';
  if (!hexFile.value) {
    error.value = 'Choose a .hex first. Build one with the command below.';
    return;
  }
  busy.value = true;
  note.value = 'requesting device';
  try {
    const text = await hexFile.value.text();
    const { data } = parseIntelHex(text);

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
      <div class="row">
        <input type="file" accept=".hex" @change="pick" />
        <button :disabled="busy || !hexFile" @click="doFlash">
          {{ busy ? 'FLASHING' : 'FLASH OVER WEBHID' }}
        </button>
      </div>
      <div v-if="note" class="progress">
        <div class="bar"><div class="fill" :style="{ width: pct + '%' }"></div></div>
        <span class="meta">{{ pct }}% // {{ note }}</span>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </template>

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

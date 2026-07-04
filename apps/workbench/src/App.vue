<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { booted } from './lib/audio';

const WorkbenchView = defineAsyncComponent(() => import('./views/WorkbenchView.vue'));
const CodeView = defineAsyncComponent(() => import('./views/CodeView.vue'));

const mode = ref<'bench' | 'code'>(
  location.hash.startsWith('#code') ? 'code' : 'bench',
);

function setMode(m: 'bench' | 'code') {
  mode.value = m;
  history.replaceState(null, '', m === 'code' ? '#code' : '#bench');
}
</script>

<template>
  <div class="rig">
    <header>
      <div class="brand">
        <h1>BELL<b>O</b>WS</h1>
        <span class="tag">audio engine workbench // every forge needs one</span>
      </div>
      <nav class="modes">
        <button :class="{ lit: mode === 'bench' }" @click="setMode('bench')">WORKBENCH</button>
        <button :class="{ lit: mode === 'code' }" @click="setMode('code')">CODE</button>
      </nav>
      <div class="serial">
        <span class="lamp-dot" :class="{ hot: booted }"></span>BLW-01 REV B // BELLOWSJS 0.1<br />
        <span>vue workbench // library live</span>
      </div>
    </header>

    <KeepAlive>
      <WorkbenchView v-if="mode === 'bench'" />
      <CodeView v-else />
    </KeepAlive>

    <footer>
      <span>bellowsjs // apache-2.0 // github.com/virgilvox/bellowsjs</span>
      <span class="badges"><span>ONE CLOCK</span><span>ONE KERNEL</span><span>SEEDED</span></span>
    </footer>
  </div>
</template>

<style scoped>
.rig {
  max-width: 1280px;
  margin: 0 auto;
  padding: 18px 20px 40px;
}

header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 2px solid var(--seam);
  padding-bottom: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}

h1 {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 30px;
  letter-spacing: 0.14em;
  color: var(--bone);
}

h1 b {
  color: var(--phosphor);
  font-weight: 700;
}

.tag {
  font-size: 10px;
  color: var(--tick);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.modes {
  display: flex;
  gap: 8px;
}

.modes button {
  font-family: var(--disp);
  font-weight: 700;
  padding: 9px 18px;
}

.serial {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-align: right;
}

footer {
  border-top: 2px solid var(--seam);
  margin-top: 24px;
  padding-top: 10px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 9px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

footer .badges span {
  border: 1px solid var(--seam);
  padding: 2px 6px;
  margin-left: 6px;
}
</style>

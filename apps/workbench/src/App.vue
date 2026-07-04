<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { booted } from './lib/audio';
import { theme, toggleTheme } from './lib/theme';
import LandingView from './views/LandingView.vue';

const WorkbenchView = defineAsyncComponent(() => import('./views/WorkbenchView.vue'));
const CodeView = defineAsyncComponent(() => import('./views/CodeView.vue'));

type Mode = 'home' | 'bench' | 'code';

function modeFromHash(): Mode {
  if (location.hash.startsWith('#code')) return 'code';
  if (location.hash.startsWith('#bench')) return 'bench';
  return 'home';
}

const mode = ref<Mode>(modeFromHash());

function setMode(m: Mode) {
  if (mode.value === m) return;
  mode.value = m;
  // CodeView restores its own #code/example-id deep link on activation
  history.replaceState(null, '', m === 'home' ? '#' : '#' + m);
}

window.addEventListener('hashchange', () => {
  const m = modeFromHash();
  if (m !== mode.value) mode.value = m;
});
</script>

<template>
  <div class="rig">
    <header>
      <div class="brand" @click="setMode('home')" role="button" tabindex="0">
        <h1>BELL<b>O</b>WS</h1>
        <span class="tag">audio engine workbench // every forge needs one</span>
      </div>
      <nav class="modes">
        <button :class="{ lit: mode === 'bench' }" @click="setMode('bench')">WORKBENCH</button>
        <button :class="{ lit: mode === 'code' }" @click="setMode('code')">CODE</button>
        <button class="theme-btn" @click="toggleTheme()" :title="theme === 'light' ? 'switch to night forge' : 'switch to daylight'">
          {{ theme === 'light' ? 'NIGHT' : 'DAY' }}
        </button>
      </nav>
      <div class="serial">
        <span class="lamp-dot" :class="{ hot: booted }"></span>BLW-01 REV B // BELLOWSJS 0.1<br />
        <span>bellows.live // library live</span>
      </div>
    </header>

    <LandingView v-if="mode === 'home'" @go="setMode" />
    <KeepAlive v-else>
      <WorkbenchView v-if="mode === 'bench'" />
      <CodeView v-else />
    </KeepAlive>

    <footer>
      <span>
        built by Moheeb Zara
        <a href="https://github.com/virgilvox" target="_blank" rel="noopener">@virgilvox</a>
        // <a href="https://hack.build" target="_blank" rel="noopener">hack.build</a>
      </span>
      <span>
        <a href="https://www.npmjs.com/package/bellowsjs" target="_blank" rel="noopener">npm</a>
        // <a href="https://github.com/virgilvox/bellowsjs" target="_blank" rel="noopener">github</a>
        // apache-2.0
      </span>
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
  cursor: pointer;
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

.theme-btn {
  font-family: var(--mono);
  font-weight: 400;
  padding: 9px 12px;
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
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

footer a {
  color: var(--tick);
  text-decoration: none;
  border-bottom: 1px dotted var(--seam);
}

footer a:hover {
  color: var(--phosphor);
}

footer .badges span {
  border: 1px solid var(--seam);
  padding: 2px 6px;
  margin-left: 6px;
}
</style>

<script setup lang="ts">
import { ref, defineAsyncComponent } from 'vue';
import { booted } from './lib/audio';
import { theme, toggleTheme } from './lib/theme';
import LandingView from './views/LandingView.vue';

const WorkbenchView = defineAsyncComponent(() => import('./views/WorkbenchView.vue'));
const CodeView = defineAsyncComponent(() => import('./views/CodeView.vue'));
const InstrumentView = defineAsyncComponent(() => import('./views/InstrumentView.vue'));
const RefView = defineAsyncComponent(() => import('./views/RefView.vue'));

type Mode = 'home' | 'bench' | 'code' | 'play' | 'ref';

function modeFromHash(): Mode {
  if (location.hash.startsWith('#code')) return 'code';
  if (location.hash.startsWith('#bench')) return 'bench';
  if (location.hash.startsWith('#play')) return 'play';
  if (location.hash.startsWith('#ref')) return 'ref';
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
        <button :class="{ lit: mode === 'play' }" @click="setMode('play')">INSTRUMENT</button>
        <button :class="{ lit: mode === 'code' }" @click="setMode('code')">CODE</button>
        <button :class="{ lit: mode === 'ref' }" @click="setMode('ref')">LLM REF</button>
        <button class="theme-btn" @click="toggleTheme()" :title="theme === 'light' ? 'switch to night forge' : 'switch to daylight'">
          {{ theme === 'light' ? 'NIGHT' : 'DAY' }}
        </button>
        <a class="gh-link" href="https://github.com/virgilvox/bellowsjs" target="_blank" rel="noopener" title="source on github" aria-label="source on github">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
      </nav>
      <div class="serial">
        <span class="lamp-dot" :class="{ hot: booted }"></span>made by Moheeb Zara<br />
        <span>
          <a href="https://github.com/virgilvox" target="_blank" rel="noopener">@virgilvox</a>
          // <a href="https://hack.build" target="_blank" rel="noopener">hack.build</a>
        </span>
      </div>
    </header>

    <LandingView v-if="mode === 'home'" @go="setMode" />
    <KeepAlive v-else>
      <WorkbenchView v-if="mode === 'bench'" />
      <InstrumentView v-else-if="mode === 'play'" />
      <RefView v-else-if="mode === 'ref'" />
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

.gh-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
  background: var(--char);
  border: 2px solid var(--seam);
  box-shadow: var(--shadow-sm);
  color: var(--bone);
  transition: transform 0.06s ease, border-color 0.12s, color 0.12s;
}

.gh-link:hover {
  transform: translateY(-1px);
  border-color: var(--phosphor);
  color: var(--phosphor);
}

.serial {
  font-size: 10px;
  color: var(--faded);
  letter-spacing: 0.14em;
  text-align: right;
  margin-left: auto;
}

.serial a {
  color: var(--tick);
  text-decoration: none;
  border-bottom: 1px dotted var(--seam);
}

.serial a:hover {
  color: var(--phosphor);
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

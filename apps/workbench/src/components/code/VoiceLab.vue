<script setup lang="ts">
/*
 * The voice lab: everything bellows-voice does, from controls instead of code. Text and an accent
 * go through the same calls a page makes (singer().sing or speak, toIPA, pronounce); every voice
 * param is a slider generated from the engine's own description (VOCAL_ENGINE_INFO), so a param
 * added to the voice appears here without touching this file; and the mouth follows the plan the
 * line returned, through the voice's own geometry (bellows-voice/view). SHOW CODE writes the
 * settings out as a Code mode example.
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import type { Bellows, ParamSpec } from 'bellowsjs';
import {
  ACCENTS,
  VOCAL_ENGINE_INFO,
  VOCAL_PHONEMES,
  pronounce,
  singer as makeSinger,
  toIPA,
  type SingNote,
  type Singer,
} from 'bellows-voice';
import { TractModel, type TractShape } from 'bellows-voice/view';
import { ensureBellows } from '../../lib/audio';
import { formatValue, fromSlider, toSlider } from '../../lib/instrument-store';
import MouthView from './MouthView.vue';

/* ---- what can be set ---- */

const REGIONS: Array<[string, string[]]> = [
  ['North America', ['general-american', 'canadian', 'californian', 'new-york', 'southern-us']],
  ['Britain and Ireland', ['southern-british', 'london', 'northern-english', 'geordie', 'scottish', 'welsh', 'irish', 'northern-irish']],
  ['Southern hemisphere', ['australian', 'new-zealand', 'south-african']],
  ['Africa, Asia, the Caribbean', ['nigerian', 'jamaican', 'indian', 'singaporean']],
];

/* the params a line drives itself; the lab does not offer them */
const DRIVEN = new Set(['phoneme', 'bend', 'nextPhoneme', 'nextIn']);
const GROUPS: Array<[string, string[]]> = [
  ['BODY + SOURCE', ['body', 'glottis', 'tension', 'breath', 'roughness', 'fry']],
  ['PITCH', ['drift', 'vibratoRate', 'vibratoDepth', 'vibratoDelay', 'glide', 'overshoot', 'preparation']],
  ['TRACT', ['articulation', 'ring', 'tuning']],
  ['ENVELOPE', ['attack', 'release', 'level']],
];
const STEP_NAMES: Record<string, readonly string[]> = { glottis: ['geometric', 'self-oscillating', 'pulse'] };

const specs: ParamSpec[] = VOCAL_ENGINE_INFO.params.filter((p) => !DRIVEN.has(p.name));
const specByName = new Map(specs.map((p) => [p.name, p]));
const grouped = computed(() => {
  const seen = new Set<string>();
  const out: Array<[string, ParamSpec[]]> = GROUPS.map(([title, names]) => {
    const list = names.map((n) => specByName.get(n)).filter((p): p is ParamSpec => !!p);
    list.forEach((p) => seen.add(p.name));
    return [title, list];
  });
  const rest = specs.filter((p) => !seen.has(p.name));
  if (rest.length) out.push(['OTHER', rest]);
  return out.filter(([, list]) => list.length > 0);
});

const TEXTS = [
  'The water in the bath was far too hot.',
  'Good morning. Where are you from?',
  'Twinkle twinkle little star, how I wonder what you are.',
  'I thought I saw a cat on the mat by the car.',
  'Hello, my name is Bellows. I can sing, and I can speak.',
];
const KEYWORDS = 'kit dress trap lot strut foot bath cloth nurse fleece face palm thought goat goose price choice mouth near square start north';

const MELODIES: Array<[string, string]> = [
  ['scale up and back', 'C3 D3 E3 F3 G3 F3 E3 D3 C3:2'],
  ['twinkle', 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2'],
  ['monotone', 'A3'],
  ['arpeggio', 'C4 E4 G4 C5 G4 E4'],
];

const state = reactive({
  mode: 'sing' as 'sing' | 'speak',
  text: TEXTS[0],
  accent: 'general-american',
  melody: MELODIES[0][1],
  beat: 0.35,
  hz: 115,
  rate: 1,
  params: Object.fromEntries(specs.map((p) => [p.name, p.default])) as Record<string, number>,
  showCode: false,
  status: '',
});

/* ---- what the text becomes ---- */

const ipa = computed(() => {
  try {
    return toIPA(state.text, { accent: state.accent });
  } catch (e) {
    return String(e);
  }
});
const syllableCount = computed(() => {
  try {
    return pronounce(state.text, { accent: state.accent }).syllables.filter((s) => !s.melisma).length;
  } catch {
    return 0;
  }
});
const accent = computed(() => ACCENTS[state.accent]);
const accentFacts = computed(() => {
  const a = accent.value;
  if (!a) return [];
  const p = a.prosody;
  return [
    a.rhotic ? 'rhotic' : 'non-rhotic',
    't ' + a.t,
    'l ' + a.l,
    'th ' + a.th,
    'r ' + a.r,
    ...(a.hDrop ? ['h dropped'] : []),
    ...(a.raised ? ['raising'] : []),
    ...(p ? [p.tune + ' at the end', 'range ' + p.range + ' st', 'rate ' + p.rate, 'stress ratio ' + (p.stressRatio ?? 2)] : []),
  ];
});

/** The melody laid over the syllables: tokens "C4" or "C4:2" (beats), cycled to fit. */
function melodyNotes(): SingNote[] {
  const tokens = state.melody.trim().split(/\s+/).filter(Boolean);
  const list = tokens.length ? tokens : ['A3'];
  const n = Math.max(1, syllableCount.value);
  const notes: SingNote[] = [];
  for (let i = 0; i < n; i++) {
    const [name, mul] = list[i % list.length].split(':');
    const beats = (Number(mul) > 0 ? Number(mul) : 1) * (i === n - 1 ? 2 : 1);
    notes.push({ note: name, dur: { seconds: beats * state.beat } });
  }
  notes.push({ note: null, dur: { seconds: 0.4 } });
  return notes;
}

/* ---- sound ---- */

let b: Bellows | null = null;
let voiceSinger: Singer | null = null;
let spans: Array<{ ipa: string; start: number; end: number }> = [];
let held: { id: number; ipa: string } | null = null;

async function ready(): Promise<Singer> {
  const next = await ensureBellows();
  // a context made before any gesture stays suspended; every press here is a gesture
  const ctx = next.ctx as AudioContext;
  if (ctx.state === 'suspended') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
  if (next !== b || !voiceSinger || voiceSinger.instrument.disposed) {
    b = next;
    voiceSinger = makeSinger(b, { ...state.params }, { accent: state.accent });
    const room = b.bus(['plate'], { level: 0.25 });
    voiceSinger.send(room, 0.25);
  }
  voiceSinger.accent = state.accent;
  return voiceSinger;
}

async function play(): Promise<void> {
  const s = await ready();
  const result =
    state.mode === 'sing'
      ? s.sing(state.text, melodyNotes())
      : s.speak(state.text, { accent: state.accent, hz: state.hz, rate: state.rate });
  spans = result.phrases.flatMap((p) => p.spans.map((sp) => ({ ipa: sp.ipa, start: sp.start, end: sp.end })));
  const end = spans.length ? spans[spans.length - 1].end : 0;
  const len = end - (spans[0]?.start ?? end);
  state.status =
    `${result.phrases.length} phrase${result.phrases.length === 1 ? '' : 's'}, ${len.toFixed(2)} s` +
    (result.unknown.length ? `; no sound for ${result.unknown.join(' ')}` : '') +
    (result.trimmed > 0 ? `; ${Math.round(result.trimmed * 1000)} ms cut by the line before` : '');
}

function stop(): void {
  voiceSinger?.instrument.allOff();
  spans = [];
}

function setParam(name: string, value: number): void {
  state.params[name] = value;
  voiceSinger?.param(name, value);
  if (name === 'body') tract.setBody(value);
}

function onSlide(spec: ParamSpec, e: Event): void {
  const v = fromSlider(spec, (e.target as HTMLInputElement).valueAsNumber);
  setParam(spec.name, STEP_NAMES[spec.name] ? Math.round(v) : v);
}

function resetParams(): void {
  for (const p of specs) setParam(p.name, p.default);
}

/** Hold one sound: the voice sustains it and the mouth takes its shape. */
async function holdPhoneme(p: string): Promise<void> {
  const s = await ready();
  release();
  s.param('phoneme', VOCAL_PHONEMES.indexOf(p as (typeof VOCAL_PHONEMES)[number]));
  held = { id: s.on({ hz: state.mode === 'speak' ? state.hz : 196 }, 0.8), ipa: p };
}

function release(): void {
  if (held && voiceSinger) voiceSinger.off(held.id);
  held = null;
}

/* ---- the mouth ---- */

const tract = new TractModel(state.params.body ?? 0);
const shape = shallowRef<TractShape | null>(null);
const phoneme = ref('_');
const bounds = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

function measureBounds(): void {
  const probe = new TractModel(state.params.body ?? 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ['ɑ', 'i', 'u', 'm', 'ə']) {
    probe.target(p);
    probe.settle();
    const s = probe.shape();
    for (const line of [s.lower, s.upper]) {
      for (let i = 0; i < line.length; i += 2) {
        x0 = Math.min(x0, line[i]);
        x1 = Math.max(x1, line[i]);
        y0 = Math.min(y0, line[i + 1]);
        y1 = Math.max(y1, line[i + 1]);
      }
    }
  }
  const m = 1;
  bounds.value = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + 3 };
}

let raf = 0;
let last = 0;
function frame(now: number): void {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  let want = '_';
  if (held) want = held.ipa;
  else if (b && spans.length) {
    const ctx = b.ctx as AudioContext;
    const t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const sp = spans.find((x) => t >= x.start && t < x.end);
    if (sp) want = sp.ipa;
    else if (t > spans[spans.length - 1].end) spans = [];
  }
  if (want !== tract.current) tract.target(want);
  tract.step(dt);
  phoneme.value = want;
  shape.value = tract.shape();
  raf = requestAnimationFrame(frame);
}

watch(
  () => state.params.body,
  () => measureBounds(),
);

onMounted(() => {
  measureBounds();
  tract.settle();
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  release();
  stop();
});

/* ---- the same thing as code ---- */

const code = computed(() => {
  const changed = specs
    .filter((p) => Math.abs((state.params[p.name] ?? p.default) - p.default) > 1e-9)
    .map((p) => `${p.name}: ${Number(state.params[p.name].toFixed(3))}`);
  const params = changed.length ? `{ ${changed.join(', ')} }` : '{}';
  const lines = [
    `var singer = lib.singer(b, ${params}, { accent: '${state.accent}' });`,
    `var room = b.bus(['plate'], { level: 0.25 });`,
    `singer.send(room, 0.25);`,
    '',
  ];
  const text = JSON.stringify(state.text).replace(/^"|"$/g, "'").replace(/\\"/g, '"');
  if (state.mode === 'speak') {
    lines.push(`var plan = singer.speak(${text}, { hz: ${state.hz}, rate: ${state.rate} });`);
  } else {
    const notes = melodyNotes()
      .map((n) => (n.note === null ? `{ note: null, dur: { seconds: ${(n.dur as { seconds: number }).seconds} } }` : `{ note: '${n.note}', dur: { seconds: ${Number((n.dur as { seconds: number }).seconds.toFixed(3))} } }`))
      .join(',\n  ');
    lines.push(`var plan = singer.sing(${text}, [\n  ${notes},\n]);`);
  }
  lines.push(`log(lib.toIPA(${text}, { accent: '${state.accent}' }));`);
  lines.push(`log(plan.phrases.length + ' phrases, lead-in ' + Math.round(plan.leadIn * 1000) + ' ms');`);
  return lines.join('\n');
});

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(code.value);
    state.status = 'code copied';
  } catch {
    state.status = 'select the code to copy it';
  }
}
</script>

<template>
  <div class="lab">
    <div class="panel">
      <div class="panel-title">
        09 VOICE LAB
        <em>bellows-voice // {{ Object.keys(ACCENTS).length }} accents</em>
      </div>

      <div class="row">
        <div class="seg">
          <button :class="{ lit: state.mode === 'sing' }" @click="state.mode = 'sing'">SING</button>
          <button :class="{ lit: state.mode === 'speak' }" @click="state.mode = 'speak'">SPEAK</button>
        </div>
        <label class="inline">
          ACCENT
          <select v-model="state.accent">
            <optgroup v-for="[region, ids] in REGIONS" :key="region" :label="region">
              <option v-for="id in ids" :key="id" :value="id">{{ ACCENTS[id]?.name ?? id }}</option>
            </optgroup>
          </select>
        </label>
      </div>

      <textarea v-model="state.text" rows="3" spellcheck="false" aria-label="text to sing or speak"></textarea>
      <div class="chips">
        <button v-for="t in TEXTS" :key="t" class="chip" @click="state.text = t">{{ t.slice(0, 26) }}{{ t.length > 26 ? '...' : '' }}</button>
        <button class="chip" @click="state.text = KEYWORDS">the lexical sets</button>
      </div>

      <div class="ipa">
        <span class="lbl">IPA</span>
        <span class="val">{{ ipa }}</span>
      </div>
      <div class="facts">
        <span v-for="f in accentFacts" :key="f">{{ f }}</span>
      </div>

      <div v-if="state.mode === 'sing'" class="row">
        <label class="grow">
          MELODY <em>note or note:beats, cycled over {{ syllableCount }} syllables</em>
          <input v-model="state.melody" spellcheck="false" />
        </label>
        <label class="inline">
          PRESET
          <select @change="state.melody = ($event.target as HTMLSelectElement).value">
            <option v-for="[name, m] in MELODIES" :key="name" :value="m" :selected="m === state.melody">{{ name }}</option>
          </select>
        </label>
        <label class="inline">
          BEAT {{ state.beat.toFixed(2) }} s
          <input v-model.number="state.beat" type="range" min="0.12" max="1" step="0.01" />
        </label>
      </div>
      <div v-else class="row">
        <label class="inline">
          PITCH {{ state.hz }} Hz
          <input v-model.number="state.hz" type="range" min="70" max="320" step="1" />
        </label>
        <label class="inline">
          RATE {{ state.rate.toFixed(2) }}
          <input v-model.number="state.rate" type="range" min="0.5" max="1.8" step="0.01" />
        </label>
      </div>

      <div class="control-row">
        <button class="big" @click="play">{{ state.mode === 'sing' ? 'SING' : 'SPEAK' }}</button>
        <button class="big" @click="stop">STOP</button>
        <button @click="state.showCode = !state.showCode">{{ state.showCode ? 'HIDE' : 'SHOW' }} CODE</button>
        <span class="status">{{ state.status }}</span>
      </div>
      <div v-if="state.showCode" class="code">
        <pre>{{ code }}</pre>
        <button @click="copyCode">COPY</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        10 MOUTH
        <em>the voice's own geometry, following the line</em>
      </div>
      <MouthView :shape="shape" :phoneme="phoneme" :bounds="bounds" />
      <p class="hint">Hold a sound to hear it and see its shape:</p>
      <div class="pads">
        <button
          v-for="p in VOCAL_PHONEMES.filter((x) => x !== '_')"
          :key="p"
          class="pad"
          @pointerdown="holdPhoneme(p)"
          @pointerup="release"
          @pointerleave="release"
        >
          {{ p }}
        </button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        11 VOICE
        <em>every param of the vocal engine</em>
        <button class="reset" @click="resetParams">reset</button>
      </div>
      <div v-for="[title, list] in grouped" :key="title" class="group">
        <div class="group-title">{{ title }}</div>
        <div class="grid">
          <div v-for="spec in list" :key="spec.name" class="field">
            <label>{{ spec.name }}</label>
            <div class="slider-row">
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                :value="toSlider(spec, state.params[spec.name] ?? spec.default)"
                @input="onSlide(spec, $event)"
              />
              <output>{{ formatValue(spec, state.params[spec.name] ?? spec.default, STEP_NAMES[spec.name] ?? null) }}</output>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lab {
  display: grid;
  gap: 16px;
}
.row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin: 10px 0;
}
.seg {
  display: flex;
  gap: 4px;
}
.seg button {
  font-family: var(--disp);
  font-weight: 700;
  padding: 7px 16px;
}
label {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--faded);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
label em {
  font-style: normal;
  letter-spacing: 0;
  color: var(--tick);
}
label.grow {
  flex: 1;
  min-width: 220px;
}
select,
input:not([type='range']),
textarea {
  background: var(--iron);
  border: 1px solid var(--seam);
  color: var(--bone);
  font-family: var(--mono);
  font-size: 12px;
  padding: 6px 8px;
}
textarea {
  text-transform: none;
  width: 100%;
  resize: vertical;
  font-size: 14px;
  margin-top: 6px;
}
.chips,
.facts,
.pads {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.chip {
  font-size: 10px;
  padding: 3px 8px;
  box-shadow: none;
}
.facts span {
  border: 1px solid var(--seam);
  padding: 2px 6px;
  font-size: 10px;
  color: var(--faded);
}
.ipa {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--char);
  border: 1px solid var(--seam);
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.ipa .lbl {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--faded);
}
.ipa .val {
  text-transform: none;
  font-size: 18px;
  color: var(--phosphor-hot);
  line-height: 1.5;
  word-break: break-word;
}
.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.control-row .big {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  padding: 9px 22px;
}
.status {
  font-size: 11px;
  color: var(--tick);
}
.code {
  margin-top: 10px;
}
.code pre {
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  max-height: 40vh;
  margin-bottom: 6px;
}
.hint {
  font-size: 11px;
  color: var(--tick);
  margin-top: 10px;
}
.pad {
  /* IPA is case-sensitive: an uppercased ɑ or ð is a different letter */
  text-transform: none;
  font-family: var(--mono);
  min-width: 34px;
  font-size: 14px;
  padding: 5px 6px;
  touch-action: none;
}
.group {
  margin-top: 8px;
}
.group-title {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--phosphor);
  margin: 6px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  column-gap: 16px;
}
.reset {
  font-size: 9px;
  padding: 3px 8px;
  box-shadow: none;
  margin-left: auto;
}
</style>

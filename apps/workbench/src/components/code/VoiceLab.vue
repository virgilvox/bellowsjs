<script setup lang="ts">
/*
 * The voice lab: everything bellows-voice does, from controls instead of code, laid out as the
 * three questions a line answers. WHO sings (male, female or child, and a starter voice from
 * VOICE_PRESETS, each with its range and speaking pitch from published norms). WHAT it says (sing
 * or speak, the text). HOW it says it (one of the accents, with the IPA it will produce). The
 * engine's params sit folded under FINE TUNE, generated from VOCAL_ENGINE_INFO so a param added to
 * the voice appears without touching this file; the mouth follows the line through the voice's own
 * geometry (bellows-voice/view); SHOW CODE writes the settings out as a Code mode example.
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { parseNote, type Bellows, type ParamSpec } from 'bellowsjs';
import {
  ACCENTS,
  ACCENT_REGIONS,
  SPEECH_HZ_BY_BODY,
  VOCAL_ENGINE_INFO,
  VOCAL_PHONEMES,
  VOICE_PRESETS,
  pronounce,
  singer as makeSinger,
  toIPA,
  type SingNote,
  type Singer,
  type VoiceGroup,
  type VoicePreset,
} from 'bellows-voice';
import { TractModel, type TractShape } from 'bellows-voice/view';
import { ensureBellows } from '../../lib/audio';
import { formatValue, fromSlider, toSlider } from '../../lib/instrument-store';
import MouthView from './MouthView.vue';

/* ---- what can be set ---- */

const GROUPS: Array<[VoiceGroup, string, number]> = [
  ['male', 'MALE', 0],
  ['female', 'FEMALE', 1],
  ['child', 'CHILD', 2],
];

const accentGroups = computed(() =>
  ACCENT_REGIONS.map((region) => [region, Object.values(ACCENTS).filter((a) => a.region === region)] as const),
);

/* the params a line drives itself; the lab does not offer them */
const DRIVEN = new Set(['phoneme', 'bend', 'nextPhoneme', 'nextIn']);
const PARAM_GROUPS: Array<[string, string[]]> = [
  ['BODY + SOURCE', ['body', 'glottis', 'tension', 'breath', 'roughness', 'fry']],
  ['PITCH', ['drift', 'vibratoRate', 'vibratoDepth', 'vibratoDelay', 'glide', 'overshoot', 'preparation']],
  ['TRACT', ['articulation', 'ring', 'tuning']],
  ['ENVELOPE', ['attack', 'release', 'level']],
];
const STEP_NAMES: Record<string, readonly string[]> = { glottis: ['geometric', 'self-oscillating', 'pulse'] };

const specs: ParamSpec[] = VOCAL_ENGINE_INFO.params.filter((p) => !DRIVEN.has(p.name));
const specByName = new Map(specs.map((p) => [p.name, p]));
const defaults = (): Record<string, number> => Object.fromEntries(specs.map((p) => [p.name, p.default]));
const grouped = computed(() => {
  const seen = new Set<string>();
  const out: Array<[string, ParamSpec[]]> = PARAM_GROUPS.map(([title, names]) => {
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
  ['scale up and back', 'C4 D4 E4 F4 G4 F4 E4 D4 C4:2'],
  ['twinkle', 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2'],
  ['arpeggio', 'C4 E4 G4 C5 G4 E4'],
  ['one note', 'A4'],
];

const state = reactive({
  group: 'female' as VoiceGroup,
  presetId: 'narrator-female' as string | null,
  mode: 'speak' as 'sing' | 'speak',
  text: TEXTS[1],
  accent: 'general-american',
  melody: MELODIES[0][1],
  beat: 0.35,
  fitRange: true,
  hz: 199,
  rate: 1,
  params: { ...defaults(), ...VOICE_PRESETS.find((v) => v.id === 'narrator-female')!.params } as Record<string, number>,
  showCode: false,
  status: '',
});

const presetsInGroup = computed(() => VOICE_PRESETS.filter((v) => v.group === state.group));
const preset = computed(() => (state.presetId ? VOICE_PRESETS.find((v) => v.id === state.presetId) ?? null : null));
const edited = computed(() => {
  const p = preset.value;
  if (!p) return true;
  const want = { ...defaults(), ...p.params };
  return specs.some((s) => Math.abs((state.params[s.name] ?? s.default) - (want[s.name] ?? s.default)) > 1e-9);
});

/** Choose a starter voice: its params over the defaults, its speaking pitch. */
function choosePreset(p: VoicePreset): void {
  state.presetId = p.id;
  state.group = p.group;
  const next = { ...defaults(), ...p.params };
  for (const s of specs) setParam(s.name, next[s.name] ?? s.default);
  state.hz = p.speechHz;
}

/** Choose male, female or child: the group's first voice. */
function chooseGroup(g: VoiceGroup): void {
  state.group = g;
  const first = VOICE_PRESETS.find((v) => v.group === g);
  if (first) choosePreset(first);
  else {
    state.presetId = null;
    const body = GROUPS.find(([id]) => id === g)![2];
    setParam('body', body);
    state.hz = SPEECH_HZ_BY_BODY[body];
  }
}

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
    a.rhotic ? 'says r after vowels' : 'drops r after vowels',
    't ' + a.t,
    'l ' + a.l,
    'th ' + a.th,
    ...(a.r === 'tap' ? ['tapped r'] : []),
    ...(a.hDrop ? ['drops h'] : []),
    ...(a.raised ? ['raising'] : []),
    ...(p ? [p.tune === 'rise' ? 'statements rise' : 'statements fall', (p.stressRatio ?? 2) < 1.6 ? 'syllable-timed' : 'stress-timed'] : []),
  ];
});

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/** The melody laid over the syllables: tokens "C4" or "C4:2" (beats), cycled to fit, moved by octaves into the voice's range. */
function melodyNotes(): SingNote[] {
  const tokens = state.melody.trim().split(/\s+/).filter(Boolean);
  const list = (tokens.length ? tokens : ['A4']).map((t) => {
    const [name, mul] = t.split(':');
    let midi = 69;
    try {
      midi = parseNote(name);
    } catch {
      // an unreadable token sings A4
    }
    return { midi, beats: Number(mul) > 0 ? Number(mul) : 1 };
  });
  let shift = 0;
  const p = preset.value;
  if (state.fitRange && p) {
    const sorted = list.map((x) => x.midi).sort((a, c) => a - c);
    const median = sorted[Math.floor(sorted.length / 2)];
    const centre = (p.range[0] + p.range[1]) / 2;
    shift = 12 * Math.round((centre - median) / 12);
  }
  const n = Math.max(1, syllableCount.value);
  const notes: SingNote[] = [];
  for (let i = 0; i < n; i++) {
    const t = list[i % list.length];
    notes.push({ note: t.midi + shift, dur: { seconds: t.beats * state.beat * (i === n - 1 ? 2 : 1) } });
  }
  notes.push({ note: null, dur: { seconds: 0.4 } });
  return notes;
}

const melodyRange = computed(() => {
  const ms = melodyNotes().filter((n) => n.note !== null).map((n) => n.note as number);
  return ms.length ? `${noteName(Math.min(...ms))} to ${noteName(Math.max(...ms))}` : '';
});

/* ---- sound ---- */

let b: Bellows | null = null;
let voiceSinger: Singer | null = null;
let spans: Array<{ ipa: string; start: number; end: number }> = [];
let held: { id: number; ipa: string } | null = null;
const playing = ref(false);

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
  playing.value = spans.length > 0;
  state.status =
    `${len.toFixed(1)} s, ${result.phrases.length} phrase${result.phrases.length === 1 ? '' : 's'}` +
    (result.unknown.length ? `; no sound for ${result.unknown.join(' ')}` : '');
}

function stop(): void {
  voiceSinger?.instrument.allOff();
  spans = [];
  playing.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void play();
  }
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
  if (preset.value) choosePreset(preset.value);
  else for (const p of specs) setParam(p.name, p.default);
}

/** Hold one sound: the voice sustains it and the mouth takes its shape. */
async function holdPhoneme(p: string): Promise<void> {
  const s = await ready();
  release();
  s.param('phoneme', VOCAL_PHONEMES.indexOf(p as (typeof VOCAL_PHONEMES)[number]));
  held = { id: s.on({ hz: state.hz }, 0.8), ipa: p };
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
  bounds.value = { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 3 };
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
    else if (t > spans[spans.length - 1].end) {
      spans = [];
      playing.value = false;
    }
  }
  if (want !== tract.current) tract.target(want);
  tract.step(dt);
  phoneme.value = want;
  shape.value = tract.shape();
  raf = requestAnimationFrame(frame);
}

watch(
  () => Math.round(state.params.body ?? 0),
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
  const p = preset.value;
  let voiceArg: string;
  if (p && !edited.value) voiceArg = `'${p.id}'`;
  else {
    const changed = specs
      .filter((s) => Math.abs((state.params[s.name] ?? s.default) - s.default) > 1e-9)
      .map((s) => `${s.name}: ${Number(state.params[s.name].toFixed(3))}`);
    voiceArg = changed.length ? `{ ${changed.join(', ')} }` : '{}';
  }
  const lines = [
    `var singer = lib.singer(b, ${voiceArg}, { accent: '${state.accent}' });`,
    `var room = b.bus(['plate'], { level: 0.25 });`,
    `singer.send(room, 0.25);`,
    '',
  ];
  const text = "'" + state.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (state.mode === 'speak') {
    lines.push(`var plan = singer.speak(${text}, { hz: ${state.hz}, rate: ${state.rate} });`);
  } else {
    const notes = melodyNotes()
      .map((n) => {
        const sec = Number((n.dur as { seconds: number }).seconds.toFixed(3));
        return n.note === null ? `{ note: null, dur: { seconds: ${sec} } }` : `{ note: '${noteName(n.note as number)}', dur: { seconds: ${sec} } }`;
      })
      .join(',\n  ');
    lines.push(`var plan = singer.sing(${text}, [\n  ${notes},\n]);`);
  }
  lines.push(`log(lib.toIPA(${text}, { accent: '${state.accent}' }));`);
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
        <em>{{ VOICE_PRESETS.length }} voices // {{ Object.keys(ACCENTS).length }} accents</em>
      </div>

      <!-- WHO -->
      <div class="step"><span class="n">1</span> WHO SINGS</div>
      <div class="seg wide">
        <button v-for="[g, label] in GROUPS" :key="g" :class="{ lit: state.group === g }" @click="chooseGroup(g)">{{ label }}</button>
      </div>
      <div class="cards">
        <button
          v-for="p in presetsInGroup"
          :key="p.id"
          class="card"
          :class="{ lit: state.presetId === p.id }"
          @click="choosePreset(p)"
        >
          <span class="card-name">{{ p.name }}</span>
          <span class="card-meta">{{ noteName(p.range[0]) }} to {{ noteName(p.range[1]) }} // speaks {{ p.speechHz }} Hz</span>
          <span class="card-desc">{{ p.description }}</span>
        </button>
      </div>
      <p v-if="edited && preset" class="hint">fine-tuned from {{ preset.name }}</p>

      <!-- WHAT -->
      <div class="step"><span class="n">2</span> WHAT IT SAYS</div>
      <div class="row">
        <div class="seg">
          <button :class="{ lit: state.mode === 'speak' }" @click="state.mode = 'speak'">SPEAK</button>
          <button :class="{ lit: state.mode === 'sing' }" @click="state.mode = 'sing'">SING</button>
        </div>
        <span class="hint">Ctrl or Cmd + Enter plays</span>
      </div>
      <textarea v-model="state.text" rows="2" spellcheck="false" aria-label="text to sing or speak" @keydown="onKey"></textarea>
      <div class="chips">
        <button v-for="t in TEXTS" :key="t" class="chip" @click="state.text = t">{{ t.slice(0, 24) }}{{ t.length > 24 ? '...' : '' }}</button>
        <button class="chip" @click="state.text = KEYWORDS">the lexical sets</button>
      </div>

      <!-- HOW -->
      <div class="step"><span class="n">3</span> HOW IT SAYS IT</div>
      <div class="row">
        <label class="inline">
          ACCENT
          <select v-model="state.accent">
            <optgroup v-for="[region, list] in accentGroups" :key="region" :label="region">
              <option v-for="a in list" :key="a.id" :value="a.id">{{ a.name }}</option>
            </optgroup>
          </select>
        </label>
        <template v-if="state.mode === 'speak'">
          <label class="inline">
            PITCH {{ state.hz }} Hz
            <input v-model.number="state.hz" type="range" min="70" max="320" step="1" />
          </label>
          <label class="inline">
            RATE {{ state.rate.toFixed(2) }}
            <input v-model.number="state.rate" type="range" min="0.5" max="1.8" step="0.01" />
          </label>
        </template>
        <template v-else>
          <label class="inline">
            TUNE
            <select @change="state.melody = ($event.target as HTMLSelectElement).value">
              <option v-for="[name, m] in MELODIES" :key="name" :value="m" :selected="m === state.melody">{{ name }}</option>
            </select>
          </label>
          <label class="inline">
            TEMPO {{ state.beat.toFixed(2) }} s a note
            <input v-model.number="state.beat" type="range" min="0.12" max="1" step="0.01" />
          </label>
        </template>
      </div>
      <div v-if="state.mode === 'sing'" class="row">
        <label class="grow">
          MELODY <em>note or note:beats, repeated over {{ syllableCount }} syllables, sung {{ melodyRange }}</em>
          <input v-model="state.melody" spellcheck="false" />
        </label>
        <label class="check">
          <input v-model="state.fitRange" type="checkbox" /> move into the voice's range
        </label>
      </div>
      <div class="ipa">
        <span class="lbl">IPA</span>
        <span class="val">{{ ipa }}</span>
      </div>
      <div class="facts">
        <span v-for="f in accentFacts" :key="f">{{ f }}</span>
      </div>

      <div class="control-row">
        <button class="big play" :class="{ lit: playing }" @click="play">{{ state.mode === 'sing' ? 'SING' : 'SPEAK' }}</button>
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
      <details class="pads-box">
        <summary>HOLD ANY SOUND: hear it alone and see its shape</summary>
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
      </details>
    </div>

    <details class="panel fine">
      <summary class="panel-title">
        11 FINE TUNE
        <em>every param of the vocal engine</em>
      </summary>
      <div class="fine-head">
        <button class="reset" @click="resetParams">{{ preset ? 'BACK TO ' + preset.name.toUpperCase() : 'RESET' }}</button>
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
    </details>
  </div>
</template>

<style scoped>
.lab {
  display: grid;
  gap: 16px;
}
.step {
  margin: 16px 0 8px;
  font-family: var(--disp);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--phosphor);
  display: flex;
  align-items: center;
  gap: 8px;
}
.step .n {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--phosphor);
  font-size: 11px;
}
.row {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin: 8px 0;
}
.seg {
  display: flex;
  gap: 4px;
}
.seg.wide button {
  flex: 1;
  max-width: 160px;
}
.seg button {
  font-family: var(--disp);
  font-weight: 700;
  padding: 7px 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  text-align: left;
  padding: 9px 10px;
  text-transform: none;
}
.card-name {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.card-meta {
  font-size: 10px;
  opacity: 0.8;
}
.card-desc {
  font-size: 10.5px;
  line-height: 1.4;
  opacity: 0.75;
  letter-spacing: 0;
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
  min-width: 240px;
}
label.check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  letter-spacing: 0.04em;
}
select,
input:not([type='range']):not([type='checkbox']),
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
  font-size: 15px;
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
  margin-top: 14px;
}
.control-row .big {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  padding: 10px 24px;
}
.control-row .play {
  min-width: 140px;
  font-size: 14px;
}
.status,
.hint {
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
  text-transform: none;
}
.pads-box {
  margin-top: 10px;
}
.pads-box summary {
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--tick);
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
.fine summary {
  cursor: pointer;
  list-style: none;
}
.fine-head {
  display: flex;
  justify-content: flex-end;
  margin: 6px 0;
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
}
</style>

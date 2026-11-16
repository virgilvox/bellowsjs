<script setup lang="ts">
/*
 * The voice lab: everything bellows-voice does, from controls instead of code. docs/VOICE-LAB-UX.md
 * has the walkthrough this layout answers: a stage that stays in view (play, the mouth, the line as
 * it plays, the IPA) beside the controls, taken in the order a line is made (the voice, the words,
 * the accent, the tune or delivery), every term in plain words, and the code for both Code mode and
 * an app. The engine's params are generated from VOCAL_ENGINE_INFO, so a param added to the voice
 * appears here; the mouth runs the voice's own geometry (bellows-voice/view).
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
  type Accent,
  type SingNote,
  type Singer,
  type VoiceGroup,
  type VoicePreset,
} from 'bellows-voice';
import { TractModel, type TractShape } from 'bellows-voice/view';
import { ensureBellows } from '../../lib/audio';
import { formatValue, fromSlider, toSlider } from '../../lib/instrument-store';
import MouthView from './MouthView.vue';

/* ---- the voice ---- */

const GROUPS: Array<[VoiceGroup, string, number]> = [
  ['male', 'Male', 0],
  ['female', 'Female', 1],
  ['child', 'Child', 2],
];

/* the params a line drives itself; the lab does not offer them */
const DRIVEN = new Set(['phoneme', 'bend', 'nextPhoneme', 'nextIn']);
/* a name and a line for every param, so nobody has to know "vibratoDepth" */
const PARAM_TEXT: Record<string, [string, string]> = {
  body: ['Size', 'the tract and folds: 0 a man, 1 a woman, 2 a child, blends between'],
  glottis: ['Vocal folds', 'pulse is the default; geometric and self-oscillating are physical models'],
  tension: ['Pressed', 'soft and dark at 0, pressed and bright at 1'],
  breath: ['Breathiness', 'how far the folds rest apart, and the hiss of air through them'],
  roughness: ['Roughness', 'cycle-to-cycle unevenness; 0.02 measures as a healthy voice'],
  fry: ['Creak', 'the low rattle at the bottom of a voice'],
  drift: ['Pitch wander', 'slow drift in pitch, in cents'],
  vibratoRate: ['Vibrato speed', 'classical singers sit at 5 to 7 Hz'],
  vibratoDepth: ['Vibrato width', 'semitones either side; classical about half to one'],
  vibratoDelay: ['Vibrato delay', 'how long a note holds before the vibrato blooms'],
  glide: ['Note glide', 'how long the pitch takes to move to a new note'],
  overshoot: ['Overshoot', 'how far the pitch passes a new note before it settles'],
  preparation: ['Preparation', 'how far the pitch first dips the wrong way before a change'],
  articulation: ['Mouth speed', 'how fast the tongue, jaw and lips move; 2 is twice as quick'],
  ring: ["Singer's ring", 'the band near 3 kHz a trained voice carries with'],
  tuning: ['High-note jaw', 'opens the jaw on high notes, as sopranos do'],
  attack: ['Attack', 'how a phrase starts'],
  release: ['Release', 'how a phrase dies away'],
  level: ['Level', 'output level'],
};
const PARAM_GROUPS: Array<[string, string[]]> = [
  ['The source', ['body', 'glottis', 'tension', 'breath', 'roughness', 'fry']],
  ['Pitch and vibrato', ['drift', 'vibratoRate', 'vibratoDepth', 'vibratoDelay', 'glide', 'overshoot', 'preparation']],
  ['The mouth', ['articulation', 'ring', 'tuning']],
  ['Envelope', ['attack', 'release', 'level']],
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
  if (rest.length) out.push(['Other', rest]);
  return out.filter(([, list]) => list.length > 0);
});

/* ---- the words and the tune ---- */

const TEXTS = [
  'Good morning. Where are you from?',
  'The water in the bath was far too hot.',
  'Twinkle twinkle little star, how I wonder what you are.',
  'Hello, my name is Bellows. I can sing, and I can speak.',
  'I think this is the best day of the year.',
];
const KEYWORDS = 'kit dress trap lot strut foot bath cloth nurse fleece face palm thought goat goose price choice mouth near square start north';

const MELODIES: Array<[string, string]> = [
  ['Up and down', 'C4 D4 E4 F4 G4 F4 E4 D4 C4:2'],
  ['Twinkle', 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2'],
  ['Arpeggio', 'C4 E4 G4 C5 G4 E4'],
  ['One note', 'A4'],
];

const state = reactive({
  group: 'female' as VoiceGroup,
  presetId: 'narrator-female' as string | null,
  mode: 'speak' as 'sing' | 'speak',
  text: TEXTS[0],
  region: 'North America',
  accent: 'general-american',
  melody: MELODIES[0][1],
  bpm: 120,
  fitRange: true,
  hz: 199,
  rate: 1,
  params: { ...defaults(), ...VOICE_PRESETS.find((v) => v.id === 'narrator-female')!.params } as Record<string, number>,
  status: 'Press SPEAK IT to hear it.',
});

const presetsInGroup = computed(() => VOICE_PRESETS.filter((v) => v.group === state.group));
const preset = computed(() => (state.presetId ? VOICE_PRESETS.find((v) => v.id === state.presetId) ?? null : null));
const edited = computed(() => {
  const p = preset.value;
  if (!p) return true;
  const want = { ...defaults(), ...p.params };
  return specs.some((s) => Math.abs((state.params[s.name] ?? s.default) - (want[s.name] ?? s.default)) > 1e-9);
});

function choosePreset(p: VoicePreset): void {
  state.presetId = p.id;
  state.group = p.group;
  const next = { ...defaults(), ...p.params };
  for (const s of specs) setParam(s.name, next[s.name] ?? s.default);
  state.hz = p.speechHz;
}

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

/* ---- the accent ---- */

const accentsInRegion = computed(() => Object.values(ACCENTS).filter((a) => a.region === state.region));
const accent = computed<Accent | undefined>(() => ACCENTS[state.accent]);

function chooseRegion(r: string): void {
  state.region = r;
  const first = Object.values(ACCENTS).find((a) => a.region === r);
  if (first) state.accent = first.id;
}

/** What an accent does, as what you hear. */
const traits = computed(() => {
  const a = accent.value;
  if (!a) return [];
  const out: string[] = [];
  out.push(a.rhotic ? 'says the r in "car"' : 'drops the r in "car"');
  out.push(
    { flap: '"water" with a quick d', released: 'every t said clearly', 'glottal-coda': 'a catch for t before consonants', glottal: '"water" as wa\'er' }[a.t],
  );
  if (a.l === 'clear') out.push('a clear, bright l');
  if (a.l === 'dark') out.push('a dark l everywhere');
  if (a.l === 'vocalized') out.push('"milk" as miwk');
  if (a.th === 'stop') out.push('"think" as tink');
  if (a.th === 'front') out.push('"think" as fink');
  if (a.th === 'sibilant') out.push('"think" as sink, "this" as zis');
  if (a.r === 'tap') out.push('a tapped r');
  if (a.hDrop) out.push('drops h: "house" as ouse');
  if (a.raised) out.push('"price" and "house" start high');
  if (a.replace?.w === 'v') out.push('"west" as vest');
  if (a.devoiceFinal) out.push('"bed" as bet');
  const p = a.prosody;
  if (p) {
    out.push(p.tune === 'rise' ? 'statements end rising' : 'statements end falling');
    if ((p.stressRatio ?? 2) < 1.6) out.push('even, syllable-timed rhythm');
  }
  return out;
});

/* ---- what the text becomes ---- */

const safeIpa = (accentId: string) => {
  try {
    return toIPA(state.text, { accent: accentId });
  } catch (e) {
    return String(e);
  }
};
const ipa = computed(() => safeIpa(state.accent));
const ipaGA = computed(() => safeIpa('general-american'));
const syllableCount = computed(() => {
  try {
    return pronounce(state.text, { accent: state.accent }).syllables.filter((s) => !s.melisma).length;
  } catch {
    return 0;
  }
});

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/** The melody over the syllables: tokens "C4" or "C4:2" (beats), repeated to fit, moved by octaves into the voice's range. */
function melodyNotes(): SingNote[] {
  const beat = 60 / state.bpm;
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
    shift = 12 * Math.round(((p.range[0] + p.range[1]) / 2 - median) / 12);
  }
  const n = Math.max(1, syllableCount.value);
  const notes: SingNote[] = [];
  for (let i = 0; i < n; i++) {
    const t = list[i % list.length];
    notes.push({ note: t.midi + shift, dur: { seconds: t.beats * beat * (i === n - 1 ? 2 : 1) } });
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
const line = shallowRef<Array<{ ipa: string; start: number; end: number }>>([]);
const nowIndex = ref(-1);
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
  line.value = result.phrases.flatMap((p) => p.spans.map((sp) => ({ ipa: sp.ipa, start: sp.start, end: sp.end })));
  const spans = line.value;
  const len = spans.length ? spans[spans.length - 1].end - spans[0].start : 0;
  playing.value = spans.length > 0;
  state.status =
    `${state.mode === 'sing' ? 'Singing' : 'Speaking'}, ${len.toFixed(1)} s` +
    (result.unknown.length ? `. No sound for ${result.unknown.join(' ')}.` : '');
}

function stop(): void {
  voiceSinger?.instrument.allOff();
  playing.value = false;
  nowIndex.value = -1;
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
    for (const ln of [s.lower, s.upper]) {
      for (let i = 0; i < ln.length; i += 2) {
        x0 = Math.min(x0, ln[i]);
        x1 = Math.max(x1, ln[i]);
        y0 = Math.min(y0, ln[i + 1]);
        y1 = Math.max(y1, ln[i + 1]);
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
  else if (b && playing.value) {
    const ctx = b.ctx as AudioContext;
    const t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const spans = line.value;
    const i = spans.findIndex((x) => t >= x.start && t < x.end);
    nowIndex.value = i;
    if (i >= 0) want = spans[i].ipa;
    else if (spans.length && t > spans[spans.length - 1].end) {
      playing.value = false;
      nowIndex.value = -1;
      state.status = 'Done. Change anything and press again.';
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

function voiceArg(): string {
  const p = preset.value;
  if (p && !edited.value) return `'${p.id}'`;
  const changed = specs
    .filter((s) => Math.abs((state.params[s.name] ?? s.default) - s.default) > 1e-9)
    .map((s) => `${s.name}: ${Number(state.params[s.name].toFixed(3))}`);
  return changed.length ? `{ ${changed.join(', ')} }` : '{}';
}

function lineCall(prefix: string): string {
  const text = "'" + state.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (state.mode === 'speak') return `${prefix}.speak(${text}, { hz: ${state.hz}, rate: ${state.rate} });`;
  const notes = melodyNotes()
    .map((n) => {
      const sec = Number((n.dur as { seconds: number }).seconds.toFixed(3));
      return n.note === null ? `{ note: null, dur: { seconds: ${sec} } }` : `{ note: '${noteName(n.note as number)}', dur: { seconds: ${sec} } }`;
    })
    .join(',\n  ');
  return `${prefix}.sing(${text}, [\n  ${notes},\n]);`;
}

const codeMode = computed(() =>
  [`var singer = lib.singer(b, ${voiceArg()}, { accent: '${state.accent}' });`, lineCall('singer')].join('\n'),
);
const codeApp = computed(() =>
  [
    `// npm install bellowsjs bellows-voice`,
    `import { Bellows } from 'bellowsjs';`,
    `import { voice, singer } from 'bellows-voice';`,
    ``,
    `// from a click or key press: browsers start audio only after one`,
    `const b = await Bellows.boot({ plugins: [voice] });`,
    `const s = singer(b, ${voiceArg()}, { accent: '${state.accent}' });`,
    lineCall('s'),
  ].join('\n'),
);
const codeTab = ref<'app' | 'code'>('app');

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    state.status = 'Code copied.';
  } catch {
    state.status = 'Select the code to copy it.';
  }
}
</script>

<template>
  <div class="lab">
    <!-- the stage: stays in view while the controls scroll -->
    <section class="stage panel" aria-label="playback">
      <div class="playbar">
        <div class="seg" role="group" aria-label="speak or sing">
          <button :class="{ lit: state.mode === 'speak' }" :aria-pressed="state.mode === 'speak'" @click="state.mode = 'speak'">Speak</button>
          <button :class="{ lit: state.mode === 'sing' }" :aria-pressed="state.mode === 'sing'" @click="state.mode = 'sing'">Sing</button>
        </div>
        <button class="go" :class="{ lit: playing }" @click="play">{{ state.mode === 'sing' ? 'SING IT' : 'SPEAK IT' }}</button>
        <button class="stopb" :disabled="!playing" @click="stop">STOP</button>
      </div>
      <p class="status" role="status">{{ state.status }}</p>

      <MouthView :shape="shape" :phoneme="phoneme" :bounds="bounds" />

      <div class="now" aria-hidden="true">
        <span v-for="(sp, i) in line" :key="i" class="sound" :class="{ on: i === nowIndex }">{{ sp.ipa }}</span>
        <span v-if="!line.length" class="hint">The sounds of the line light up here as they play.</span>
      </div>

      <div class="ipa">
        <div class="ipa-row">
          <span class="lbl">{{ accent?.name ?? state.accent }}</span>
          <span class="val">{{ ipa }}</span>
        </div>
        <div v-if="state.accent !== 'general-american'" class="ipa-row ga">
          <span class="lbl">General American</span>
          <span class="val">{{ ipaGA }}</span>
        </div>
      </div>
    </section>

    <!-- the controls, in the order a line is made -->
    <div class="controls">
      <section class="panel">
        <h3 class="step"><span class="n">1</span> The voice</h3>
        <div class="seg wide" role="group" aria-label="male, female or child">
          <button v-for="[g, label] in GROUPS" :key="g" :class="{ lit: state.group === g }" :aria-pressed="state.group === g" @click="chooseGroup(g)">{{ label }}</button>
        </div>
        <div class="cards">
          <button
            v-for="p in presetsInGroup"
            :key="p.id"
            class="card"
            :class="{ lit: state.presetId === p.id }"
            :aria-pressed="state.presetId === p.id"
            @click="choosePreset(p)"
          >
            <span class="card-name">{{ p.name }}</span>
            <span class="card-meta">sings {{ noteName(p.range[0]) }} to {{ noteName(p.range[1]) }}, speaks at {{ p.speechHz }} Hz</span>
          </button>
        </div>
        <p v-if="preset" class="hint">{{ preset.description }}<template v-if="edited">, fine-tuned</template>.</p>
      </section>

      <section class="panel">
        <h3 class="step"><span class="n">2</span> The words</h3>
        <textarea v-model="state.text" rows="2" spellcheck="false" aria-label="what to say or sing" @keydown="onKey"></textarea>
        <div class="chips">
          <span class="hint">Try:</span>
          <button v-for="t in TEXTS" :key="t" class="chip" @click="state.text = t">{{ t.length > 30 ? t.slice(0, 28) + '...' : t }}</button>
          <button class="chip" @click="state.text = KEYWORDS">the vowels that accents change</button>
        </div>
        <p class="hint">Ctrl or Cmd + Enter in the box plays it. Write IPA between slashes, /ˈhɛ.loʊ/, to set the sounds yourself.</p>
      </section>

      <section class="panel">
        <h3 class="step"><span class="n">3</span> The accent</h3>
        <div class="tabs" role="group" aria-label="region">
          <button v-for="r in ACCENT_REGIONS" :key="r" :class="{ lit: state.region === r }" :aria-pressed="state.region === r" @click="chooseRegion(r)">{{ r }}</button>
        </div>
        <div class="accents" role="group" aria-label="accent">
          <button v-for="a in accentsInRegion" :key="a.id" :class="{ lit: state.accent === a.id }" :aria-pressed="state.accent === a.id" @click="state.accent = a.id">{{ a.name }}</button>
        </div>
        <ul class="traits">
          <li v-for="t in traits" :key="t">{{ t }}</li>
        </ul>
      </section>

      <section class="panel">
        <h3 class="step"><span class="n">4</span> {{ state.mode === 'sing' ? 'The tune' : 'The delivery' }}</h3>
        <template v-if="state.mode === 'speak'">
          <label class="slider">
            <span>Pitch <b>{{ state.hz }} Hz</b><em>{{ preset ? preset.name + ' speaks at ' + preset.speechHz : '' }}</em></span>
            <input v-model.number="state.hz" type="range" min="70" max="320" step="1" aria-label="speaking pitch in hertz" />
          </label>
          <label class="slider">
            <span>Speed <b>{{ state.rate.toFixed(2) }}x</b></span>
            <input v-model.number="state.rate" type="range" min="0.5" max="1.8" step="0.01" aria-label="speaking speed" />
          </label>
        </template>
        <template v-else>
          <div class="chips">
            <button
              v-for="[name, m] in MELODIES"
              :key="name"
              class="chip"
              :class="{ lit: state.melody === m }"
              :aria-pressed="state.melody === m"
              @click="state.melody = m"
            >
              {{ name }}
            </button>
          </div>
          <label class="slider">
            <span>Tempo <b>{{ state.bpm }} bpm</b></span>
            <input v-model.number="state.bpm" type="range" min="50" max="220" step="1" aria-label="tempo in beats per minute" />
          </label>
          <label class="check"><input v-model="state.fitRange" type="checkbox" /> move the tune into the voice's range (sings {{ melodyRange }})</label>
          <details class="more">
            <summary>Write your own tune</summary>
            <p class="hint">Notes with octave numbers, one a syllable, repeated to fit the {{ syllableCount }} syllables. Add :2 to hold one for two beats. For example: C4 E4 G4:2 E4 C4:2</p>
            <input v-model="state.melody" spellcheck="false" aria-label="your tune as note names" />
          </details>
        </template>
      </section>

      <details class="panel more">
        <summary class="step-sum">Fine-tune the voice</summary>
        <div class="fine-head">
          <span class="hint">Every parameter of the vocal engine.</span>
          <button class="reset" @click="resetParams">{{ preset ? 'back to ' + preset.name : 'reset' }}</button>
        </div>
        <div v-for="[title, list] in grouped" :key="title" class="group">
          <div class="group-title">{{ title }}</div>
          <div class="grid">
            <label v-for="spec in list" :key="spec.name" class="slider">
              <span>{{ PARAM_TEXT[spec.name]?.[0] ?? spec.name }} <b>{{ formatValue(spec, state.params[spec.name] ?? spec.default, STEP_NAMES[spec.name] ?? null) }}</b></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                :value="toSlider(spec, state.params[spec.name] ?? spec.default)"
                :aria-label="PARAM_TEXT[spec.name]?.[0] ?? spec.name"
                :aria-description="PARAM_TEXT[spec.name]?.[1]"
                @input="onSlide(spec, $event)"
              />
              <em>{{ PARAM_TEXT[spec.name]?.[1] ?? '' }}</em>
            </label>
          </div>
        </div>
      </details>

      <details class="panel more">
        <summary class="step-sum">Hold any sound</summary>
        <p class="hint">Press and hold (or focus and hold Space) to hear one sound alone and see the mouth make it.</p>
        <div class="pads">
          <button
            v-for="p in VOCAL_PHONEMES.filter((x) => x !== '_')"
            :key="p"
            class="pad"
            :aria-label="'hold the sound ' + p"
            @pointerdown="holdPhoneme(p)"
            @pointerup="release"
            @pointerleave="release"
            @keydown.space.prevent="!held && holdPhoneme(p)"
            @keydown.enter.prevent="!held && holdPhoneme(p)"
            @keyup.space="release"
            @keyup.enter="release"
          >
            {{ p }}
          </button>
        </div>
      </details>

      <details class="panel more">
        <summary class="step-sum">Get the code</summary>
        <div class="seg" role="group" aria-label="where the code goes">
          <button :class="{ lit: codeTab === 'app' }" :aria-pressed="codeTab === 'app'" @click="codeTab = 'app'">In your app</button>
          <button :class="{ lit: codeTab === 'code' }" :aria-pressed="codeTab === 'code'" @click="codeTab = 'code'">In Code mode here</button>
        </div>
        <pre class="code">{{ codeTab === 'app' ? codeApp : codeMode }}</pre>
        <button @click="copy(codeTab === 'app' ? codeApp : codeMode)">COPY</button>
        <p class="hint">
          No bundler? The <a href="/docs/singing">singing page</a> shows the single-file version with an import map, from a CDN.
        </p>
      </details>
    </div>
  </div>
</template>

<style scoped>
/*
 * IPA in a font that draws it: the site's monospace face draws u like ʊ, which are different sounds.
 * These faces carry the IPA block with distinct letters on every platform the site targets.
 */
.ipa .val,
.sound,
.pad,
.accents button,
textarea {
  font-family: 'Charis SIL', 'Doulos SIL', 'Gentium Plus', 'Noto Sans', 'Lucida Grande', 'Segoe UI', 'DejaVu Sans', sans-serif;
}
.lab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: 16px;
  align-items: start;
}
.stage {
  grid-column: 2;
  grid-row: 1;
  position: sticky;
  top: 12px;
}
.controls {
  grid-column: 1;
  grid-row: 1;
  display: grid;
  gap: 12px;
}
@media (max-width: 1100px) {
  .lab {
    grid-template-columns: 1fr;
  }
  .stage,
  .controls {
    grid-column: 1;
  }
  .stage {
    grid-row: 1;
    position: static;
  }
  .controls {
    grid-row: 2;
  }
  /* on a narrow screen the play bar stays pinned to the bottom */
  .playbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 10px 12px;
    background: var(--char);
    border-top: 1px solid var(--seam);
    margin: 0;
  }
  .lab {
    padding-bottom: 72px;
  }
}

.playbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.go {
  flex: 1;
  min-width: 140px;
  font-family: var(--disp);
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.12em;
  padding: 12px 18px;
}
.stopb {
  font-family: var(--disp);
  font-weight: 700;
  padding: 12px 16px;
}
.status {
  font-size: 11px;
  color: var(--tick);
  margin: 4px 0 10px;
  min-height: 1.4em;
}
.now {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 10px;
  min-height: 28px;
}
.sound {
  text-transform: none;
  font-size: 13px;
  padding: 2px 5px;
  border: 1px solid var(--seam);
  color: var(--faded);
}
.sound.on {
  background: var(--phosphor);
  border-color: var(--phosphor);
  color: var(--char);
}
.ipa {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--char);
  border: 1px solid var(--seam);
  display: grid;
  gap: 6px;
}
.ipa-row {
  display: grid;
  gap: 2px;
}
.ipa .lbl {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--faded);
  text-transform: uppercase;
}
.ipa .val {
  text-transform: none;
  font-size: 18px;
  color: var(--phosphor-hot);
  line-height: 1.45;
  word-break: break-word;
}
.ipa .ga .val {
  font-size: 14px;
  color: var(--tick);
}

.step,
.step-sum {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--phosphor);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
}
.step-sum {
  cursor: pointer;
  margin: 0;
}
.step .n {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--phosphor);
  font-size: 11px;
}
.seg {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.seg button {
  font-family: var(--disp);
  font-weight: 700;
  padding: 7px 14px;
}
.seg.wide button {
  flex: 1;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
  margin-top: 8px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  text-align: left;
  padding: 8px 10px;
  text-transform: none;
}
.card-name {
  font-family: var(--disp);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.card-meta {
  font-size: 10px;
  opacity: 0.8;
  letter-spacing: 0;
}
.tabs,
.accents {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.tabs button {
  font-size: 10px;
  padding: 5px 8px;
}
.accents {
  margin-top: 8px;
}
.accents button {
  text-transform: none;
  font-size: 12px;
  padding: 6px 10px;
}
.traits {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.traits li {
  font-size: 11px;
  border: 1px solid var(--seam);
  padding: 3px 7px;
  color: var(--bone);
}
textarea,
input:not([type='range']):not([type='checkbox']) {
  text-transform: none;
  width: 100%;
  background: var(--iron);
  border: 1px solid var(--seam);
  color: var(--bone);
  font-size: 15px;
  padding: 8px 10px;
  resize: vertical;
}
.chips,
.pads {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 8px;
}
.chip {
  font-size: 10.5px;
  padding: 4px 8px;
  box-shadow: none;
  text-transform: none;
}
.hint {
  font-size: 11px;
  color: var(--tick);
  line-height: 1.5;
  margin: 6px 0 0;
}
.hint a {
  color: var(--phosphor-hot);
}
.slider {
  display: grid;
  gap: 3px;
  margin: 10px 0;
  font-size: 11px;
  color: var(--faded);
}
.slider b {
  color: var(--bone);
  font-weight: 600;
  margin-left: 4px;
}
.slider em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--tick);
  margin-left: 6px;
}
.check {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: var(--faded);
}
.more summary {
  list-style: none;
}
.more summary::before {
  content: '+';
  display: inline-block;
  width: 14px;
  color: var(--phosphor);
}
.more[open] summary::before {
  content: '-';
}
.more > summary + * {
  margin-top: 10px;
}
.fine-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.group-title {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--phosphor);
  margin: 12px 0 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  column-gap: 16px;
}
.grid .slider em {
  margin-left: 0;
}
.reset {
  font-size: 10px;
  padding: 4px 8px;
  box-shadow: none;
  text-transform: none;
}
.pad {
  /* IPA is case-sensitive: an uppercased ɑ or ð is a different letter */
  text-transform: none;
  min-width: 34px;
  font-size: 14px;
  padding: 5px 6px;
  touch-action: none;
}
.code {
  text-transform: none;
  background: var(--iron);
  border: 1px solid var(--seam);
  padding: 12px 14px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--bone);
  max-height: 40vh;
  margin: 10px 0 6px;
}
</style>

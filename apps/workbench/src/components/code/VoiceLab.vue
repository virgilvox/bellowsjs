<script setup lang="ts">
/*
 * The voice lab, built the way voice demos that work are built: one text box, one primary action,
 * and two pickers. The composer holds what a line needs (speak, sing or beatbox as tabs on the text box, the
 * text, a voice and an accent as searchable pickers, the two or three settings that matter for the
 * mode, and Play, which becomes Stop). The output shows what it is doing (the mouth, the IPA beside
 * General American's, the sounds as they play on a timeline, and the spectrum with its formants and
 * vowel chart). Everything else (every engine param, holding one
 * sound, the code) is folded below. docs/VOICE-LAB-UX.md has the walkthroughs behind it.
 *
 * Each kind of control looks like what it is: tabs are underlined text, pickers are fields with a
 * chevron, the one filled button is Play, the expanders are plain rows. The site styles every button
 * as a raised box; the lab overrides that for everything that is not an action.
 */

import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { parseNote, type Bellows, type ParamSpec } from 'bellowsjs';
import {
  ACCENTS,
  ACCENT_REGIONS,
  BEAT_PRESETS,
  VOICE_SETTINGS,
  describeSound,
  VOCAL_ENGINE_INFO,
  VOCAL_PHONEMES,
  VOICE_PRESETS,
  pronounce,
  singer as makeSinger,
  toIPA,
  type Accent,
  type SingNote,
  type SingResult,
  type PronouncingDictionary,
  type Singer,
} from 'bellows-voice';
import { ensureBellows } from '../../lib/audio';
import { formatValue, fromSlider, toSlider } from '../../lib/instrument-store';
import './voice-lab/lab.css';
import MouthView from './MouthView.vue';
import ShapePanel from './voice-lab/ShapePanel.vue';
import BeatPanel, { type BeatState } from './voice-lab/BeatPanel.vue';
import SoundTimeline, { type TimedSound } from './voice-lab/SoundTimeline.vue';
import { useMouth } from './voice-lab/useMouth';
import SpectrumView from './SpectrumView.vue';
import Picker, { type PickerOption } from './Picker.vue';

/* ---- params, named for people ---- */

const DRIVEN = new Set(['phoneme', 'bend', 'nextPhoneme', 'nextIn', ...VOICE_SETTINGS.map((x) => x.param)]);
const PARAM_TEXT: Record<string, [string, string]> = {
  body: ['Size', '0 a man, 1 a woman, 2 a child; blends between'],
  glottis: ['Vocal folds', 'pulse is the default; the others are physical models'],
  tension: ['Pressed', 'soft and dark at 0, pressed and bright at 1'],
  breath: ['Breathiness', 'air through the folds'],
  roughness: ['Roughness', 'unevenness; 0.02 measures as a healthy voice'],
  fry: ['Creak', 'the rattle at the bottom of a voice'],
  drift: ['Pitch wander', 'slow drift, in cents'],
  vibratoRate: ['Vibrato speed', 'classical singers sit at 5 to 7 Hz'],
  vibratoDepth: ['Vibrato width', 'semitones either side'],
  vibratoDelay: ['Vibrato delay', 'before the vibrato blooms'],
  glide: ['Note glide', 'time to move to a new note'],
  overshoot: ['Overshoot', 'how far past a new note before settling'],
  preparation: ['Preparation', 'a dip the wrong way before a change'],
  articulation: ['Mouth speed', '2 is twice as quick'],
  ring: ["Singer's ring", 'the band near 3 kHz that carries'],
  tuning: ['High-note jaw', 'opens on high notes, as sopranos do'],
  attack: ['Attack', 'how a phrase starts'],
  release: ['Release', 'how a phrase dies away'],
  level: ['Level', 'output level'],
  mic: ['Close mic', 'a microphone at the lips: it hears the air of kicks and plosives (beatbox uses 0.8)'],
};
const PARAM_GROUPS: Array<[string, string[]]> = [
  ['Source', ['body', 'glottis', 'tension', 'breath', 'roughness', 'fry']],
  ['Pitch and vibrato', ['drift', 'vibratoRate', 'vibratoDepth', 'vibratoDelay', 'glide', 'overshoot', 'preparation']],
  ['Mouth', ['articulation', 'ring', 'tuning']],
  ['Envelope and microphone', ['attack', 'release', 'level', 'mic']],
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

/* ---- words and tunes ---- */

const EXAMPLES = [
  'I parked my car in Harvard Yard.',
  'Good morning. Where are you from?',
  'The water in the bath was far too hot.',
  'I think this is the best day of the year.',
  'Twinkle twinkle little star, how I wonder what you are.',
];
const MELODIES: Array<[string, string]> = [
  ['Up and down', 'C4 D4 E4 F4 G4 F4 E4 D4 C4:2'],
  ['Twinkle', 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2'],
  ['Arpeggio', 'C4 E4 G4 C5 G4 E4'],
  ['One note', 'A4'],
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

const state = reactive({
  mode: 'speak' as 'speak' | 'sing' | 'beatbox' | 'shape',
  /** The mouth's shape: voice settings and anatomy by param (VOICE_SETTINGS). */
  shape: {} as Record<string, number>,
  /** The vowel the Shape tab holds and shows. */
  shapeIpa: 'ɑ',
  zoom: 'mouth' as 'mouth' | 'head',
  labels: true,
  text: EXAMPLES[0],
  beat: { pattern: BEAT_PRESETS[0].text, bpm: BEAT_PRESETS[0].bpm, swing: BEAT_PRESETS[0].swing, loops: 2 } as BeatState,
  voiceId: 'narrator-female',
  accent: 'general-american',
  melody: MELODIES[0][1],
  bpm: 120,
  fitRange: true,
  hz: 199,
  rate: 1,
  params: { ...defaults(), ...VOICE_PRESETS.find((v) => v.id === 'narrator-female')!.params } as Record<string, number>,
  status: '',
});

const preset = computed(() => VOICE_PRESETS.find((v) => v.id === state.voiceId) ?? null);
const edited = computed(() => {
  const p = preset.value;
  if (!p) return true;
  const want = { ...defaults(), ...p.params };
  return specs.some((s) => Math.abs((state.params[s.name] ?? s.default) - (want[s.name] ?? s.default)) > 1e-9);
});

/* ---- the pickers ---- */

const GROUP_HEAD: Record<string, string> = { male: 'Male voices', female: 'Female voices', child: 'Child' };
const GROUP_ORDER = ['female', 'male', 'child'];
const voiceOptions = computed<PickerOption[]>(() =>
  [...VOICE_PRESETS]
    .sort((a, c) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(c.group))
    .map((v) => ({
      id: v.id,
      label: v.name,
      detail: `${v.description}. Sings ${noteName(v.range[0])} to ${noteName(v.range[1])}, speaks at ${v.speechHz} Hz.`,
      group: GROUP_HEAD[v.group],
      keywords: v.group,
    })),
);

/** What an accent does, as what you hear. */
function traitsOf(a: Accent): string[] {
  const out: string[] = [];
  out.push(a.rhotic ? 'says the r in "car"' : 'drops the r in "car"');
  if (a.t === 'flap') out.push('"water" with a quick d');
  if (a.t === 'glottal') out.push('"water" as wa\'er');
  if (a.l === 'clear') out.push('a clear l');
  if (a.l === 'vocalized') out.push('"milk" as miwk');
  if (a.th === 'stop') out.push('"think" as tink');
  if (a.th === 'front') out.push('"think" as fink');
  if (a.th === 'sibilant') out.push('"this" as zis');
  if (a.r === 'tap') out.push('a tapped r');
  if (a.hDrop) out.push('drops h');
  if (a.raised) out.push('"price" starts high');
  if (a.replace?.w === 'v') out.push('"west" as vest');
  if (a.devoiceFinal) out.push('"bed" as bet');
  if (a.prosody?.tune === 'rise') out.push('statements rise');
  if ((a.prosody?.stressRatio ?? 2) < 1.6) out.push('syllable-timed');
  return out;
}
const accentOptions = computed<PickerOption[]>(() =>
  ACCENT_REGIONS.flatMap((region) =>
    Object.values(ACCENTS)
      .filter((a) => a.region === region)
      .map((a) => ({ id: a.id, label: a.name, detail: traitsOf(a).join(', '), group: region, keywords: a.id })),
  ),
);
const accent = computed<Accent | undefined>(() => ACCENTS[state.accent]);

watch(
  () => state.voiceId,
  (id) => {
    const p = VOICE_PRESETS.find((v) => v.id === id);
    if (!p) return;
    const next = { ...defaults(), ...p.params };
    for (const s of specs) setParam(s.name, next[s.name] ?? s.default);
    state.hz = p.speechHz;
  },
);

/* ---- what the text becomes ---- */

/*
 * The pronouncing dictionary (bellows-voice/dict, about 570 KB gzipped) loads in the background when the lab
 * opens: until it arrives the English reader's rules read the text, after it every word CMU has is right.
 */
const dictionary = shallowRef<PronouncingDictionary | undefined>(undefined);
onMounted(() => {
  void import('bellows-voice/dict')
    .then((m) => {
      dictionary.value = m.cmudict();
      if (voiceSinger) voiceSinger.dictionary = dictionary.value;
    })
    .catch(() => {
      // offline or blocked: the reader's rules read every word, nearly all of them right
    });
});

const safeIpa = (id: string) => {
  try {
    return toIPA(state.text, { accent: id, dictionary: dictionary.value });
  } catch (e) {
    return String(e);
  }
};
const ipa = computed(() => safeIpa(state.accent));
const ipaGA = computed(() => safeIpa('general-american'));
const syllableCount = computed(() => {
  try {
    return pronounce(state.text, { accent: state.accent, dictionary: dictionary.value }).syllables.filter((s) => !s.melisma).length;
  } catch {
    return 0;
  }
});

function melodyNotes(): SingNote[] {
  const beat = 60 / state.bpm;
  const tokens = state.melody.trim().split(/\s+/).filter(Boolean);
  const list = (tokens.length ? tokens : ['A4']).map((t) => {
    const [name, mul] = t.split(':');
    let midi = 69;
    try {
      midi = parseNote(name);
    } catch {
      // an unreadable note sings A4
    }
    return { midi, beats: Number(mul) > 0 ? Number(mul) : 1 };
  });
  let shift = 0;
  const p = preset.value;
  if (state.fitRange && p) {
    const sorted = list.map((x) => x.midi).sort((a, c) => a - c);
    shift = 12 * Math.round(((p.range[0] + p.range[1]) / 2 - sorted[Math.floor(sorted.length / 2)]) / 12);
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
/* the Tune select: a preset's notes, or '' for your own */
const tuneChoice = ref(MELODIES[0][1]);
watch(tuneChoice, (m) => {
  if (m) state.melody = m;
});

/* ---- sound ---- */

let b: Bellows | null = null;
let voiceSinger: Singer | null = null;
const line = shallowRef<TimedSound[]>([]);
/** The close microphone a beatbox line plays through (bellows-voice's 'beatboxer' voice uses the same). */
const BEAT_MIC = 0.8;
const textModel = computed({
  get: () => (state.mode === 'beatbox' ? state.beat.pattern : state.text),
  set: (v: string) => {
    if (state.mode === 'beatbox') state.beat = { ...state.beat, pattern: v };
    else state.text = v;
  },
});
const nowIndex = ref(-1);
const playing = ref(false);
let held: { id: number; ipa: string } | null = null;
const heldNow = ref(false);
const heldWords = ref('');
/** The site's analyser on the whole output, for the spectrum. */
const analyser = shallowRef<AnalyserNode | null>(null);
const spansOf = (r: SingResult): TimedSound[] => r.phrases.flatMap((p) => p.spans.map((sp) => ({ ipa: sp.ipa, start: sp.start, end: sp.end, kind: sp.kind })));

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
  if (dictionary.value) voiceSinger.dictionary = dictionary.value;
  voiceSinger.shape(state.shape);
  analyser.value = b.analyser;
  return voiceSinger;
}

async function play(): Promise<void> {
  if (playing.value) {
    stop();
    return;
  }
  const s = await ready();
  // a beatboxer is heard on a close microphone; the other modes keep the voice's own setting
  s.param('mic', state.mode === 'beatbox' ? Math.max(BEAT_MIC, state.params.mic ?? 0) : (state.params.mic ?? 0));
  const result =
    state.mode === 'beatbox'
      ? s.beatbox(state.beat.pattern, { bpm: state.beat.bpm, swing: state.beat.swing, repeat: state.beat.loops })
      : state.mode === 'sing'
        ? s.sing(state.text, melodyNotes())
        : s.speak(state.text, { accent: state.accent, hz: state.hz, rate: state.rate });
  line.value = spansOf(result);
  playing.value = line.value.length > 0;
  state.status = result.unknown.length ? `No sound for ${result.unknown.join(' ')}; those keep the sound before them.` : '';
}

/** Hear one beat sound, and add it to the pattern. */
async function tryBeat(id: string): Promise<void> {
  const s = await ready();
  s.param('mic', Math.max(BEAT_MIC, state.params.mic ?? 0));
  line.value = spansOf(s.beatbox(id, { bpm: 90 }));
  playing.value = true;
  state.beat = { ...state.beat, pattern: (state.beat.pattern.trim() + ' ' + id).trim() };
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
}
function onSlide(spec: ParamSpec, e: Event): void {
  const v = fromSlider(spec, (e.target as HTMLInputElement).valueAsNumber);
  setParam(spec.name, STEP_NAMES[spec.name] ? Math.round(v) : v);
}
function resetParams(): void {
  const next = { ...defaults(), ...(preset.value?.params ?? {}) };
  for (const s of specs) setParam(s.name, next[s.name] ?? s.default);
}

/*
 * Hold one sound: a pad's phoneme, or the Shape tab's vowel. The first hold waits for the engine to
 * boot; a release in that wait (a tap, a quick key) cancels it, or the sound would stick on.
 */
let holdToken = 0;
async function hold(p: string): Promise<void> {
  const token = ++holdToken;
  const s = await ready();
  if (token !== holdToken) return;
  silence();
  s.param('phoneme', VOCAL_PHONEMES.indexOf(p as (typeof VOCAL_PHONEMES)[number]));
  held = { id: s.on({ hz: state.hz }, 0.8), ipa: p };
  heldNow.value = true;
  heldWords.value = describeSound(p) ?? '';
  mouth.readShape();
}
function release(): void {
  holdToken++;
  silence();
}
function silence(): void {
  if (held && voiceSinger) voiceSinger.off(held.id);
  held = null;
  heldNow.value = false;
  mouth.readShape();
}

/* ---- the mouth ---- */

const mouth = useMouth({
  body: () => state.params.body ?? 0,
  settings: () => state.shape,
  shaping: () => state.mode === 'shape',
  shapeIpa: () => state.shapeIpa,
  context: () => (b ? (b.ctx as AudioContext) : null),
  spans: line,
  playing,
  held: () => held?.ipa ?? null,
  nowIndex,
});
const { shape, phoneme, flow, handles, caption } = mouth;
watch(
  () => state.shape,
  // replaced, never mutated (ShapePanel and the drags both set a new object)
  (v) => voiceSinger?.shape(v),
);
// a key held on a pad whose keyup lands elsewhere (a Tab, a window switch) must not hold forever
onMounted(() => window.addEventListener('blur', release));
onBeforeUnmount(() => {
  window.removeEventListener('blur', release);
  release();
  stop();
});

/* ---- code ---- */

function voiceArg(): string {
  const p = preset.value;
  if (p && !edited.value) return `'${p.id}'`;
  const changed = specs
    .filter((s) => Math.abs((state.params[s.name] ?? s.default) - s.default) > 1e-9)
    .map((s) => `${s.name}: ${Number(state.params[s.name].toFixed(3))}`);
  return changed.length ? `{ ${changed.join(', ')} }` : '{}';
}
function lineCall(v: string): string {
  // the shape carries into every tab, so the code sets it wherever it is set
  const shaped = Object.keys(state.shape).length ? `${v}.shape(${JSON.stringify(state.shape).replace(/"/g, '')});\n` : '';
  const text = "'" + state.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (state.mode === 'shape') return `${shaped}${v}.speak(${text}, { hz: ${state.hz}, rate: ${state.rate} });`;
  if (state.mode === 'beatbox') {
    const pat = "'" + state.beat.pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    return `${v}.param('mic', ${BEAT_MIC});\n${v}.beatbox(${pat}, { bpm: ${state.beat.bpm}, swing: ${state.beat.swing}, repeat: ${state.beat.loops} });`;
  }
  if (state.mode === 'speak') return `${shaped}${v}.speak(${text}, { hz: ${state.hz}, rate: ${state.rate} });`;
  const notes = melodyNotes()
    .map((n) => {
      const sec = Number((n.dur as { seconds: number }).seconds.toFixed(3));
      return n.note === null ? `{ note: null, dur: { seconds: ${sec} } }` : `{ note: '${noteName(n.note as number)}', dur: { seconds: ${sec} } }`;
    })
    .join(',\n  ');
  return `${shaped}${v}.sing(${text}, [\n  ${notes},\n]);`;
}
const codeTab = ref<'app' | 'code'>('app');
const code = computed(() =>
  codeTab.value === 'app'
    ? [
        `// npm install bellowsjs bellows-voice`,
        `import { Bellows } from 'bellowsjs';`,
        `import { voice, singer } from 'bellows-voice';`,
        ``,
        `// from a click or key press: browsers start audio only after one`,
        `const b = await Bellows.boot({ plugins: [voice] });`,
        `const s = singer(b, ${voiceArg()}, { accent: '${state.accent}' });`,
        lineCall('s'),
      ].join('\n')
    : [`var s = lib.singer(b, ${voiceArg()}, { accent: '${state.accent}' });`, lineCall('s')].join('\n'),
);
const copied = ref(false);
async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(code.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // the code is selectable
  }
}
</script>

<template>
  <div class="lab">
    <!-- the composer: everything a line needs, and the one action -->
    <section class="composer">
      <div class="tabs" role="tablist" aria-label="speak, sing or beatbox">
        <button role="tab" class="tab" :aria-selected="state.mode === 'speak'" @click="state.mode = 'speak'">Speak</button>
        <button role="tab" class="tab" :aria-selected="state.mode === 'sing'" @click="state.mode = 'sing'">Sing</button>
        <button role="tab" class="tab" :aria-selected="state.mode === 'beatbox'" @click="state.mode = 'beatbox'">Beatbox</button>
        <button role="tab" class="tab" :aria-selected="state.mode === 'shape'" @click="state.mode = 'shape'">Shape</button>
      </div>

      <div class="sheet">
        <textarea
          v-model="textModel"
          class="text"
          :class="{ pattern: state.mode === 'beatbox' }"
          rows="2"
          spellcheck="false"
          :placeholder="state.mode === 'beatbox' ? 'B . t . | Pf . t .' : state.mode === 'sing' ? 'Type a lyric to sing' : 'Type something to say'"
          :aria-label="state.mode === 'beatbox' ? 'beat pattern' : 'text'"
          @keydown="onKey"
        ></textarea>
        <BeatPanel v-if="state.mode === 'beatbox'" v-model="state.beat" @try="tryBeat" />
        <div v-if="state.mode !== 'beatbox'" class="examples">
          <span>Try</span>
          <button v-for="t in EXAMPLES" :key="t" class="link" @click="state.text = t">{{ t }}</button>
        </div>
        

        <ShapePanel v-if="state.mode === 'shape'" v-model:shape="state.shape" v-model:ipa="state.shapeIpa" @hear="hold(state.shapeIpa)" @release="release">
          <template #stage>
            <MouthView
              :shape="shape"
              :phoneme="phoneme"
              :flow="flow"
              :zoom="state.zoom"
              :labels="state.labels"
              :handles="handles"
              :caption="caption"
              @drag="(h, x, y) => mouth.queueDrag(h, x, y, (v) => (state.shape = v))"
            />
            <div class="view-tools">
              <p class="explain">Drag a circle: the tongue, its tip, the jaw, the lips, the soft palate, the voice box. The sliders do the same from the keyboard.</p>
              <div class="tabs small" role="radiogroup" aria-label="how much of the head">
                <button role="radio" class="tab" :aria-checked="state.zoom === 'mouth'" :aria-selected="state.zoom === 'mouth'" @click="state.zoom = 'mouth'">Mouth</button>
                <button role="radio" class="tab" :aria-checked="state.zoom === 'head'" :aria-selected="state.zoom === 'head'" @click="state.zoom = 'head'">Whole head</button>
              </div>
            </div>
          </template>
        </ShapePanel>

        <div class="pickers">
          <Picker v-model="state.voiceId" label="Voice" :options="voiceOptions" :hint="edited ? 'Customized in Voice settings below.' : undefined" />
          <Picker v-if="state.mode !== 'beatbox'" v-model="state.accent" label="Accent" :options="accentOptions" />
        </div>

        <div v-if="state.mode === 'speak' || state.mode === 'shape'" class="settings">
          <label class="set">
            <span class="set-label">Pitch <output>{{ state.hz }} Hz</output></span>
            <input v-model.number="state.hz" type="range" min="70" max="320" step="1" />
          </label>
          <label class="set">
            <span class="set-label">Speed <output>{{ state.rate.toFixed(2) }}x</output></span>
            <input v-model.number="state.rate" type="range" min="0.5" max="1.8" step="0.01" />
          </label>
        </div>
        
        <div v-else-if="state.mode === 'sing'" class="settings">
          <label class="set">
            <span class="set-label">Tune</span>
            <select v-model="tuneChoice" class="select">
              <option v-for="[name, m] in MELODIES" :key="name" :value="m">{{ name }}</option>
              <option value="">Your own</option>
            </select>
          </label>
          <label class="set">
            <span class="set-label">Tempo <output>{{ state.bpm }} bpm</output></span>
            <input v-model.number="state.bpm" type="range" min="50" max="220" step="1" />
          </label>
          <label v-if="tuneChoice === ''" class="set wide">
            <span class="set-label">Your tune <em>note names, one a syllable; :2 holds for two beats</em></span>
            <input v-model="state.melody" class="tune" spellcheck="false" placeholder="C4 E4 G4:2 E4 C4:2" />
          </label>
          <label class="check">
            <input v-model="state.fitRange" type="checkbox" />
            Fit to the voice's range (sings {{ melodyRange }})
          </label>
        </div>

        <div class="actions">
          <button class="play" :class="{ stopping: playing }" @click="play">
            <span class="glyph" aria-hidden="true"></span>{{ playing ? 'Stop' : state.mode === 'sing' ? 'Sing' : state.mode === 'beatbox' ? 'Play beat' : state.mode === 'shape' ? 'Say it with this mouth' : 'Speak' }}
          </button>
          <span class="shortcut">or Ctrl + Enter in the text box</span>
        </div>
        <p v-if="state.status" class="status" role="status">{{ state.status }}</p>
      </div>
    </section>

    <!-- the output: what it is doing -->
    <section class="output" :class="{ single: state.mode === 'shape' }" aria-label="what the voice is doing">
      <div v-if="state.mode !== 'shape'" class="views">
        <MouthView
          :shape="shape"
          :phoneme="phoneme"
          :flow="flow"
          :zoom="state.zoom"
          :labels="state.labels"
        />
        <div class="view-tools">
          <div class="tabs small" role="radiogroup" aria-label="how much of the head">
            <button role="radio" class="tab" :aria-checked="state.zoom === 'mouth'" :aria-selected="state.zoom === 'mouth'" @click="state.zoom = 'mouth'">Mouth</button>
            <button role="radio" class="tab" :aria-checked="state.zoom === 'head'" :aria-selected="state.zoom === 'head'" @click="state.zoom = 'head'">Whole head</button>
          </div>
          <label class="check"><input v-model="state.labels" type="checkbox" /> Names</label>
        </div>
        <p v-if="heldWords && heldNow" class="explain">{{ heldWords }}</p>
      </div>
      <div class="reading">
        <div v-if="state.mode !== 'beatbox'" class="ipa">
          <span class="ipa-label">{{ accent?.name ?? state.accent }}</span>
          <span class="ipa-text">{{ ipa }}</span>
        </div>
        <div v-if="state.mode !== 'beatbox' && state.accent !== 'general-american'" class="ipa compare">
          <span class="ipa-label">General American</span>
          <span class="ipa-text">{{ ipaGA }}</span>
        </div>
        <SoundTimeline :spans="line" :now-index="nowIndex" />
        <div class="ipa">
          <span class="ipa-label">{{ state.mode === 'beatbox' ? 'What it sounds like: the spectrum' : 'What it sounds like: the spectrum, its formants, and the vowel on a chart' }}</span>
          <SpectrumView :analyser="analyser" :active="playing || !!heldNow" :body="state.params.body ?? 0" :vowels="state.mode !== 'beatbox'" />
        </div>
      </div>
    </section>

    <!-- everything else, folded -->
    <div class="folds">
      <details class="more">
        <summary>Voice settings<span>every parameter of the vocal engine</span></summary>
        <div class="more-body">
          <button class="link reset" @click="resetParams">Reset to {{ preset?.name ?? 'defaults' }}</button>
          <div v-for="[title, list] in grouped" :key="title" class="pgroup">
            <h4>{{ title }}</h4>
            <div class="pgrid">
              <label v-for="spec in list" :key="spec.name" class="set">
                <span class="set-label">{{ PARAM_TEXT[spec.name]?.[0] ?? spec.name }} <output>{{ formatValue(spec, state.params[spec.name] ?? spec.default, STEP_NAMES[spec.name] ?? null) }}</output></span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  :value="toSlider(spec, state.params[spec.name] ?? spec.default)"
                  :aria-description="PARAM_TEXT[spec.name]?.[1]"
                  @input="onSlide(spec, $event)"
                />
                <em>{{ PARAM_TEXT[spec.name]?.[1] ?? '' }}</em>
              </label>
            </div>
          </div>
        </div>
      </details>

      <details class="more">
        <summary>Hold a sound<span>hear one sound alone and see its shape</span></summary>
        <div class="more-body">
          <p class="note">Press and hold, or focus one and hold Space.</p>
          <div class="pads">
            <button
              v-for="p in VOCAL_PHONEMES.filter((x) => x !== '_')"
              :key="p"
              class="pad"
              :aria-label="'hold ' + p"
              :title="describeSound(p)"
              @pointerdown="hold(p)"
              @pointerup="release"
              @pointerleave="release"
              @keydown.space.prevent="!heldNow && hold(p)"
              @keyup.space="release"
              @blur="release"
            >
              {{ p }}
            </button>
          </div>
        </div>
      </details>

      <details class="more">
        <summary>Code<span>these settings, ready to paste</span></summary>
        <div class="more-body">
          <div class="tabs small" role="tablist" aria-label="where the code goes">
            <button role="tab" class="tab" :aria-selected="codeTab === 'app'" @click="codeTab = 'app'">Your app</button>
            <button role="tab" class="tab" :aria-selected="codeTab === 'code'" @click="codeTab = 'code'">Code mode here</button>
          </div>
          <pre class="code">{{ code }}</pre>
          <button class="link" @click="copyCode">{{ copied ? 'Copied' : 'Copy' }}</button>
          <p class="note">No bundler? The <a href="/docs/singing">singing page</a> has a single-file version from a CDN.</p>
        </div>
      </details>
    </div>
  </div>
</template>


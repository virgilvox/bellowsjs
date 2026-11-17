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
  VOCAL_BEATS,
  VOCAL_ENGINE_INFO,
  VOCAL_PHONEMES,
  VOICE_PRESETS,
  pronounce,
  singer as makeSinger,
  toIPA,
  type Accent,
  type SingNote,
  type Singer,
} from 'bellows-voice';
import { TractModel, type TractShape } from 'bellows-voice/view';
import { ensureBellows } from '../../lib/audio';
import { formatValue, fromSlider, toSlider } from '../../lib/instrument-store';
import MouthView from './MouthView.vue';
import SpectrumView from './SpectrumView.vue';
import Picker, { type PickerOption } from './Picker.vue';

/* ---- params, named for people ---- */

const DRIVEN = new Set(['phoneme', 'bend', 'nextPhoneme', 'nextIn']);
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
  mode: 'speak' as 'speak' | 'sing' | 'beatbox',
  text: EXAMPLES[0],
  beat: BEAT_PRESETS[0].text,
  beatBpm: BEAT_PRESETS[0].bpm,
  swing: BEAT_PRESETS[0].swing,
  loops: 2,
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

const safeIpa = (id: string) => {
  try {
    return toIPA(state.text, { accent: id });
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
const line = shallowRef<Array<{ ipa: string; start: number; end: number; kind: string }>>([]);
/** The close microphone a beatbox line plays through (bellows-voice's 'beatboxer' voice uses the same). */
const BEAT_MIC = 0.8;
const BEAT_NAMES = new Map(VOCAL_BEATS.map((b) => [b.id, b.name]));
/** A span's sound as people read it: IPA, or a beat's symbol. */
function shown(ipa: string): string {
  if (!ipa.startsWith('beat:')) return ipa;
  const id = ipa.slice(5).replace(/>$/, '');
  return id === '.' ? '' : id;
}
const textModel = computed({
  get: () => (state.mode === 'beatbox' ? state.beat : state.text),
  set: (v: string) => {
    if (state.mode === 'beatbox') state.beat = v;
    else state.text = v;
  },
});
function usePreset(id: string): void {
  const p = BEAT_PRESETS.find((x) => x.id === id);
  if (!p) return;
  state.beat = p.text;
  state.beatBpm = p.bpm;
  state.swing = p.swing;
}
/** Hear one sound, and add it to the pattern. */
async function tryBeat(id: string): Promise<void> {
  const s = await ready();
  s.param('mic', Math.max(BEAT_MIC, state.params.mic ?? 0));
  const r = s.beatbox(id, { bpm: 90 });
  line.value = r.phrases.flatMap((p) => p.spans.map((sp) => ({ ipa: sp.ipa, start: sp.start, end: sp.end, kind: sp.kind })));
  playing.value = true;
  state.beat = (state.beat.trim() + ' ' + id).trim();
}
const timeline = computed(() => {
  const spans = line.value;
  if (!spans.length) return [];
  return spans.map((sp) => ({ text: shown(sp.ipa), grow: Math.max(0.001, sp.end - sp.start), kind: sp.ipa.startsWith('beat:') ? (sp.ipa === 'beat:.' ? 'rest' : 'beat') : sp.kind }));
});
const flow = ref(0);
const nowIndex = ref(-1);
const playing = ref(false);
let held: { id: number; ipa: string } | null = null;
const heldNow = ref(false);
/** The site's analyser on the whole output, for the spectrum. */
const analyser = shallowRef<AnalyserNode | null>(null);

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
      ? s.beatbox(state.beat, { bpm: state.beatBpm, swing: state.swing, repeat: state.loops })
      : state.mode === 'sing'
        ? s.sing(state.text, melodyNotes())
        : s.speak(state.text, { accent: state.accent, hz: state.hz, rate: state.rate });
  line.value = result.phrases.flatMap((p) => p.spans.map((sp) => ({ ipa: sp.ipa, start: sp.start, end: sp.end, kind: sp.kind })));
  playing.value = line.value.length > 0;
  state.status = result.unknown.length ? `No sound for ${result.unknown.join(' ')}; those keep the sound before them.` : '';
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
  const next = { ...defaults(), ...(preset.value?.params ?? {}) };
  for (const s of specs) setParam(s.name, next[s.name] ?? s.default);
}

async function holdPhoneme(p: string): Promise<void> {
  const s = await ready();
  release();
  s.param('phoneme', VOCAL_PHONEMES.indexOf(p as (typeof VOCAL_PHONEMES)[number]));
  held = { id: s.on({ hz: state.hz }, 0.8), ipa: p };
  heldNow.value = true;
}
function release(): void {
  if (held && voiceSinger) voiceSinger.off(held.id);
  held = null;
  heldNow.value = false;
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
    // the air: out while a sound is made, in for an inward snare, still in a rest or silence
    if (i >= 0) {
      want = spans[i].ipa;
      flow.value = want === '_' || want === 'beat:.' ? 0 : want.startsWith('beat:^K') ? -1 : want.startsWith('beat:m') ? 0.5 : 1;
    } else if (spans.length && t > spans[spans.length - 1].end) {
      playing.value = false;
      nowIndex.value = -1;
    }
  }
  if (!playing.value && !held) flow.value = 0;
  else if (held) flow.value = 1;
  if (want !== tract.current) tract.target(want);
  tract.step(dt);
  const beatId = want.startsWith('beat:') ? want.slice(5).replace(/>$/, '') : '';
  phoneme.value = beatId ? (beatId === '.' ? '' : `${beatId} ${BEAT_NAMES.get(beatId) ?? ''}`) : want;
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
  if (state.mode === 'beatbox') {
    const pat = "'" + state.beat.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    return `${v}.param('mic', ${BEAT_MIC});\n${v}.beatbox(${pat}, { bpm: ${state.beatBpm}, swing: ${state.swing}, repeat: ${state.loops} });`;
  }
  const text = "'" + state.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (state.mode === 'speak') return `${v}.speak(${text}, { hz: ${state.hz}, rate: ${state.rate} });`;
  const notes = melodyNotes()
    .map((n) => {
      const sec = Number((n.dur as { seconds: number }).seconds.toFixed(3));
      return n.note === null ? `{ note: null, dur: { seconds: ${sec} } }` : `{ note: '${noteName(n.note as number)}', dur: { seconds: ${sec} } }`;
    })
    .join(',\n  ');
  return `${v}.sing(${text}, [\n  ${notes},\n]);`;
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
        <div v-if="state.mode === 'beatbox'" class="examples">
          <span>Beats</span>
          <button v-for="p in BEAT_PRESETS" :key="p.id" class="link" @click="usePreset(p.id)">{{ p.name }}</button>
        </div>
        <div v-else class="examples">
          <span>Try</span>
          <button v-for="t in EXAMPLES" :key="t" class="link" @click="state.text = t">{{ t }}</button>
        </div>
        <div v-if="state.mode === 'beatbox'" class="palette" aria-label="the sounds; click one to hear it and add it">
          <button v-for="bt in VOCAL_BEATS.filter((x) => x.id !== '.')" :key="bt.id" class="chip" :title="bt.hint + ' (' + bt.airstream + ')'" @click="tryBeat(bt.id)">
            <b>{{ bt.id }}</b><span>{{ bt.name }}</span>
          </button>
          <p class="palette-note">One step a sixteenth: <code>.</code> rests, <code>|</code> marks a bar, <code>&gt;</code> accents, <code>m:43</code> hums MIDI note 43. Hover a sound for how the mouth makes it.</p>
        </div>

        <div class="pickers">
          <Picker v-model="state.voiceId" label="Voice" :options="voiceOptions" :hint="edited ? 'Customized in Voice settings below.' : undefined" />
          <Picker v-if="state.mode !== 'beatbox'" v-model="state.accent" label="Accent" :options="accentOptions" />
        </div>

        <div v-if="state.mode === 'speak'" class="settings">
          <label class="set">
            <span class="set-label">Pitch <output>{{ state.hz }} Hz</output></span>
            <input v-model.number="state.hz" type="range" min="70" max="320" step="1" />
          </label>
          <label class="set">
            <span class="set-label">Speed <output>{{ state.rate.toFixed(2) }}x</output></span>
            <input v-model.number="state.rate" type="range" min="0.5" max="1.8" step="0.01" />
          </label>
        </div>
        <div v-else-if="state.mode === 'beatbox'" class="settings">
          <label class="set">
            <span class="set-label">Tempo <output>{{ state.beatBpm }} bpm</output></span>
            <input v-model.number="state.beatBpm" type="range" min="60" max="180" step="1" />
          </label>
          <label class="set">
            <span class="set-label">Swing <output>{{ Math.round(state.swing * 100) }}%</output></span>
            <input v-model.number="state.swing" type="range" min="0" max="0.6" step="0.01" />
          </label>
          <label class="set">
            <span class="set-label">Times through <output>{{ state.loops }}</output></span>
            <input v-model.number="state.loops" type="range" min="1" max="8" step="1" />
          </label>
        </div>
        <div v-else class="settings">
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
            <span class="glyph" aria-hidden="true"></span>{{ playing ? 'Stop' : state.mode === 'sing' ? 'Sing' : state.mode === 'beatbox' ? 'Play beat' : 'Speak' }}
          </button>
          <span class="shortcut">or Ctrl + Enter in the text box</span>
        </div>
        <p v-if="state.status" class="status" role="status">{{ state.status }}</p>
      </div>
    </section>

    <!-- the output: what it is doing -->
    <section class="output" aria-label="what the voice is doing">
      <MouthView :shape="shape" :phoneme="phoneme" :bounds="bounds" :flow="flow" />
      <div class="reading">
        <div v-if="state.mode !== 'beatbox'" class="ipa">
          <span class="ipa-label">{{ accent?.name ?? state.accent }}</span>
          <span class="ipa-text">{{ ipa }}</span>
        </div>
        <div v-if="state.mode !== 'beatbox' && state.accent !== 'general-american'" class="ipa compare">
          <span class="ipa-label">General American</span>
          <span class="ipa-text">{{ ipaGA }}</span>
        </div>
        <div v-if="timeline.length" class="timeline-wrap">
          <span class="ipa-label">As it plays, each sound as long as it lasts</span>
          <div class="timeline" aria-hidden="true">
            <span v-for="(sp, i) in timeline" :key="i" class="seg" :class="[sp.kind, { on: i === nowIndex }]" :style="{ flexGrow: sp.grow }">{{ sp.text }}</span>
          </div>
          <div class="legend"><i class="nucleus"></i>vowel <i class="onset"></i>consonant <i class="beat"></i>beat</div>
        </div>
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
              @pointerdown="holdPhoneme(p)"
              @pointerup="release"
              @pointerleave="release"
              @keydown.space.prevent="!held && holdPhoneme(p)"
              @keyup.space="release"
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

<style scoped>
/* IPA in a face that draws it: the site's monospace draws u like ʊ */
.ipa-text,
.sound,
.pad,
.text {
  font-family: 'Charis SIL', 'Doulos SIL', 'Gentium Plus', 'Noto Sans', 'Lucida Grande', 'Segoe UI', 'DejaVu Sans', sans-serif;
}

.lab {
  display: grid;
  gap: 18px;
}

/* ---- tabs: underlined text on the sheet's edge, not boxes ---- */
.tabs {
  display: flex;
  gap: 4px;
}
.tab {
  background: transparent;
  border: 0;
  border-bottom: 3px solid transparent;
  box-shadow: none;
  padding: 10px 18px 7px;
  font-family: var(--disp);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--faded);
}
.tab:hover {
  transform: none;
  color: var(--bone);
  border-color: transparent;
  border-bottom-color: var(--seam);
}
.tab:active {
  transform: none;
  box-shadow: none;
}
.tab:focus-visible {
  outline: 2px solid var(--phosphor);
  outline-offset: -2px;
}
.tab[aria-selected='true'] {
  color: var(--bone);
  border-bottom-color: var(--phosphor);
}
.tabs.small .tab {
  font-size: 13px;
  padding: 6px 12px 5px;
}

/* ---- the composer ---- */
.sheet {
  background: var(--soot);
  border: 2px solid var(--seam);
  box-shadow: var(--shadow);
  padding: 18px;
  display: grid;
  gap: 16px;
}
.text {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  background: var(--iron);
  border: 2px solid var(--seam);
  color: var(--bone);
  font-size: 20px;
  line-height: 1.45;
  padding: 12px 14px;
}
.text:focus-visible {
  outline: 2px solid var(--phosphor);
  outline-offset: 2px;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--faded);
  margin-top: -8px;
}
/* a text button: underlined, no box */
.link {
  text-align: left;
  background: none;
  border: 0;
  box-shadow: none;
  padding: 0;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--tick);
  text-decoration: underline;
  text-decoration-color: var(--seam);
  text-underline-offset: 3px;
  cursor: pointer;
}
.link:hover {
  transform: none;
  color: var(--phosphor-hot);
  text-decoration-color: var(--phosphor);
}
.link:active {
  transform: none;
  box-shadow: none;
}
.pickers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
}
@media (max-width: 700px) {
  .pickers {
    grid-template-columns: 1fr;
  }
}
.settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px 20px;
  align-items: end;
}
.set {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.set.wide {
  grid-column: 1 / -1;
}
.set-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--tick);
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.set-label output {
  font-weight: 400;
  color: var(--bone);
}
.set-label em,
.set > em {
  font-style: normal;
  font-weight: 400;
  font-size: 11px;
  color: var(--faded);
}
.select,
.tune {
  text-transform: none;
  width: 100%;
  background: var(--iron);
  border: 2px solid var(--seam);
  color: var(--bone);
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0;
  padding: 8px 10px;
}
.check {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--tick);
}
.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
/* the one action: filled, large, sentence case */
.play {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 150px;
  justify-content: center;
  padding: 12px 26px;
  background: var(--phosphor);
  border-color: var(--phosphor);
  color: var(--lit-text);
  font-family: var(--disp);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: none;
}
.play:hover {
  color: var(--lit-text);
  border-color: var(--phosphor-hot);
}
.glyph {
  width: 0;
  height: 0;
  border-left: 11px solid currentColor;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
}
.play.stopping .glyph {
  width: 11px;
  height: 11px;
  border: 0;
  background: currentColor;
}
/* no keyboard shortcut to offer on a touch screen */
@media (max-width: 700px) {
  .shortcut {
    display: none;
  }
}
.shortcut,
.status,
.note {
  font-size: 11px;
  color: var(--faded);
  margin: 0;
}

/* ---- the output ---- */
.output {
  background: var(--soot);
  border: 2px solid var(--seam);
  box-shadow: var(--shadow);
  padding: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 800px) {
  .output {
    grid-template-columns: 1fr;
  }
}
.reading {
  display: grid;
  gap: 14px;
  align-content: start;
}
.ipa {
  display: grid;
  gap: 3px;
}
.ipa-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--tick);
}
.ipa-text {
  font-size: 21px;
  line-height: 1.45;
  color: var(--phosphor-hot);
  word-break: break-word;
}
.compare .ipa-text {
  font-size: 15px;
  color: var(--tick);
}
.views {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.timeline-wrap {
  display: grid;
  gap: 6px;
}
.timeline {
  display: flex;
  height: 34px;
  border: 1px solid var(--seam);
  background: var(--char);
  overflow: hidden;
}
.seg {
  flex-basis: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-align: center;
  font-family: 'Charis SIL', 'Doulos SIL', 'Noto Sans', 'Lucida Grande', 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 32px;
  color: var(--faded);
  border-right: 1px solid var(--seam);
  transition: background 60ms linear;
}
.seg.nucleus {
  background: color-mix(in srgb, var(--phosphor) 22%, transparent);
}
.seg.onset,
.seg.coda {
  background: color-mix(in srgb, var(--tick) 18%, transparent);
}
.seg.beat {
  background: color-mix(in srgb, #ff8a5c 26%, transparent);
  font-family: var(--mono);
}
.seg.on {
  background: var(--phosphor);
  color: var(--char);
}
.legend {
  font-size: 11px;
  color: var(--tick);
  display: flex;
  gap: 10px;
  align-items: center;
}
.legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 3px;
  vertical-align: -1px;
}
.legend i.nucleus {
  background: color-mix(in srgb, var(--phosphor) 45%, transparent);
}
.legend i.onset {
  background: color-mix(in srgb, var(--tick) 40%, transparent);
}
.legend i.beat {
  background: color-mix(in srgb, #ff8a5c 50%, transparent);
}
.text.pattern {
  font-family: var(--mono);
  letter-spacing: 0.04em;
}
.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
  padding: 4px 8px;
  border: 1px solid var(--seam);
  background: transparent;
  box-shadow: none;
  color: var(--ink, inherit);
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
  border-radius: 2px;
}
.chip b {
  font-family: var(--mono);
  color: var(--phosphor-hot);
}
.chip span {
  color: var(--tick);
}
.chip:hover {
  border-color: var(--phosphor);
}
.palette-note {
  flex-basis: 100%;
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--tick);
}

/* ---- folded sections: plain rows ---- */
.folds {
  border-top: 1px solid var(--seam);
}
.more {
  border-bottom: 1px solid var(--seam);
}
.more summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 13px 2px;
  font-family: var(--disp);
  font-size: 15px;
  font-weight: 600;
  color: var(--bone);
}
.more summary::-webkit-details-marker {
  display: none;
}
.more summary::before {
  content: '';
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--tick);
  border-bottom: 2px solid var(--tick);
  transform: rotate(-45deg);
  transition: transform 0.15s;
  align-self: center;
}
.more[open] summary::before {
  transform: rotate(45deg);
}
.more summary span {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--faded);
}
.more summary:focus-visible {
  outline: 2px solid var(--phosphor);
}
.more-body {
  padding: 0 2px 18px;
  display: grid;
  gap: 10px;
}
.reset {
  justify-self: start;
}
.pgroup h4 {
  font-family: var(--disp);
  font-size: 12px;
  font-weight: 600;
  color: var(--phosphor);
  margin: 6px 0;
}
.pgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px 20px;
}
.pads {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.pad {
  min-width: 36px;
  font-size: 15px;
  letter-spacing: 0;
  text-transform: none;
  padding: 6px;
  box-shadow: none;
  touch-action: none;
}
.code {
  background: var(--iron);
  border: 2px solid var(--seam);
  padding: 12px 14px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--bone);
  max-height: 40vh;
  margin: 0;
  text-transform: none;
}
.note a {
  color: var(--phosphor-hot);
}
</style>

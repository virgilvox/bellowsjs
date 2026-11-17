<script setup lang="ts">
/*
 * What the voice sounds like, measured as it plays: the spectrum of the site's output (the bellows
 * analyser, 50 Hz to 10 kHz on a log axis), the formants a linear-prediction fit finds in it (F1 to F3,
 * the tract's resonances; bellowsjs estimateFormants), and where F1 and F2 put the vowel on a vowel
 * chart beside Hillenbrand et al.'s (1995) American English means for the same kind of voice.
 *
 * LPC reads harmonics as formants above about 200 Hz of pitch, so a high voice's marks wander; the
 * chart only takes a reading while the sound is loud and voiced-looking (energy below 1 kHz).
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { estimateFormants } from 'bellowsjs';

const props = defineProps<{
  analyser: AnalyserNode | null;
  /** Read and draw only while something plays. */
  active: boolean;
  /** 0 male, 1 female, 2 child: which reference means to draw. */
  body: number;
  /** Read formants and draw the vowel chart (a beat has no vowel to place). */
  vowels?: boolean;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);

/* Hillenbrand, Getty, Clark and Wheeler (1995), JASA 97(5), Table V: mean F1, F2 (Hz) of men, women, children. */
const REFERENCE: Record<string, [number, number][]> = {
  i: [[342, 2322], [437, 2761], [452, 3081]],
  ɪ: [[427, 2034], [483, 2365], [511, 2552]],
  e: [[476, 2089], [536, 2530], [564, 2656]],
  ɛ: [[580, 1799], [731, 2058], [749, 2267]],
  æ: [[588, 1952], [669, 2349], [717, 2501]],
  ɑ: [[768, 1333], [936, 1551], [1002, 1688]],
  ɔ: [[652, 997], [781, 1136], [803, 1210]],
  o: [[497, 910], [555, 1035], [597, 1137]],
  ʊ: [[469, 1122], [519, 1225], [568, 1490]],
  u: [[378, 997], [459, 1105], [494, 1345]],
  ʌ: [[623, 1200], [753, 1426], [749, 1546]],
  ɝ: [[474, 1379], [523, 1588], [586, 1719]],
};

let raf = 0;
let freq: Float32Array<ArrayBuffer> | null = null;
let time: Float32Array<ArrayBuffer> | null = null;
let fm: number[] = [];
let trail: Array<[number, number]> = [];
let frameNo = 0;

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function draw(): void {
  const c = canvas.value;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ink = '#f0b04a';
  const faded = '#8b7a66';
  const hot = '#ffd27a';
  const mono = css('--mono', 'monospace');
  g.fillStyle = '#17120e';
  g.fillRect(0, 0, w, h);

  // the chart takes the right, square; the spectrum the rest (stacked under 520 px)
  const vowels = props.vowels !== false;
  const stacked = vowels && w < 360;
  const chartW = !vowels ? 0 : stacked ? w : Math.min(h, w * 0.4);
  const specW = !vowels ? w : stacked ? w : w - chartW - 10;
  const specH = stacked ? h * 0.48 : h;
  const chartX = stacked ? 0 : specW + 10;
  const chartY = stacked ? specH + 8 : 0;
  const chartH = stacked ? h - specH - 8 : h;

  const a = props.analyser;
  const sr = a?.context.sampleRate ?? 48000;
  const F0 = 50;
  const F1 = 10000;
  const fx = (f: number) => (Math.log(f / F0) / Math.log(F1 / F0)) * specW;
  // grid
  g.strokeStyle = '#2a221b';
  g.fillStyle = faded;
  g.font = '9px ' + mono;
  for (const f of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = fx(f);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, specH);
    g.stroke();
    g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), Math.min(x + 2, specW - 18), specH - 3);
  }

  let loud = false;
  if (a && props.active) {
    if (!freq || freq.length !== a.frequencyBinCount) freq = new Float32Array(a.frequencyBinCount);
    if (!time || time.length !== a.fftSize) time = new Float32Array(a.fftSize);
    a.getFloatFrequencyData(freq);
    a.getFloatTimeDomainData(time);
    // the spectrum, 0 to -100 dB
    g.beginPath();
    g.moveTo(0, specH);
    const bin = sr / a.fftSize;
    for (let x = 0; x <= specW; x += 1.5) {
      const f = F0 * Math.pow(F1 / F0, x / specW);
      const k = Math.min(freq.length - 1, Math.round(f / bin));
      const db = Math.max(-100, Math.min(0, freq[k]));
      g.lineTo(x, specH * (-db / 100));
    }
    g.lineTo(specW, specH);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, specH);
    grad.addColorStop(0, 'rgba(255, 210, 122, 0.85)');
    grad.addColorStop(1, 'rgba(240, 176, 74, 0.08)');
    g.fillStyle = grad;
    g.fill();
    // formants, every third frame, while the sound is loud enough to read
    let e = 0;
    for (let i = 0; i < time.length; i++) e += time[i] * time[i];
    const rms = Math.sqrt(e / time.length);
    let low = 0;
    let all = 0;
    for (let k = 1; k < freq.length; k++) {
      const p = Math.pow(10, freq[k] / 10);
      all += p;
      if (k * bin < 1000) low += p;
    }
    loud = vowels && rms > 0.004 && low > 0.6 * all;
    if (loud && frameNo++ % 3 === 0) {
      const found = estimateFormants(time, sr, time.length >> 1, Math.min(0.04, time.length / sr), 4, 12);
      // a resonance is narrow; a wide pole is the fit smoothing the spectrum, not a formant
      fm = found
        .filter((x) => x.bw < 600 && x.f > 200 && x.f < 4500)
        .map((x) => x.f)
        .slice(0, 3);
      if (fm.length >= 2) {
        trail.push([fm[0], fm[1]]);
        if (trail.length > 24) trail.shift();
      }
    }
  }
  if (!props.active || !loud) {
    if (trail.length && frameNo++ % 2 === 0) trail.shift();
  }
  g.font = '10px ' + mono;
  fm.forEach((f, i) => {
    if (!loud) return;
    const x = fx(f);
    g.strokeStyle = hot;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, specH);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = hot;
    g.fillText(`F${i + 1} ${Math.round(f)}`, Math.min(x + 3, specW - 56), 12 + 12 * i);
  });
  g.fillStyle = faded;
  g.fillText('spectrum', 4, specH - 14);

 if (!vowels) return;
  // the vowel chart: F2 right to left, F1 top to bottom, as phoneticians draw it
  const b = Math.max(0, Math.min(2, Math.round(props.body)));
  const f1lo = 200;
  const f1hi = 1100;
  const f2lo = 700;
  const f2hi = 3300;
  const vx = (f2: number) => chartX + 8 + (1 - (Math.log(f2 / f2lo) / Math.log(f2hi / f2lo))) * (chartW - 16);
  const vy = (f1: number) => chartY + 8 + (Math.log(f1 / f1lo) / Math.log(f1hi / f1lo)) * (chartH - 24);
  g.strokeStyle = '#2a221b';
  g.strokeRect(chartX + 0.5, chartY + 0.5, chartW - 1, chartH - 1);
  g.font = "13px 'Charis SIL', 'Doulos SIL', 'Noto Sans', 'Lucida Grande', sans-serif";
  for (const [v, rows] of Object.entries(REFERENCE)) {
    const [f1, f2] = rows[b];
    g.fillStyle = faded;
    g.fillText(v, vx(f2) - 4, vy(f1) + 4);
  }
  trail.forEach(([f1, f2], i) => {
    g.fillStyle = ink;
    g.globalAlpha = (i + 1) / trail.length;
    g.beginPath();
    g.arc(vx(f2), vy(f1), i === trail.length - 1 ? 5 : 2.5, 0, 2 * Math.PI);
    g.fill();
  });
  g.globalAlpha = 1;
  g.font = '9px ' + mono;
  g.fillStyle = faded;
  g.fillText('vowel chart (Hillenbrand 1995)', chartX + 6, chartY + chartH - 6);
}

function loop(): void {
  draw();
  raf = requestAnimationFrame(loop);
}
watch(
  () => props.active,
  (on) => {
    if (!on) fm = [];
  },
);
onMounted(() => {
  raf = requestAnimationFrame(loop);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <canvas ref="canvas" class="spectrum" :class="{ flat: vowels === false }" aria-label="the voice's spectrum, its formants, and where its vowel sits on a vowel chart"></canvas>
</template>

<style scoped>
.spectrum {
  display: block;
  width: 100%;
  height: 200px;
  border: 1px solid var(--seam);
  background: var(--char);
}
@media (max-width: 560px) {
  .spectrum {
    height: 300px;
  }
  .spectrum.flat {
    height: 160px;
  }
}
</style>

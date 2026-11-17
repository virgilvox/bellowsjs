<script setup lang="ts">
/*
 * A midsagittal view of the voice's tract: the shape bellows-voice's own geometry gives for the
 * current posture (TractModel.shape(), centimetres, glottis to lips). Tissue fills above the upper
 * wall and below the lower one, so the air between them reads as the open tract. On top of it:
 *
 *   - the parts named (larynx, pharynx, soft palate, tongue body, tongue tip, lips), with leader lines;
 *   - the narrowest place marked, as a closure or with its area, since that is where the sound is made;
 *   - the air: particles from the glottis to the lips at a speed that rises where the tract narrows
 *     (continuity, v = U / A), stopping and crowding behind a closure, leaving through the nose when
 *     the velum is down, and running backwards when the breath is drawn in (`flow` below 0).
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TractShape } from 'bellows-voice/view';

const props = withDefaults(
  defineProps<{
    shape: TractShape | null;
    /** What to print large: the IPA or the beat being made. */
    phoneme: string;
    /** Fixed drawing bounds in cm, so the picture does not rescale as the mouth moves. */
    bounds: { x0: number; y0: number; x1: number; y1: number } | null;
    /** The breath: 0 still, 1 out, below 0 drawn in. */
    flow?: number;
    /** Name the parts. */
    labels?: boolean;
  }>(),
  { flow: 0, labels: true },
);

const canvas = ref<HTMLCanvasElement | null>(null);
let ro: ResizeObserver | null = null;

/* Air particles: a position along the tract (0 glottis, n - 1 lips, past it outside) and a sideways offset. */
const PARTICLES = 46;
const parts = Array.from({ length: PARTICLES }, (_, i) => ({ s: (i / PARTICLES) * 40, off: ((i * 0.618) % 1) - 0.5, nose: false }));
let lastT = 0;

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function draw(): void {
  const c = canvas.value;
  const s = props.shape;
  const bb = props.bounds;
  if (!c || !s || !bb) return;
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
  /* fixed anatomical colours, so the picture reads the same in the day and night themes */
  const flesh = '#b98a6a';
  const fleshDark = '#8e6249';
  const tongue = '#c9726a';
  const air = '#17120e';
  const wall = '#f0b04a';
  const faded = '#e6d6c4';
  const hot = '#ffd27a';
  const cold = '#7fc8ff';
  const mono = css('--mono', 'monospace');

  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#c39474');
  bg.addColorStop(1, flesh);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // fit the fixed bounds, y up
  const pad = 14;
  const scale = Math.min((w - 2 * pad) / (bb.x1 - bb.x0), (h - 2 * pad) / (bb.y1 - bb.y0));
  const ox = pad + (w - 2 * pad - (bb.x1 - bb.x0) * scale) / 2;
  const oy = pad + (h - 2 * pad - (bb.y1 - bb.y0) * scale) / 2;
  const X = (x: number) => ox + (x - bb.x0) * scale;
  const Y = (y: number) => h - (oy + (y - bb.y0) * scale);
  const n = s.lower.length / 2;
  if (n < 2) return;
  const lx = (i: number) => X(s.lower[2 * i]);
  const ly = (i: number) => Y(s.lower[2 * i + 1]);
  const ux = (i: number) => X(s.upper[2 * i]);
  const uy = (i: number) => Y(s.upper[2 * i + 1]);

  // outside the face, past the lips
  const lipX = Math.max(ux(n - 1), lx(n - 1));
  g.fillStyle = air;
  g.fillRect(lipX, 0, w - lipX, h);
  g.fillStyle = fleshDark;
  g.fillRect(lipX - 2, 0, 2, h);

  // the air column: the upper wall out, the lower wall back
  g.fillStyle = air;
  g.beginPath();
  for (let i = 0; i < n; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, ux(i), uy(i));
  g.lineTo(ux(n - 1) + 3, uy(n - 1));
  g.lineTo(lx(n - 1) + 3, ly(n - 1));
  for (let i = n - 1; i >= 0; i--) g.lineTo(lx(i), ly(i));
  g.closePath();
  g.fill();
  // the windpipe below the glottis
  g.fillRect(Math.min(lx(0), ux(0)), Y(Math.min(s.lower[1], s.upper[1])), Math.abs(ux(0) - lx(0)), h);

  // the tongue: the lower wall through the mouth, as a muscle under the air
  const split = s.split > 0 ? s.split : Math.round(n * 0.45);
  let tongueEnd = n - 1;
  for (let i = n - 1; i > split; i--) {
    if (s.region[i] !== 3) {
      tongueEnd = i;
      break;
    }
  }
  // a band of muscle under the lower wall, from the root in the pharynx to the tip
  const t0 = Math.max(1, split - 8);
  const depth = 0.9 * scale;
  g.fillStyle = tongue;
  g.beginPath();
  for (let i = t0; i <= tongueEnd; i++) (i === t0 ? g.moveTo : g.lineTo).call(g, lx(i), ly(i));
  for (let i = tongueEnd; i >= t0; i--) {
    // inward, away from the air: the wall's normal on the tissue side
    const a = Math.max(t0, i - 1);
    const b2 = Math.min(tongueEnd, i + 1);
    const dx = lx(b2) - lx(a);
    const dy = ly(b2) - ly(a);
    const len = Math.hypot(dx, dy) || 1;
    const taper = Math.min(1, (i - t0) / 4, (tongueEnd - i + 1) / 3);
    g.lineTo(lx(i) + (dy / len) * depth * taper, ly(i) - (dx / len) * depth * taper);
  }
  g.closePath();
  g.fill();

  // narrow places glow: a line across the airway at each point, brighter where the area is small
  for (let i = 1; i < n; i++) {
    const a = s.area[i];
    const k = Math.max(0, Math.min(1, 1 - Math.log10(1 + a) / Math.log10(1 + 6)));
    g.strokeStyle = hot;
    g.globalAlpha = 0.03 + 0.45 * k * k * k;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(lx(i), ly(i));
    g.lineTo(ux(i), uy(i));
    g.stroke();
  }
  g.globalAlpha = 1;

  // the walls
  g.strokeStyle = wall;
  g.lineWidth = 2;
  for (const line of [s.lower, s.upper]) {
    g.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, X(line[2 * i]), Y(line[2 * i + 1]));
    g.stroke();
  }

  // the nasal port, at the turn from pharynx to mouth
  const open = Math.max(0, Math.min(1, s.velumPort / 0.8));
  const vx = ux(split);
  const vy = uy(split);
  g.strokeStyle = open > 0.02 ? hot : faded;
  g.globalAlpha = 0.3 + 0.7 * open;
  g.lineWidth = 2 + 8 * open;
  g.beginPath();
  g.moveTo(vx, vy);
  g.lineTo(vx - 4, vy - 36);
  g.stroke();
  g.globalAlpha = 1;

  // the air itself
  const now = performance.now() / 1000;
  const dt = lastT ? Math.min(0.05, now - lastT) : 0;
  lastT = now;
  const flow = props.flow;
  // the narrowest place: a closure stops the air there
  const ci = s.constriction;
  const closed = ci >= 0 && s.area[ci] < 0.02;
  const portOpen = s.velumPort > 0.05;
  for (const p of parts) {
    const i = Math.max(0, Math.min(n - 1, Math.floor(p.s)));
    // continuity: the air speeds up where the tract narrows (v = U / A), capped so it stays visible
    const a = Math.max(0.15, s.area[i] || 1);
    const v = (flow * 6 * Math.min(4, 2.2 / a)) * dt;
    let next = p.s + v;
    if (flow > 0 && closed && !p.nose) {
      // behind a closure the air crowds and waits (the pressure builds); past it, it leaves
      if (p.s < ci && next >= ci - 0.6) {
        if (portOpen && Math.random() < 0.5 && p.s > split - 1) p.nose = true;
        else next = ci - 0.6 - Math.random() * 3;
      }
    }
    if (flow < 0 && closed && p.s > ci && next <= ci + 0.6) next = ci + 0.6 + Math.random() * 3;
    p.s = next;
    if (p.s > n + 6 || p.nose && p.s > split + 6) {
      p.s = Math.random() * 3;
      p.nose = false;
      p.off = Math.random() - 0.5;
    }
    if (p.s < 0) {
      p.s = n + 4 * Math.random();
      p.off = Math.random() - 0.5;
    }
    if (Math.abs(flow) < 0.02) continue;
    let px: number;
    let py: number;
    if (p.nose) {
      const u = (p.s - split) / 6;
      px = vx - 4 * u;
      py = vy - 36 * u;
    } else if (p.s >= n - 1) {
      px = lipX + (p.s - (n - 1)) * 9;
      py = (ly(n - 1) + uy(n - 1)) / 2 + p.off * 12 * (1 + (p.s - n));
    } else {
      const f = p.s - i;
      const j = Math.min(n - 1, i + 1);
      const cxA = (lx(i) + ux(i)) / 2;
      const cyA = (ly(i) + uy(i)) / 2;
      const cxB = (lx(j) + ux(j)) / 2;
      const cyB = (ly(j) + uy(j)) / 2;
      const span = Math.hypot(ux(i) - lx(i), uy(i) - ly(i)) * 0.7;
      px = cxA + (cxB - cxA) * f + (p.off * span * (ux(i) - lx(i))) / Math.max(1, Math.hypot(ux(i) - lx(i), uy(i) - ly(i)));
      py = cyA + (cyB - cyA) * f + (p.off * span * (uy(i) - ly(i))) / Math.max(1, Math.hypot(ux(i) - lx(i), uy(i) - ly(i)));
    }
    g.fillStyle = flow < 0 ? cold : '#fff3d6';
    g.globalAlpha = 0.25 + 0.5 * Math.min(1, Math.abs(flow));
    g.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
  }
  g.globalAlpha = 1;

  // where the sound is made
  if (ci > 0) {
    const cx = (lx(ci) + ux(ci)) / 2;
    const cy = (ly(ci) + uy(ci)) / 2;
    g.strokeStyle = closed ? '#ff8a5c' : hot;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, closed ? 9 : 7, 0, 2 * Math.PI);
    g.stroke();
    g.font = '10px ' + mono;
    g.fillStyle = closed ? '#ff8a5c' : hot;
    const txt = closed ? 'closed' : s.area[ci].toFixed(2) + ' cm²';
    g.fillText(txt, Math.min(cx + 12, w - g.measureText(txt).width - 4), cy + 18);
  }

  // the tongue tip
  g.fillStyle = hot;
  g.beginPath();
  g.arc(X(s.tipX), Y(s.tipY), 3, 0, 2 * Math.PI);
  g.fill();

  // labels with leader lines
  if (props.labels) {
    g.font = '10px ' + mono;
    const label = (text: string, ax: number, ay: number, tx: number, ty: number, color = faded) => {
      g.strokeStyle = color;
      g.globalAlpha = 0.7;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(tx, ty);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = color;
      const wd = g.measureText(text).width;
      const x = Math.max(2, Math.min(w - wd - 2, tx - (tx < ax ? wd + 2 : -2)));
      g.fillText(text, x, ty + 3);
    };
    // larynx: the glottis at the bottom of the tube
    const gx = (lx(0) + ux(0)) / 2;
    const gy = (ly(0) + uy(0)) / 2;
    label('larynx', gx, gy, gx - 34, gy + 4);
    // pharynx: half way up the throat
    const ph = Math.max(1, Math.round(split * 0.5));
    label('pharynx', ux(ph), uy(ph), ux(ph) - 30, uy(ph));
    label(open > 0.02 ? 'soft palate (nose open)' : 'soft palate', vx, vy, vx - 20, vy - 46, open > 0.02 ? hot : faded);
    // the tongue body: the highest point of the lower wall in the mouth
    let tb = split;
    for (let i = split; i <= tongueEnd; i++) if (s.lower[2 * i + 1] > s.lower[2 * tb + 1]) tb = i;
    label('tongue body', lx(tb), ly(tb), lx(tb) + 6, ly(tb) + 34);
    label('tip', X(s.tipX), Y(s.tipY), X(s.tipX) + 14, Y(s.tipY) + 26);
    const lt = 'lips ' + s.lipArea.toFixed(2) + ' cm²';
    label(lt, lipX, ly(n - 1), Math.min(lipX + 14, w - 70), ly(n - 1) + 24);
  }

  g.fillStyle = hot;
  // an IPA-capable face: the site's own draws some IPA letters alike (u and ʊ)
  g.font = "bold 34px 'Charis SIL', 'Doulos SIL', 'Noto Sans', 'Lucida Grande', 'Segoe UI', sans-serif";
  g.fillText(props.phoneme === '_' ? '' : props.phoneme, 14, 40);
}

watch(() => [props.shape, props.phoneme, props.bounds, props.flow, props.labels], draw);

onMounted(() => {
  draw();
  if (canvas.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(draw);
    ro.observe(canvas.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <canvas ref="canvas" class="mouth" aria-label="the voice's vocal tract, seen from the side, with the air moving through it"></canvas>
</template>

<style scoped>
.mouth {
  display: block;
  width: 100%;
  height: 300px;
  border: 1px solid var(--seam);
  background: var(--char);
}
</style>

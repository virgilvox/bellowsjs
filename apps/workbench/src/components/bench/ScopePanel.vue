<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { bellows } from '../../lib/audio';
import { bench } from '../../lib/bench-store';

const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;
let fd: Uint8Array<ArrayBuffer> | null = null;

const statusLine = computed(() => {
  if (!bench.ready) return 'standby // press play to light the forge';
  const mode = bench.playing ? 'forging' : 'idle';
  return (
    mode +
    ' // ' + bench.seed +
    ' // ' + bench.bpm + ' bpm' +
    ' // voices ' + bench.meterInfo.voices +
    ' // ' + (bench.meterInfo.sr || 0) + ' hz'
  );
});

function drawMeterBar(g: CanvasRenderingContext2D, x: number, y: number, w: number, rms: number, peak: number) {
  g.fillStyle = '#252017';
  g.fillRect(x, y, w, 5);
  const r = Math.min(1, Math.max(0, rms));
  const p = Math.min(1, Math.max(0, peak));
  g.fillStyle = '#ffb000';
  g.fillRect(x, y, r * w, 5);
  g.fillStyle = p > 0.95 ? '#ff5533' : '#ffd257';
  g.fillRect(x + p * w - 2, y, 2, 5);
}

function draw() {
  raf = requestAnimationFrame(draw);
  const cv = canvas.value;
  if (!cv) return;
  const g = cv.getContext('2d');
  if (!g) return;
  const W = cv.width;
  const H = cv.height;
  const specH = H - 22;

  g.fillStyle = '#14110c';
  g.fillRect(0, 0, W, H);

  const b = bellows.value;
  if (!b) return;

  try {
    const an = b.analyser;
    const n = an.frequencyBinCount;
    if (!fd || fd.length !== n) fd = new Uint8Array(new ArrayBuffer(n));
    an.getByteFrequencyData(fd);
    const bars = 96;
    const bw = W / bars;
    g.fillStyle = '#ffb000';
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor(Math.pow(i / bars, 1.8) * n * 0.7);
      const v = fd[idx] / 255;
      const h = v * (specH - 6);
      g.globalAlpha = 0.22 + v * 0.78;
      g.fillRect(i * bw + 1, specH - h, bw - 2, h);
    }
    g.globalAlpha = 1;

    // stereo meter strip along the bottom, fed from the kernel meter
    const m = bench.meterInfo;
    g.fillStyle = '#8f8571';
    g.font = '8px monospace';
    g.fillText('L', 4, specH + 10);
    g.fillText('R', 4, specH + 18);
    drawMeterBar(g, 16, specH + 4, W - 24, m.rmsL, m.peakL);
    drawMeterBar(g, 16, specH + 12, W - 24, m.rmsR, m.peakR);
  } catch {
    // analyser can vanish mid-frame during a reforge
  }
}

function start() {
  if (raf === 0) raf = requestAnimationFrame(draw);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

onMounted(start);
onActivated(start);
onDeactivated(stop);
onUnmounted(stop);
</script>

<template>
  <div class="panel scope-panel">
    <div class="panel-title scope-title">scope <em>07</em></div>
    <canvas ref="canvas" width="900" height="128"></canvas>
    <div class="status-line">{{ statusLine }}</div>
  </div>
</template>

<style scoped>
.scope-panel {
  padding: 0;
  overflow: hidden;
}

.scope-title {
  margin: 0;
  padding: 8px 12px 6px;
}

canvas {
  display: block;
  width: 100%;
  height: 128px;
  background: var(--soot);
}

.status-line {
  padding: 6px 12px 8px;
  font-size: 9px;
  color: var(--tick);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-top: 1px dashed var(--seam);
}
</style>

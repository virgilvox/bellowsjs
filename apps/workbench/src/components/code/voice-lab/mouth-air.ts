/*
 * The air in the mouth view: particles from the glottis to the lips, moving at a speed that rises
 * where the tract narrows (continuity, v = U / A), crowding behind a closure (the pressure builds),
 * leaving through the nose when the velum is down, and running backwards when the breath is drawn in
 * (flow below 0). Plain state, advanced and drawn once a frame.
 */

import type { TractShape } from 'bellows-voice/view';

export interface AirState {
  parts: { s: number; off: number; nose: boolean }[];
  lastT: number;
}

/** A fresh stream of n particles spread along the tract. */
export function airState(n = 54): AirState {
  return { parts: Array.from({ length: n }, (_, i) => ({ s: (i / n) * 40, off: ((i * 0.618) % 1) - 0.5, nose: false })), lastT: 0 };
}

export function drawAir(
  g: CanvasRenderingContext2D,
  s: TractShape,
  air: AirState,
  flow: number,
  view: { X: (x: number) => number; Y: (y: number) => number; scale: number },
): void {
  const { X, Y, scale } = view;
  const parts = air.parts;
  const n = s.lower.length / 2;
  const now = performance.now() / 1000;
  const dt = air.lastT ? Math.min(0.05, now - air.lastT) : 0;
  air.lastT = now;
  const ci = s.constriction;
  const closed = ci >= 0 && s.area[ci] < 0.02;
  const split = s.split > 0 ? s.split : Math.round(n * 0.45);
  const portOpen = s.velumPort > 0.05;
  const lipX = Math.max(X(s.upper[2 * n - 2]), X(s.lower[2 * n - 2]));
  const vx = X(s.upper[2 * split]);
  const vy = Y(s.upper[2 * split + 1]);
  for (const p of parts) {
    const i = Math.max(0, Math.min(n - 1, Math.floor(p.s)));
    const a = Math.max(0.15, s.area[i] || 1);
    let next = p.s + flow * 6 * Math.min(4, 2.2 / a) * dt;
    if (flow > 0 && closed && !p.nose && p.s < ci && next >= ci - 0.6) {
      if (portOpen && Math.random() < 0.5 && p.s > split - 1) p.nose = true;
      else next = ci - 0.6 - Math.random() * 3;
    }
    if (flow < 0 && closed && p.s > ci && next <= ci + 0.6) next = ci + 0.6 + Math.random() * 3;
    p.s = next;
    if (p.s > n + 6 || (p.nose && p.s > split + 6)) {
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
      px = vx + u * 2.5 * scale;
      py = vy - u * 2.2 * scale;
    } else if (p.s >= n - 1) {
      px = lipX + (p.s - (n - 1)) * 0.5 * scale;
      py = (Y(s.lower[2 * n - 1]) + Y(s.upper[2 * n - 1])) / 2 + p.off * 0.6 * scale * (1 + (p.s - n) * 0.3);
    } else {
      const f = p.s - i;
      const j = Math.min(n - 1, i + 1);
      const ax = (X(s.lower[2 * i]) + X(s.upper[2 * i])) / 2;
      const ay = (Y(s.lower[2 * i + 1]) + Y(s.upper[2 * i + 1])) / 2;
      const bx = (X(s.lower[2 * j]) + X(s.upper[2 * j])) / 2;
      const by = (Y(s.lower[2 * j + 1]) + Y(s.upper[2 * j + 1])) / 2;
      const ex = X(s.upper[2 * i]) - X(s.lower[2 * i]);
      const ey = Y(s.upper[2 * i + 1]) - Y(s.lower[2 * i + 1]);
      px = ax + (bx - ax) * f + p.off * 0.7 * ex;
      py = ay + (by - ay) * f + p.off * 0.7 * ey;
    }
    g.fillStyle = flow < 0 ? '#7fc8ff' : '#fff3d6';
    g.globalAlpha = 0.3 + 0.5 * Math.min(1, Math.abs(flow));
    g.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
  }
  g.globalAlpha = 1;

}

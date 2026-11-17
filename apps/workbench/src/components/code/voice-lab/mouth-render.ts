/*
 * The mouth view's picture: the head in profile from bellows-voice's geometry (TractShape's drawing
 * and headProfile around it), drawn as a vector display, the deep structures dim and the moving parts
 * each in its own colour, with the narrowest place, labels and the handles on top. The air is drawn
 * by mouth-air.ts. Pure canvas drawing: no Vue, no state but what it is handed.
 */

import { headProfile, type MouthHandle, type Pt, type TractShape } from 'bellows-voice/view';
import { drawAir, type AirState } from './mouth-air';

export interface MouthDrawInput {
  shape: TractShape | null;
  phoneme: string;
  flow: number;
  labels: boolean;
  zoom: 'mouth' | 'head';
  handles: Record<MouthHandle, [number, number]> | null;
  caption: string;
}

/** Body cm to canvas px: x' = ox + s x, y' = h - (oy + s y). */
export interface ViewTransform {
  s: number;
  ox: number;
  oy: number;
  h: number;
}

export const COL = {
  bg: '#0f0c0a',
  deep: '#4f5d6b',
  deepDim: '#36414d',
  skin: '#c79c78',
  air: '#050403',
  wall: '#f0b04a',
  bone: '#ece2cf',
  jaw: '#e0605a',
  tongue: '#e07a66',
  tongueFill: 'rgba(224, 122, 102, 0.22)',
  lips: '#f39ab0',
  velum: '#f4f0e6',
  hot: '#ffd27a',
  cold: '#7fc8ff',
  label: '#e6d6c4',
};

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function drawMouth(c: HTMLCanvasElement, input: MouthDrawInput, air: AirState, dragging: MouthHandle | null): ViewTransform | null {
  const s = input.shape;
  if (!s) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = COL.bg;
  g.fillRect(0, 0, w, h);
  const d = s.drawing;
  const k = d.k;
  const head = headProfile(d);
  const bb = input.zoom === 'head' ? head.view : { x0: -3.6 * k, x1: 10.4 * k, y0: -3.0, y1: 14.4 * k };
  const pad = 10;
  const scale = Math.min((w - 2 * pad) / (bb.x1 - bb.x0), (h - 2 * pad) / (bb.y1 - bb.y0));
  const ox = pad + (w - 2 * pad - (bb.x1 - bb.x0) * scale) / 2 - bb.x0 * scale;
  const oy = pad + (h - 2 * pad - (bb.y1 - bb.y0) * scale) / 2 - bb.y0 * scale;
  const tf = { s: scale, ox, oy, h };
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => h - (oy + y * scale);
  const pairs = (flat: readonly number[]): Pt[] => {
    const o: Pt[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) o.push([flat[i], flat[i + 1]]);
    return o;
  };
  const path = (pts: Pt[], close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    if (close) g.closePath();
  };
  /* a vector-display stroke: a soft wide pass under a thin bright one */
  const beam = (pts: Pt[], color: string, width: number, o: { alpha?: number; close?: boolean; glow?: boolean } = {}) => {
    if (pts.length < 2) return;
    const a = o.alpha ?? 1;
    g.strokeStyle = color;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (o.glow !== false) {
      g.globalAlpha = 0.18 * a;
      g.lineWidth = width * 4;
      path(pts, o.close);
      g.stroke();
    }
    g.globalAlpha = a;
    g.lineWidth = width;
    path(pts, o.close);
    g.stroke();
    g.globalAlpha = 1;
  };

  // deep structures, dim
  beam(head.skull, COL.deepDim, 1, { glow: false });
  beam(head.eye, COL.deepDim, 1, { glow: false });
  for (const v of head.vertebrae) beam(v, COL.deepDim, 1, { glow: false });
  beam(head.nasal, COL.deep, 1.1, { close: true });
  for (const t of head.turbinates) beam(t, COL.deepDim, 1, { glow: false });
  beam(head.palNasal, COL.deep, 1.1);
  beam(head.hyoid, COL.deep, 1, { glow: false });
  beam(head.thyroid, COL.deep, 1, { glow: false });
  for (const t of head.trachea) beam(t, COL.deep, 1, { glow: false });
  for (const r of head.rings) beam(r, COL.deepDim, 1, { glow: false });

  // the air column, dark, between the walls (the tract's grid: upper wall out, lower wall back)
  const n = s.lower.length / 2;
  g.fillStyle = COL.air;
  g.beginPath();
  for (let i = 0; i < n; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, X(s.upper[2 * i]), Y(s.upper[2 * i + 1]));
  for (let i = n - 1; i >= 0; i--) g.lineTo(X(s.lower[2 * i]), Y(s.lower[2 * i + 1]));
  g.closePath();
  g.fill();

  // narrow places glow across the airway, brighter the smaller the area
  for (let i = 1; i < n; i++) {
    const a = s.area[i];
    const kk = Math.max(0, Math.min(1, 1 - Math.log10(1 + a) / Math.log10(1 + 6)));
    g.strokeStyle = COL.hot;
    g.globalAlpha = 0.03 + 0.4 * kk * kk * kk;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(X(s.lower[2 * i]), Y(s.lower[2 * i + 1]));
    g.lineTo(X(s.upper[2 * i]), Y(s.upper[2 * i + 1]));
    g.stroke();
  }
  g.globalAlpha = 1;

  // skin and walls
  beam(head.skinUpper, COL.skin, 1.5);
  beam(head.skinLower, COL.skin, 1.5);
  beam(pairs(d.pharynxWall), COL.wall, 1.3, { alpha: 0.9 });
  beam(pairs(d.palate), COL.wall, 1.3, { alpha: 0.9 });
  beam(pairs(d.outer), COL.wall, 1, { alpha: 0.45, glow: false });
  // the epiglottis and the folds
  beam(pairs(d.epiglottis), COL.velum, 1.8, { alpha: 0.8 });
  for (const f of head.folds) beam(f, COL.velum, 1, { alpha: 0.75, glow: false });
  // teeth and jaw
  beam(pairs(d.upperTeeth), COL.bone, 1.2, { close: true });
  beam(pairs(d.lowerTeeth), COL.bone, 1.2);
  beam(head.jawLower, COL.jaw, 1.5);
  beam(head.jawUpper, COL.jaw, 1, { alpha: 0.45, glow: false });
  // the tongue: a filled muscle
  const tongue = pairs(d.tongue);
  g.fillStyle = COL.tongueFill;
  path(tongue, true);
  g.fill();
  beam(tongue, COL.tongue, 1.7);
  // the lips and the soft palate
  beam(pairs(d.upperLip), COL.lips, 1.6);
  beam(pairs(d.lowerLip), COL.lips, 1.6);
  beam(pairs(d.velum), COL.velum, 1.3, { close: true });

  drawAir(g, s, air, input.flow, { X, Y, scale });
  const ci = s.constriction;
  const closed = ci >= 0 && s.area[ci] < 0.02;

  // where the sound is made
  const mono = css('--mono', 'monospace');
  if (ci > 0) {
    const cx = (X(s.lower[2 * ci]) + X(s.upper[2 * ci])) / 2;
    const cy = (Y(s.lower[2 * ci + 1]) + Y(s.upper[2 * ci + 1])) / 2;
    g.strokeStyle = closed ? '#ff8a5c' : COL.hot;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, closed ? 9 : 7, 0, 2 * Math.PI);
    g.stroke();
  }

  // labels: leader lines from each part
  const H = input.handles;
  if (input.labels) {
    g.font = '10px ' + mono;
    const label = (text: string, at: Pt, dx: number, dy: number, color = COL.label) => {
      const ax = X(at[0]);
      const ay = Y(at[1]);
      const tx = ax + dx;
      const ty = ay + dy;
      g.strokeStyle = color;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(tx, ty);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = color;
      const wd = g.measureText(text).width;
      const x = Math.max(2, Math.min(w - wd - 2, dx < 0 ? tx - wd - 3 : tx + 3));
      g.fillText(text, x, Math.max(10, Math.min(h - 3, ty + 3)));
    };
    const tc = d.tongueCenter;
    label('tongue', [tc[0], tc[1]], 12, 40, COL.tongue);
    const vm: Pt = [d.velum[10], d.velum[11]];
    label(s.velumPort > 0.05 ? 'soft palate (nose open)' : 'soft palate', vm, -10, -30, COL.velum);
    const ut = pairs(d.upperTeeth);
    label('teeth', ut[2], 26, -14, COL.bone);
    const jb = head.jawLower;
    if (jb.length > 2) label('jaw', jb[Math.floor(jb.length / 2)], 0, 22, COL.jaw);
    label('lips ' + s.lipArea.toFixed(2) + ' cm²', [d.lowerLip[14], d.lowerLip[15]], 22, 18, COL.lips);
    label('voice box', [0, d.glottisY], -36, 6, COL.velum);
    label('nasal cavity', head.nasal[Math.floor(head.nasal.length * 0.3)], -8, -16, COL.deep);
    if (ci > 0) {
      const txt = closed ? 'closed: the sound is made here' : 'narrowest ' + s.area[ci].toFixed(2) + ' cm²';
      label(txt, [(s.lower[2 * ci] + s.upper[2 * ci]) / 2, (s.lower[2 * ci + 1] + s.upper[2 * ci + 1]) / 2], 18, -26, closed ? '#ff8a5c' : COL.hot);
    }
  }

  // handles
  if (H) {
    const col: Record<MouthHandle, string> = { tongue: COL.tongue, tip: COL.tongue, jaw: COL.jaw, lips: COL.lips, velum: COL.velum, larynx: COL.velum };
    for (const key of Object.keys(H) as MouthHandle[]) {
      const [hx, hy] = H[key];
      const r = key === 'tongue' ? 8 : 6;
      g.fillStyle = COL.bg;
      g.strokeStyle = col[key];
      g.lineWidth = dragging === key ? 3 : 2;
      g.beginPath();
      g.arc(X(hx), Y(hy), r, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
    }
  }

  g.fillStyle = COL.hot;
  g.font = "bold 30px 'Charis SIL', 'Doulos SIL', 'Noto Sans', 'Lucida Grande', 'Segoe UI', sans-serif";
  g.fillText(input.phoneme === '_' ? '' : input.phoneme, 12, 36);
  if (input.caption) {
    g.font = '11px ' + mono;
    g.fillStyle = COL.label;
    g.fillText(input.caption, 12, 54);
  }
  return tf;
}

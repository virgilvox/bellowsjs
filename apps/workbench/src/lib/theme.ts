/*
 * Theme state. Daylight is the default; night is the original forge.
 * The choice lands on <html data-theme> so css tokens switch, persists in
 * localStorage, and anything painting to canvas subscribes through
 * onThemeChange or reads tokens() at draw time.
 */

import { ref } from 'vue';

export type ThemeName = 'light' | 'dark';

const KEY = 'bellows-theme';

export const theme = ref<ThemeName>('light');

export function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // storage may be unavailable; default stands
  }
  apply(saved === 'dark' ? 'dark' : 'light');
}

export function setTheme(name: ThemeName): void {
  apply(name);
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // best effort
  }
}

export function toggleTheme(): void {
  setTheme(theme.value === 'light' ? 'dark' : 'light');
}

function apply(name: ThemeName): void {
  theme.value = name;
  document.documentElement.dataset.theme = name;
  window.dispatchEvent(new CustomEvent('bellows-theme', { detail: name }));
}

export function onThemeChange(cb: (name: ThemeName) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail as ThemeName);
  window.addEventListener('bellows-theme', handler);
  return () => window.removeEventListener('bellows-theme', handler);
}

/** Read the current css token values, for canvas drawing. */
export function tokens(): { forge: string; soot: string; iron: string; seam: string; bone: string; tick: string; phosphor: string; phosphorHot: string; slag: string } {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim();
  return {
    forge: get('--forge'),
    soot: get('--soot'),
    iron: get('--iron'),
    seam: get('--seam'),
    bone: get('--bone'),
    tick: get('--tick'),
    phosphor: get('--phosphor'),
    phosphorHot: get('--phosphor-hot'),
    slag: get('--slag'),
  };
}

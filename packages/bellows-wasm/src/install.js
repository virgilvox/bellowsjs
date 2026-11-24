/*
 * Registers the WebAssembly engines and effects through the kernel's plugin hook. This file is
 * copied verbatim into the worklet script (tools/build.mjs), so it imports nothing and uses
 * nothing a worklet scope lacks: no atob, no TextEncoder, no subarray views on the audio path.
 *
 *   install(hook, module, manifest, { prefix, label })
 *
 * hook is globalThis.bellowsKernel in the worklet, or { registerEngine, registerEffect } from
 * bellowsjs on the calling thread. Each unit in the manifest becomes a def whose id is prefix +
 * the TypeScript id and whose params are the TypeScript ParamSpecs, so a channel or an fx chain
 * takes it exactly as it takes the TypeScript one. The exception is a unit marked bankOnly (the
 * sampler), which plays only a registered bank and so has no def of its own.
 */

function decodeBase64(s) {
  const map = new Uint8Array(128);
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) map[abc.charCodeAt(i)] = i;
  let n = s.length;
  while (n > 0 && s.charCodeAt(n - 1) === 61) n--;
  const out = new Uint8Array((n * 3) >> 2);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const a = map[s.charCodeAt(i)];
    const b = map[s.charCodeAt(i + 1)];
    const c = i + 2 < n ? map[s.charCodeAt(i + 2)] : 0;
    const d = i + 3 < n ? map[s.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

/* The kernel's callbacks into JavaScript (src/kernel.cpp). A plain instance runs no kernel, so
 * nothing calls them. */
function noKernelImports() {
  const none = () => {
    throw new Error('bellows-wasm: kernel callback without a kernel');
  };
  return { env: { host_ch_on: none, host_ch_off: none, host_ch_alloff: none, host_ch_param: none, host_ch_process: none, host_fx_process: none } };
}
/* The create-time capacity option each effect's TypeScript constructor reads from its params
 * record, passed to bw_fx_new as aux (0 when the record has none). */
const AUX_OPTION = {
  delay: 'maxSeconds',
  tapeDelay: 'maxSeconds',
  multitap: 'maxSeconds',
  fdn: 'maxSize',
};

/* aux for bw_fx_new: that option's value, or 0 (the unit's default) */
function fxAux(id, params) {
  const opt = AUX_OPTION[id];
  return opt && params && typeof params[opt] === 'number' ? params[opt] : 0;
}

function install(hook, module, manifest, cfg) {
  const ex = new WebAssembly.Instance(module, noKernelImports()).exports;
  ex.bw_init();
  const N = ex.bw_io_frames();
  const ioPtr = ex.bw_io();
  /* One scratch area for creation arguments: the longest spec list, then a label. */
  let most = 0;
  for (const u of manifest) most = Math.max(most, u.params.length);
  const valsPtr = ex.bw_alloc(4 * most);
  const LABEL_BYTES = 512;
  const labelPtr = ex.bw_alloc(LABEL_BYTES);

  /* Views over the module's memory, made again only when the memory has grown. */
  let buf = null;
  let io = null;
  function view() {
    if (buf !== ex.memory.buffer) {
      buf = ex.memory.buffer;
      io = new Float32Array(buf, ioPtr, 2 * N);
    }
    return io;
  }
  function putVals(u, params) {
    const v = new Float32Array(ex.memory.buffer, valsPtr, u.params.length);
    for (let i = 0; i < u.params.length; i++) {
      const p = u.params[i];
      const x = params ? params[p.name] : undefined;
      v[i] = typeof x === 'number' ? x : p.default;
    }
  }
  function putLabel(s) {
    const b = new Uint8Array(ex.memory.buffer, labelPtr, LABEL_BYTES);
    let n = 0;
    for (const ch of s) {
      let c = ch.codePointAt(0);
      const need = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      if (n + need >= LABEL_BYTES) break;
      if (need === 1) b[n++] = c;
      else {
        const lead = [0, 0, 0xc0, 0xe0, 0xf0][need];
        for (let k = need - 1; k >= 0; k--) {
          b[n + k] = k === 0 ? lead | c : 0x80 | (c & 63);
          c >>= 6;
        }
        n += need;
      }
    }
    b[n] = 0;
  }

  /* Handles are freed when the JavaScript object that owns one is collected. */
  const voices = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((h) => ex.bw_voice_free(h)) : null;
  const effects = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((h) => ex.bw_fx_free(h)) : null;

  class WasmVoice {
    constructor(h, index) {
      this.h = h;
      this.index = index;
    }
    noteOn(freq, vel) {
      ex.bw_voice_on(this.h, freq, vel);
    }
    noteOff() {
      ex.bw_voice_off(this.h);
    }
    get active() {
      return ex.bw_voice_active(this.h) !== 0;
    }
    setParam(name, value) {
      const i = this.index.get(name);
      if (i !== undefined) ex.bw_voice_set(this.h, i, value);
    }
    process(outL, outR, from, to) {
      for (let f = from; f < to; f += N) {
        const n = to - f < N ? to - f : N;
        ex.bw_voice_run(this.h, n);
        const s = view();
        for (let i = 0; i < n; i++) {
          outL[f + i] += s[i];
          outR[f + i] += s[N + i];
        }
      }
    }
  }

  class WasmEffect {
    constructor(h, index) {
      this.h = h;
      this.index = index;
    }
    setParam(name, value) {
      const i = this.index.get(name);
      if (i !== undefined) ex.bw_fx_set(this.h, i, value);
    }
    reset() {
      ex.bw_fx_reset(this.h);
    }
    process(l, r, from, to) {
      for (let f = from; f < to; f += N) {
        const n = to - f < N ? to - f : N;
        let s = view();
        for (let i = 0; i < n; i++) {
          s[i] = l[f + i];
          s[N + i] = r[f + i];
        }
        ex.bw_fx_run(this.h, n);
        s = view();
        for (let i = 0; i < n; i++) {
          l[f + i] = s[i];
          r[f + i] = s[N + i];
        }
      }
    }
  }

  manifest.forEach((u, unit) => {
    /* A unit that only plays a registered bank (the sampler) has no def of its own: its voices are
     * made per bank by bw_voice_new_bank, for 'sampler:<id>' channels. */
    if (u.bankOnly) return;
    const index = new Map([...u.params.map((p) => p.name), ...(u.calls ?? [])].map((n, i) => [n, i]));
    const id = cfg.prefix + u.id;
    const label = u.label + cfg.label;
    if (u.kind === 'engine') {
      hook.registerEngine({
        id,
        label,
        params: u.params,
        ...(u.polyphony ? { polyphony: u.polyphony } : {}),
        createVoice(sampleRate, params, rng) {
          putVals(u, params);
          putLabel(rng && typeof rng.label === 'string' ? rng.label : id);
          /* the string's second polarization exists when the record names polDetune, as in the TypeScript */
          const variant = u.id === 'string' && params && 'polDetune' in params ? 1 : 0;
          const h = ex.bw_voice_new(unit, sampleRate, labelPtr, valsPtr, variant);
          if (!h) throw new Error(`bellows-wasm: could not create ${id} at ${sampleRate} Hz`);
          const v = new WasmVoice(h, index);
          if (voices) voices.register(v, h);
          return v;
        },
      });
    } else {
      hook.registerEffect({
        id,
        label,
        params: u.params,
        create(sampleRate, params) {
          putVals(u, params);
          const h = ex.bw_fx_new(unit, sampleRate, valsPtr, fxAux(u.id, params));
          if (!h) throw new Error(`bellows-wasm: could not create ${id} at ${sampleRate} Hz`);
          const fx = new WasmEffect(h, index);
          if (effects) effects.register(fx, h);
          return fx;
        },
      });
    }
  });
}

export { decodeBase64, fxAux, install };

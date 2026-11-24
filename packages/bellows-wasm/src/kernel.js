/*
 * The JavaScript half of the module's kernel (src/kernel.cpp). A WasmKernel is what the worklet
 * processor or renderOffline holds in place of the TypeScript KernelEngine: it takes the same
 * messages and renders the same blocks, turning each message into calls on the module.
 *
 * Copied verbatim into the worklet script after src/install.js (tools/build.mjs), so it imports
 * nothing and uses nothing a worklet scope lacks, and it uses install.js's helpers.
 *
 *   createKernel(module, manifest, sampleRate, opts, env)
 *
 * env is the realm's half of the contract (bellowsjs kernel/kernels.ts): the registry, the
 * builtin defs, rng, VoicePool and the interned param names. A channel or effect whose def is the
 * builtin one for an id the module carries runs in the module. Anything else (a def from a
 * plugin, a tier 3 defOp, a builtin someone replaced, a sample bank) runs here, as the
 * TypeScript kernel would run it, and the module calls it back at the same points.
 */

var KIND_CHANNEL = 0;
var KIND_BUS = 1;
var KIND_MASTER = 2;

function tsClamp(v, lo, hi) {
  return v >= lo ? (v <= hi ? v : hi) : lo;
}

class WasmKernel {
  constructor(module, manifest, sampleRate, opts, env) {
    this.sampleRate = sampleRate;
    this.blockSize = (opts && opts.blockSize) ?? 128;
    this.opts = opts || {};
    this.env = env;
    this.manifest = manifest;
    this.units = new Map();
    manifest.forEach((u, unit) => {
      const names = [...u.params.map((p) => p.name), ...(u.calls ?? [])];
      this.units.set(u.kind + ':' + u.id, { unit, u, index: new Map(names.map((n, i) => [n, i])) });
    });
    this.names = [];
    this.nameIds = new Map();
    /* channel and bus ids, any number the TypeScript Map would key on, to the int32 the module keys on */
    this.ids = new Map();
    this.held = [];
    this.freeHandles = [];
    this.channels = new Map();
    this.buses = new Map();
    this.master = [];
    this.banks = new Map();
    this.localEngines = new Map();
    this.localEffects = new Map();
    this.buf = null;
    this.views = new Map();
    this.meterView = null;

    const self = this;
    const at = (h) => self.held[h];
    const imports = {
      env: {
        host_ch_on: (h, note, freq, vel, frame) => at(h).noteOn(note, freq, vel, frame),
        host_ch_off: (h, note) => at(h).noteOff(note),
        host_ch_alloff: (h) => at(h).allNotesOff(),
        host_ch_param: (h, name, value) => at(h).setParam(self.names[name], value),
        host_ch_process: (h, l, r, from, to) => at(h).process(self.view(l), self.view(r), from, to),
        host_fx_process: (h, l, r, n) => at(h).process(self.view(l), self.view(r), 0, n),
      },
    };
    this.ex = new WebAssembly.Instance(module, imports).exports;
    this.ex.bw_init();
    this.k = this.ex.bw_k_new(sampleRate, this.blockSize);
    if (!this.k) throw new Error('bellows-wasm: could not create the kernel');
    this.outL = this.ex.bw_k_out(this.k, 0);
    this.outR = this.ex.bw_k_out(this.k, 1);
    this.meterPtr = this.ex.bw_k_meter(this.k);
    this.scratchPtr = 0;
    this.scratchBytes = 0;
  }

  /* ---------------- memory ---------------- */

  /** A blockSize view of module memory at ptr, made again only when the memory has grown. */
  view(ptr) {
    if (this.buf !== this.ex.memory.buffer) {
      this.buf = this.ex.memory.buffer;
      this.views.clear();
      this.meterView = null;
    }
    let v = this.views.get(ptr);
    if (!v) {
      v = new Float32Array(this.buf, ptr, this.blockSize);
      this.views.set(ptr, v);
    }
    return v;
  }

  meter() {
    if (this.buf !== this.ex.memory.buffer || !this.meterView) {
      this.view(this.outL);
      this.meterView = new Float64Array(this.buf, this.meterPtr, 4);
    }
    return this.meterView;
  }

  /** Scratch memory for the arguments of one call, 8 byte aligned. */
  scratch(bytes) {
    if (bytes > this.scratchBytes) {
      if (this.scratchPtr) this.ex.bw_free(this.scratchPtr);
      const want = Math.max(bytes, 2 * this.scratchBytes, 4096);
      this.scratchPtr = this.ex.bw_alloc(want);
      this.scratchBytes = this.scratchPtr ? want : 0;
      if (!this.scratchPtr) throw new Error('bellows-wasm: out of memory');
    }
    return this.scratchPtr;
  }

  hold(obj) {
    const h = this.freeHandles.length ? this.freeHandles.pop() : this.held.length;
    this.held[h] = obj;
    return h;
  }

  release(h) {
    if (h >= 0) {
      this.held[h] = undefined;
      this.freeHandles.push(h);
    }
  }

  /** The module's int for a channel or bus id: the TypeScript keys a Map by the number itself. */
  idOf(x) {
    let i = this.ids.get(x);
    if (i === undefined) {
      i = this.ids.size;
      this.ids.set(x, i);
    }
    return i;
  }

  nameId(name) {
    let id = this.nameIds.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.names.push(name);
      this.nameIds.set(name, id);
      this.manifest.forEach((u, unit) => {
        if (u.kind !== 'engine') return;
        const i = this.units.get('engine:' + u.id).index.get(name);
        if (i !== undefined) this.ex.bw_k_name_unit(id, unit, i);
      });
    }
    return id;
  }

  /* ---------------- KernelLike ---------------- */

  get currentFrame() {
    return this.ex.bw_k_frame(this.k);
  }

  get currentTime() {
    return this.currentFrame / this.sampleRate;
  }

  setFrame(frame) {
    this.ex.bw_k_set_frame(this.k, frame);
  }

  get voiceCount() {
    let n = this.ex.bw_k_voices(this.k);
    for (const c of this.channels.values()) if (c.pool) n += c.pool.activeCount;
    return n;
  }

  get peakL() {
    return this.meter()[0];
  }
  get peakR() {
    return this.meter()[1];
  }
  get rmsL() {
    return this.meter()[2];
  }
  get rmsR() {
    return this.meter()[3];
  }

  process(outL, outR) {
    this.ex.bw_k_process(this.k);
    outL.set(this.view(this.outL));
    outR.set(this.view(this.outR));
  }

  apply(msg) {
    const ex = this.ex;
    const k = this.k;
    switch (msg.type) {
      case 'createChannel':
        this.createChannel(msg);
        break;
      case 'removeChannel': {
        const c = this.channels.get(msg.id);
        if (c) this.dropChannel(c);
        this.channels.delete(msg.id);
        ex.bw_k_channel_remove(k, this.idOf(msg.id));
        break;
      }
      case 'channelFx': {
        const c = this.channels.get(msg.id);
        if (c) c.chain = this.installChain(KIND_CHANNEL, this.idOf(msg.id), this.buildChain(msg.chain), c.chain);
        break;
      }
      case 'fxParam': {
        const c = this.channels.get(msg.channelId);
        if (c) this.fxParam(c.chain[msg.fxIndex], msg.name, msg.value);
        break;
      }
      case 'channelParam':
        if (this.channels.has(msg.id)) ex.bw_k_channel_param(k, this.idOf(msg.id), this.nameId(msg.name), msg.value);
        break;
      case 'channelGain':
        ex.bw_k_channel_gain(k, this.idOf(msg.id), msg.gain);
        break;
      case 'channelPan':
        ex.bw_k_channel_pan(k, this.idOf(msg.id), tsClamp(msg.pan, -1, 1));
        break;
      case 'createBus': {
        const slots = this.buildChain(msg.chain);
        if (!ex.bw_k_bus(k, this.idOf(msg.id), msg.returnLevel)) {
          this.freeSlots(slots);
          throw new Error('bellows-wasm: out of memory');
        }
        const old = this.buses.get(msg.id);
        if (old) this.releaseSlots(old.chain);
        this.views.clear();
        this.buses.set(msg.id, { chain: this.installChain(KIND_BUS, this.idOf(msg.id), slots, []) });
        break;
      }
      case 'busFxParam': {
        const b = this.buses.get(msg.busId);
        if (b) this.fxParam(b.chain[msg.fxIndex], msg.name, msg.value);
        break;
      }
      case 'send':
        ex.bw_k_send(k, this.idOf(msg.channelId), this.idOf(msg.busId), msg.level);
        break;
      case 'masterFx':
        this.master = this.installChain(KIND_MASTER, 0, this.buildChain(msg.chain), this.master);
        break;
      case 'masterFxParam':
        this.fxParam(this.master[msg.fxIndex], msg.name, msg.value);
        break;
      case 'masterGain':
        ex.bw_k_master_gain(k, msg.gain);
        break;
      case 'events':
        for (const e of msg.events) {
          let a = e.a;
          if (e.kind === 2 || e.kind === 3) a = this.nameId(this.env.paramName(e.a) ?? '');
          ex.bw_k_event(k, e.time, e.kind, this.idOf(e.target), a, e.b, e.c);
        }
        break;
      case 'internParam':
        this.env.internParamAt(msg.index, msg.name);
        break;
      case 'registerBank':
        this.setBank('sampler:' + msg.bankId, 'sampler', this.samplerBank(msg.zones), () =>
          this.opts.resolveBankEngine?.('sampler', msg.bankId, msg.zones),
        );
        break;
      case 'registerGrain':
        this.setBank('granular:' + msg.bankId, 'granular', this.grainBank(msg.data, msg.sampleRate), () =>
          this.opts.resolveBankEngine?.('grain', msg.bankId, { data: msg.data, sampleRate: msg.sampleRate }),
        );
        break;
      case 'defOp': {
        // Tier 3 user DSP, evaluated as the TypeScript kernel evaluates it (kernel/engine.ts).
        const def = new Function('return (' + msg.code + ')')();
        if (msg.kind === 'engine') this.localEngines.set(def.id, def);
        else this.localEffects.set(def.id, def);
        break;
      }
      case 'panic':
        ex.bw_k_panic(k);
        break;
      default:
        break;
    }
  }

  /* ---------------- banks ---------------- */

  /** Copies audio into module memory; the module frees it (bank or zone takes ownership). */
  copyIn(data, frames) {
    const ptr = this.ex.bw_alloc(4 * Math.max(1, frames));
    if (!ptr) throw new Error('bellows-wasm: out of memory for a sample bank');
    new Float32Array(this.ex.memory.buffer, ptr, frames).set(frames === data.length ? data : data.subarray(0, frames));
    return ptr;
  }

  samplerBank(zones) {
    const ex = this.ex;
    const bank = ex.bw_bank_sampler_new(zones.length);
    if (!bank) throw new Error('bellows-wasm: out of memory for a sample bank');
    const NF = ex.bw_bank_zone_fields();
    const opt = (x) => (typeof x === 'number' ? x : NaN);
    try {
      this.fillZones(bank, zones, NF, opt);
    } catch (err) {
      ex.bw_bank_free(bank);
      throw err;
    }
    return bank;
  }

  fillZones(bank, zones, NF, opt) {
    const ex = this.ex;
    zones.forEach((z, i) => {
      const frames = z.dataR ? Math.min(z.data.length, z.dataR.length) : z.data.length;
      const l = this.copyIn(z.data, frames);
      let r = 0;
      try {
        if (z.dataR) r = this.copyIn(z.dataR, frames);
      } catch (err) {
        ex.bw_free(l);
        throw err;
      }
      const env = z.env;
      const fieldsPtr = this.scratch(4 * NF);
      new Float32Array(ex.memory.buffer, fieldsPtr, NF).set([
        z.sampleRate, z.rootKey, opt(z.fineTune), z.keyLo, z.keyHi, z.velLo, z.velHi, opt(z.loopStart), opt(z.loopEnd),
        z.loopMode === 'loop' ? 1 : z.loopMode === 'loopRelease' ? 2 : 0, opt(z.gainDb), opt(z.pan),
        env ? env.attack : NaN, env ? env.hold : NaN, env ? env.decay : NaN, env ? env.sustain : NaN, env ? env.release : NaN,
        opt(z.roundRobinGroup), opt(z.seqPosition),
      ]);
      if (!ex.bw_bank_sampler_zone(bank, i, fieldsPtr, NF, l, r, frames)) {
        ex.bw_free(l);
        if (r) ex.bw_free(r);
      }
    });
  }

  grainBank(data, sampleRate) {
    const ptr = this.copyIn(data, data.length);
    const bank = this.ex.bw_bank_grain_new(ptr, data.length, sampleRate);
    if (!bank) {
      this.ex.bw_free(ptr);
      throw new Error('bellows-wasm: out of memory for a grain bank');
    }
    return bank;
  }

  /** An id registered again keeps its old bank alive for the channels already made on it. */
  setBank(id, unitId, bank, tsDef) {
    const old = this.banks.get(id);
    if (old && old.ref) this.ex.bw_k_bank_drop(this.k, old.ref);
    const ref = this.ex.bw_k_bank_add(this.k, bank);
    /* the TypeScript def too, made lazily over the message's own arrays, for a seed the module
     * cannot hash as the TypeScript does (seedFits) */
    let def;
    this.banks.set(id, {
      native: this.units.get('engine:' + unitId),
      ref,
      get def() {
        if (def === undefined) def = tsDef() ?? null;
        return def;
      },
    });
  }

  /* ---------------- channels ---------------- */

  resolveEngine(id) {
    const banked = this.banks.get(id);
    if (banked) return banked;
    const local = this.localEngines.get(id);
    if (local) return { def: local };
    const def = this.env.getEngine(id);
    const native = this.units.get('engine:' + id);
    if (native && def === this.env.builtinEngine(id)) return { def, native };
    return { def };
  }

  /*
   * A seed the module hashes as the TypeScript does: its xmur3 reads UTF-16 code units and the
   * module reads bytes, which agree when every unit is one byte (1 to 255, written as Latin-1),
   * and the labels the voices fork from it fit the module's 511 byte label buffers. Any other seed
   * plays its engine in JavaScript, so its random streams stay the TypeScript's.
   */
  static seedFits(seed) {
    if (typeof seed !== 'string' || seed.length > 450) return false;
    for (let i = 0; i < seed.length; i++) {
      const u = seed.charCodeAt(i);
      if (u === 0 || u > 255) return false;
    }
    return true;
  }

  createChannel(msg) {
    const ex = this.ex;
    let r = this.resolveEngine(msg.engineId);
    if (r.native && !WasmKernel.seedFits(msg.seed) && r.def) r = { def: r.def };
    const params = msg.params ?? {};
    const rec = [];
    for (const name in params) {
      const v = params[name];
      if (typeof v === 'number') rec.push([this.nameId(name), v]);
    }
    let pool = null;
    let handle = -1;
    let unit = -1;
    let poly = 0;
    let variant = 0;
    let seedBytes = 0;
    let nvals = 0;
    if (r.native) {
      const u = r.native.u;
      unit = r.native.unit;
      poly = msg.polyphony ?? u.polyphony ?? 16;
      /* the string's second polarization exists when the record names polDetune, as in the TypeScript */
      variant = u.id === 'string' && 'polDetune' in params ? 1 : 0;
      nvals = u.params.length;
      seedBytes = msg.seed.length + 1;
    }
    /* layout: rec values (f64), rec ids (i32), vals (f32), seed (utf8) */
    const offIds = 8 * rec.length;
    const offVals = offIds + 4 * rec.length;
    const offSeed = offVals + 4 * nvals;
    const base = this.scratch(offSeed + seedBytes + 8);
    if (!r.native) {
      pool = new this.env.VoicePool(r.def, this.sampleRate, params, this.env.rng(msg.seed), msg.polyphony);
      handle = this.hold(pool);
    }
    const mem = ex.memory.buffer;
    const recVals = new Float64Array(mem, base, rec.length);
    const recIds = new Int32Array(mem, base + offIds, rec.length);
    rec.forEach(([id, v], i) => {
      recIds[i] = id;
      recVals[i] = v;
    });
    if (r.native) {
      const vals = new Float32Array(mem, base + offVals, nvals);
      r.native.u.params.forEach((p, i) => {
        const x = params[p.name];
        vals[i] = typeof x === 'number' ? x : p.default;
      });
      const b = new Uint8Array(mem, base + offSeed, seedBytes);
      for (let i = 0; i < msg.seed.length; i++) b[i] = msg.seed.charCodeAt(i);
      b[msg.seed.length] = 0;
    }
    const ok = ex.bw_k_channel(this.k, this.idOf(msg.id), unit, handle, base + offSeed, base + offVals, variant, poly, base + offIds, base, rec.length, r.ref ?? 0);
    if (!ok) {
      this.release(handle);
      throw new Error(`bellows-wasm: could not create a ${msg.engineId} channel`);
    }
    const old = this.channels.get(msg.id);
    if (old) this.dropChannel(old);
    this.channels.set(msg.id, { handle, pool, chain: [] });
  }

  dropChannel(c) {
    this.views.clear();
    this.release(c.handle);
    this.releaseSlots(c.chain);
  }

  /* ---------------- effects ---------------- */

  /** Builds every effect of a chain, the module's and the foreign ones, before touching the old one. */
  buildChain(chain) {
    const ex = this.ex;
    const out = [];
    try {
      for (const spec of chain) {
        const local = this.localEffects.get(spec.effectId);
        const def = local ?? this.env.getEffect(spec.effectId);
        const native = local ? undefined : this.units.get('effect:' + spec.effectId);
        if (native && def === this.env.builtinEffect(spec.effectId)) {
          const p = spec.params ?? {};
          const base = this.scratch(4 * native.u.params.length + 8);
          const vals = new Float32Array(ex.memory.buffer, base, native.u.params.length);
          native.u.params.forEach((ps, i) => {
            const x = p[ps.name];
            vals[i] = typeof x === 'number' ? x : ps.default;
          });
          const fx = ex.bw_fx_new(native.unit, this.sampleRate, base, fxAux(spec.effectId, p));
          if (!fx) throw new Error(`bellows-wasm: could not create ${spec.effectId} at ${this.sampleRate} Hz`);
          const slot = { fx, native, handle: -1, effect: null };
          out.push(slot);
          if (spec.params) for (const [name, value] of Object.entries(spec.params)) this.fxParam(slot, name, value);
        } else {
          const effect = def.create(this.sampleRate, spec.params ?? {});
          if (spec.params) for (const [name, value] of Object.entries(spec.params)) effect.setParam(name, value);
          out.push({ fx: 0, native: null, handle: -1, effect });
        }
      }
    } catch (err) {
      this.freeSlots(out);
      throw err;
    }
    return out;
  }

  /** Replaces a chain in the module with built slots; returns them as the new mirror. */
  installChain(kind, id, slots, old) {
    const ex = this.ex;
    ex.bw_k_chain_clear(this.k, kind, id);
    this.releaseSlots(old);
    const placed = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.fx) s.handle = this.hold(s.effect);
      /* the module owns (and on failure frees) a native effect once pushed */
      if (!ex.bw_k_chain_push(this.k, kind, id, s.fx, s.fx ? -1 : s.handle)) {
        this.release(s.handle);
        this.freeSlots(slots.slice(i + 1));
        this.releaseSlots(placed);
        ex.bw_k_chain_clear(this.k, kind, id);
        throw new Error('bellows-wasm: out of memory building an effect chain');
      }
      placed.push(s);
    }
    return slots;
  }

  /** Frees built slots that never reached the module. */
  freeSlots(slots) {
    for (const s of slots) if (s.fx) this.ex.bw_fx_free(s.fx);
  }

  /** Lets go of the foreign effects of a chain the module has dropped. */
  releaseSlots(slots) {
    for (const s of slots) this.release(s.handle);
  }

  fxParam(slot, name, value) {
    if (!slot) return;
    if (slot.fx) {
      const i = slot.native.index.get(name);
      if (i !== undefined && typeof value === 'number' && Number.isFinite(value)) this.ex.bw_fx_set(slot.fx, i, value);
    } else {
      slot.effect.setParam(name, value);
    }
  }
}

function createKernel(module, manifest, sampleRate, opts, env) {
  return new WasmKernel(module, manifest, sampleRate, opts, env);
}

export { createKernel, WasmKernel };

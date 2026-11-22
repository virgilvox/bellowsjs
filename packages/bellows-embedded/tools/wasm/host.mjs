/*
 * Build and run the embedded library's C++ programs as WebAssembly, in process.
 *
 *   buildWasm(sources, out, { defines })  compile C++ sources plus tools/wasm/libc.c to one module
 *                                         (or plus `runtime`, a C file of your own, for a library)
 *   loadProgram(path)                     a run(args, env) that returns stdout as a Buffer
 *
 * The toolchain is Homebrew's LLVM (clang with the wasm32 target) and Rust's rust-lld, linking
 * musl's libm out of Rust's wasm32 compiler-builtins. Nothing else: the C library is libc.c, and
 * the three things it cannot do alone (write, getenv, and printing or parsing a double) are the
 * imports below. Paths can be overridden with BELLOWS_WASM_CLANG, BELLOWS_WASM_LLD and
 * BELLOWS_WASM_BUILTINS.
 *
 * Every run instantiates a fresh module, so the bump allocator and the C++ statics start clean the
 * way a new native process does.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');

function rustLib(target) {
  const roots = [join(homedir(), '.rustup', 'toolchains')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const tc of readdirSync(root).sort()) {
      const host = readdirSync(join(root, tc, 'lib', 'rustlib')).find((d) => existsSync(join(root, tc, 'lib', 'rustlib', d, 'bin', 'rust-lld')));
      const lib = join(root, tc, 'lib', 'rustlib', target, 'lib');
      if (host && existsSync(lib)) return { lld: join(root, tc, 'lib', 'rustlib', host, 'bin', 'rust-lld'), lib };
    }
  }
  return null;
}

export function toolchain() {
  const clang = process.env.BELLOWS_WASM_CLANG || ['/opt/homebrew/opt/llvm/bin/clang', '/usr/local/opt/llvm/bin/clang'].find(existsSync);
  const rust = rustLib('wasm32-unknown-unknown');
  const lld = process.env.BELLOWS_WASM_LLD || rust?.lld;
  const builtins =
    process.env.BELLOWS_WASM_BUILTINS ||
    (rust && readdirSync(rust.lib).filter((f) => f.startsWith('libcompiler_builtins-')).map((f) => join(rust.lib, f))[0]);
  const missing = [!clang && 'clang with the wasm32 target (brew install llvm)', !lld && 'rust-lld (rustup)', !builtins && 'the wasm32 target (rustup target add wasm32-unknown-unknown)'].filter(Boolean);
  if (missing.length) throw new Error(`wasm toolchain incomplete: ${missing.join(', ')}`);
  return { clang, lld, builtins };
}

/* Same optimisation level as the native harness builds (-O2), no exceptions or RTTI, and
 * single-threaded statics because there is one thread. */
const CFLAGS = ['--target=wasm32', '-O2', '-nostdlibinc', '-isystem', join(HERE, 'include'), '-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics'];

export function buildWasm(sources, out, { defines = [], include = [join(PKG, 'src')], runtime = join(HERE, 'libc.c'), opt = '-O2' } = {}) {
  const { clang, lld, builtins } = toolchain();
  const dir = join(dirname(out), 'obj-' + basename(out, '.wasm'));
  mkdirSync(dir, { recursive: true });
  /* clang's own stddef/stdint/stdarg/float.h are freestanding and come from its resource dir,
   * which -nostdlibinc keeps; only the hosted headers are replaced by include/. */
  const objs = [];
  const compile = (src, lang) => {
    const obj = join(dir, basename(src).replace(/\.\w+$/, '.o'));
    const std = lang === 'c' ? ['-std=c11', '-xc'] : ['-std=c++17', '-xc++'];
    execFileSync(clang, [...CFLAGS.map((f) => (f === '-O2' ? opt : f)), ...std, ...defines.map((d) => '-D' + d), ...include.flatMap((i) => ['-I', i]), '-c', src, '-o', obj], { stdio: ['ignore', 'inherit', 'inherit'] });
    objs.push(obj);
  };
  for (const s of sources) compile(s, 'c++');
  compile(runtime, 'c');
  execFileSync(lld, ['-flavor', 'wasm', '--no-entry', '--gc-sections', '-z', 'stack-size=1048576', '--initial-memory=16777216', ...objs, builtins, '-o', out], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return out;
}

/* printf's floating conversions, from the flags, width and precision libc.c parsed. */
function fmtDouble(conv, flags, width, prec, v) {
  const upper = conv === conv.toUpperCase();
  const c = conv.toLowerCase();
  const hash = flags & 16;
  let sign = v < 0 || Object.is(v, -0) ? '-' : flags & 2 ? '+' : flags & 4 ? ' ' : '';
  const a = Math.abs(v);
  let body;
  const exp = (s) => s.replace(/e([+-])(\d)$/, 'e$10$2');
  if (!Number.isFinite(a)) {
    body = Number.isNaN(a) ? 'nan' : 'inf';
    if (Number.isNaN(v)) sign = flags & 2 ? '+' : flags & 4 ? ' ' : '';
  } else if (c === 'f') {
    const d = prec < 0 ? 6 : prec;
    /* toFixed switches to exponent form at 1e21; a double that large is an integer */
    body = a < 1e21 ? a.toFixed(d) : BigInt(a).toString() + (d ? '.' + '0'.repeat(d) : '');
    if (hash && prec === 0) body += '.';
  } else if (c === 'e') {
    body = exp(a.toExponential(prec < 0 ? 6 : prec));
  } else if (c === 'g') {
    const P = prec < 0 ? 6 : prec === 0 ? 1 : prec;
    const X = a === 0 ? 0 : Number(a.toExponential(P - 1).split('e')[1]);
    if (P > X && X >= -4) body = a.toFixed(P - 1 - X);
    else body = exp(a.toExponential(P - 1));
  } else {
    body = a.toString(16);
  }
  if (c === 'g' && !hash && body.includes('.')) {
    /* trailing zeros of the fraction, and a bare point, go */
    body = body.replace(/(\.\d*?)0+(e|$)/, '$1$2').replace(/\.(e|$)/, '$1');
  }
  if (upper) body = body.toUpperCase();
  let s = sign + body;
  if (s.length < width) {
    if (flags & 1) s = s.padEnd(width);
    else if (flags & 8 && Number.isFinite(a)) s = sign + body.padStart(width - sign.length, '0');
    else s = s.padStart(width);
  }
  return s;
}

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

export function loadProgram(path) {
  const module = new WebAssembly.Module(readFileSync(path));
  return function run(args = [], env = {}) {
    const out = [];
    const err = [];
    let mem;
    let ex;
    const bytes = () => new Uint8Array(mem.buffer);
    const cstr = (p) => {
      const b = bytes();
      let e = p;
      while (b[e]) e++;
      return Buffer.from(b.subarray(p, e)).toString('utf8');
    };
    const put = (s) => {
      const enc = Buffer.from(s + '\0', 'utf8');
      const p = ex.bw_alloc(enc.length);
      bytes().set(enc, p);
      return p;
    };
    const envCache = new Map();
    const host = {
      write(fd, p, n) {
        (fd === 2 ? err : out).push(Buffer.from(bytes().slice(p, p + n)));
      },
      getenv(p) {
        const name = cstr(p);
        if (!(name in env) || env[name] === undefined) return 0;
        if (!envCache.has(name)) envCache.set(name, put(String(env[name])));
        return envCache.get(name);
      },
      fmt_double(conv, flags, width, prec, v, outp, cap) {
        const enc = Buffer.from(fmtDouble(String.fromCharCode(conv), flags, width, prec, v), 'utf8').subarray(0, cap);
        bytes().set(enc, outp);
        return enc.length;
      },
      parse_double(p, usedp) {
        const s = cstr(p);
        const m = /^\s*[+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i.exec(s);
        new DataView(mem.buffer).setInt32(usedp, m ? m[0].length : 0, true);
        if (!m) return 0;
        const t = m[0].trim().toLowerCase();
        return /inf/.test(t) ? (t.startsWith('-') ? -Infinity : Infinity) : /nan/.test(t) ? NaN : Number(t);
      },
      exit(code) {
        throw new Exit(code);
      },
      now_ns() {
        return performance.now() * 1e6;
      },
    };
    const inst = new WebAssembly.Instance(module, { host });
    ex = inst.exports;
    mem = ex.memory;
    const argv = [basename(path, '.wasm'), ...args.map(String)];
    const ptrs = argv.map(put);
    const av = ex.bw_alloc(4 * (ptrs.length + 1));
    const dv = new DataView(mem.buffer);
    ptrs.forEach((p, i) => dv.setUint32(av + 4 * i, p, true));
    dv.setUint32(av + 4 * ptrs.length, 0, true);
    let code;
    try {
      code = ex.bw_run(argv.length, av);
    } catch (e) {
      if (!(e instanceof Exit)) throw e;
      code = e.code;
    }
    const stderr = Buffer.concat(err).toString();
    if (code !== 0) {
      const e = new Error(`${basename(path)} ${args.join(' ')} exited ${code}${stderr ? ': ' + stderr.trim() : ''}`);
      e.status = code;
      throw e;
    }
    if (stderr) process.stderr.write(stderr);
    return Buffer.concat(out);
  };
}

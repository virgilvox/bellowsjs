/*
 * The smallest C library the parity harnesses need, for wasm32 with no system libc.
 *
 * Three imports from the host (tools/wasm/host.mjs): write bytes to fd 1 or 2, look up an
 * environment variable, and format one double or parse one decimal number. Doubles go to the host
 * because getting %.9g and atof exactly right is a library of its own, and JavaScript already has
 * one: toPrecision, toFixed and Number() are correctly rounded, so the harness prints the same
 * digits the native build does.
 *
 * Everything else is here: a bump allocator over linear memory, integer and string printf, the
 * string functions the harnesses call, and the entry point. mem* and strlen come from
 * compiler-builtins, with musl's libm.
 */
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>

#include "include/stdio.h"
#include "include/stdlib.h"
#include "include/string.h"

#define IMPORT(name) __attribute__((import_module("host"), import_name(name)))
#define EXPORT(name) __attribute__((export_name(name)))

IMPORT("write") void host_write(int fd, const char* p, size_t n);
IMPORT("getenv") char* host_getenv(const char* name);
IMPORT("fmt_double") int host_fmt_double(char conv, int flags, int width, int prec, double v, char* out, int cap);
IMPORT("parse_double") double host_parse_double(const char* s, int* used);
IMPORT("exit") _Noreturn void host_exit(int code);

/* ---- memory ---- */

extern unsigned char __heap_base;
static uintptr_t brk_ = 0;

EXPORT("bw_alloc") void* malloc(size_t n) {
  if (!brk_) brk_ = (uintptr_t)&__heap_base;
  uintptr_t p = (brk_ + 15) & ~(uintptr_t)15;
  uintptr_t end = p + n;
  uintptr_t have = __builtin_wasm_memory_size(0) * 65536u;
  if (end > have) {
    size_t pages = (end - have + 65535u) / 65536u;
    if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return NULL;
  }
  brk_ = end;
  return (void*)p;
}

/* Fresh pages are zero and nothing is ever freed, so calloc only has to ask. */
void* calloc(size_t a, size_t b) {
  void* p = malloc(a * b);
  if (p) memset(p, 0, a * b);
  return p;
}
void* realloc(void* old, size_t n) {
  void* p = malloc(n);
  if (p && old) memmove(p, old, n);
  return p;
}
void free(void* p) { (void)p; }

/* ---- output ---- */

struct BwFile {
  int fd;
  size_t len;
  char buf[1 << 16];
};
static struct BwFile out_ = {1, 0, {0}};
static struct BwFile err_ = {2, 0, {0}};
FILE* const stdout = &out_;
FILE* const stderr = &err_;

int fflush(FILE* f) {
  if (!f) {
    fflush(stdout);
    return fflush(stderr);
  }
  if (f->len) host_write(f->fd, f->buf, f->len);
  f->len = 0;
  return 0;
}

static void put(FILE* f, const char* p, size_t n) {
  if (n >= sizeof f->buf) {
    fflush(f);
    host_write(f->fd, p, n);
    return;
  }
  if (f->len + n > sizeof f->buf) fflush(f);
  memcpy(f->buf + f->len, p, n);
  f->len += n;
}

size_t fwrite(const void* p, size_t size, size_t count, FILE* f) {
  put(f, (const char*)p, size * count);
  return count;
}
int fputs(const char* s, FILE* f) {
  put(f, s, strlen(s));
  return 0;
}
int puts(const char* s) {
  fputs(s, stdout);
  put(stdout, "\n", 1);
  return 0;
}
int putchar(int c) {
  char ch = (char)c;
  put(stdout, &ch, 1);
  return c;
}

/* ---- printf ---- */

enum { F_MINUS = 1, F_PLUS = 2, F_SPACE = 4, F_ZERO = 8, F_HASH = 16 };

/* A sink is either a FILE or a bounded buffer; snprintf counts what it could not store. */
typedef struct {
  FILE* f;
  char* s;
  size_t cap;
  size_t n;
} Sink;

static void emit(Sink* k, const char* p, size_t n) {
  if (k->f) {
    put(k->f, p, n);
  } else {
    for (size_t i = 0; i < n; ++i) {
      if (k->n + i + 1 < k->cap) k->s[k->n + i] = p[i];
    }
  }
  k->n += n;
}
static void pad(Sink* k, char c, int n) {
  for (; n > 0; --n) emit(k, &c, 1);
}

static void emit_int(Sink* k, uint64_t mag, int neg, int base, int upper, int flags, int width, int prec) {
  char digits[24];
  int nd = 0;
  const char* set = upper ? "0123456789ABCDEF" : "0123456789abcdef";
  if (mag == 0 && prec != 0) digits[nd++] = '0';
  while (mag) {
    digits[nd++] = set[mag % (uint64_t)base];
    mag /= (uint64_t)base;
  }
  int zeros = prec > nd ? prec - nd : 0;
  char sign = neg ? '-' : (flags & F_PLUS) ? '+' : (flags & F_SPACE) ? ' ' : 0;
  int body = nd + zeros + (sign ? 1 : 0);
  int fill = width > body ? width - body : 0;
  int zero_pad = (flags & F_ZERO) && !(flags & F_MINUS) && prec < 0;
  if (!(flags & F_MINUS) && !zero_pad) pad(k, ' ', fill);
  if (sign) emit(k, &sign, 1);
  if (zero_pad) pad(k, '0', fill);
  pad(k, '0', zeros);
  while (nd) emit(k, &digits[--nd], 1);
  if (flags & F_MINUS) pad(k, ' ', fill);
}

static int vformat(Sink* k, const char* fmt, va_list ap) {
  for (const char* p = fmt; *p; ++p) {
    if (*p != '%') {
      const char* q = p;
      while (*q && *q != '%') ++q;
      emit(k, p, (size_t)(q - p));
      p = q - 1;
      continue;
    }
    ++p;
    int flags = 0;
    for (;; ++p) {
      if (*p == '-') flags |= F_MINUS;
      else if (*p == '+') flags |= F_PLUS;
      else if (*p == ' ') flags |= F_SPACE;
      else if (*p == '0') flags |= F_ZERO;
      else if (*p == '#') flags |= F_HASH;
      else break;
    }
    int width = 0;
    if (*p == '*') {
      width = va_arg(ap, int);
      if (width < 0) {
        flags |= F_MINUS;
        width = -width;
      }
      ++p;
    } else {
      while (*p >= '0' && *p <= '9') width = width * 10 + (*p++ - '0');
    }
    int prec = -1;
    if (*p == '.') {
      ++p;
      prec = 0;
      if (*p == '*') {
        prec = va_arg(ap, int);
        ++p;
      } else {
        while (*p >= '0' && *p <= '9') prec = prec * 10 + (*p++ - '0');
      }
    }
    int lng = 0; /* 0 int, 1 long (32-bit here), 2 long long, 3 size_t */
    while (*p == 'l' || *p == 'h' || *p == 'z' || *p == 'j' || *p == 't') {
      if (*p == 'l') ++lng;
      else if (*p == 'z' || *p == 't') lng = 3;
      else if (*p == 'j') lng = 2;
      ++p;
    }
    char c = *p;
    switch (c) {
      case 'd':
      case 'i': {
        int64_t v = lng == 2 ? va_arg(ap, long long) : lng == 1 ? va_arg(ap, long) : lng == 3 ? (int64_t)va_arg(ap, ptrdiff_t) : va_arg(ap, int);
        emit_int(k, v < 0 ? (uint64_t)(-(v + 1)) + 1 : (uint64_t)v, v < 0, 10, 0, flags, width, prec);
        break;
      }
      case 'u':
      case 'x':
      case 'X':
      case 'o': {
        uint64_t v = lng == 2 ? va_arg(ap, unsigned long long) : lng == 1 ? va_arg(ap, unsigned long) : lng == 3 ? va_arg(ap, size_t) : va_arg(ap, unsigned);
        emit_int(k, v, 0, c == 'u' ? 10 : c == 'o' ? 8 : 16, c == 'X', flags & ~(F_PLUS | F_SPACE), width, prec);
        break;
      }
      case 'p':
        emit(k, "0x", 2);
        emit_int(k, (uintptr_t)va_arg(ap, void*), 0, 16, 0, 0, 0, -1);
        break;
      case 'c': {
        char ch = (char)va_arg(ap, int);
        if (!(flags & F_MINUS)) pad(k, ' ', width - 1);
        emit(k, &ch, 1);
        if (flags & F_MINUS) pad(k, ' ', width - 1);
        break;
      }
      case 's': {
        const char* s = va_arg(ap, const char*);
        if (!s) s = "(null)";
        size_t n = strlen(s);
        if (prec >= 0 && (size_t)prec < n) n = (size_t)prec;
        int fill = width > (int)n ? width - (int)n : 0;
        if (!(flags & F_MINUS)) pad(k, ' ', fill);
        emit(k, s, n);
        if (flags & F_MINUS) pad(k, ' ', fill);
        break;
      }
      case 'f':
      case 'F':
      case 'e':
      case 'E':
      case 'g':
      case 'G':
      case 'a':
      case 'A': {
        char tmp[512];
        double v = va_arg(ap, double);
        int n = host_fmt_double(c, flags, width, prec, v, tmp, (int)sizeof tmp);
        emit(k, tmp, (size_t)n);
        break;
      }
      case '%':
        emit(k, "%", 1);
        break;
      case 0:
        return (int)k->n;
      default:
        emit(k, p - 1, 2);
        break;
    }
  }
  return (int)k->n;
}

int vfprintf(FILE* f, const char* fmt, va_list ap) {
  Sink k = {f, NULL, 0, 0};
  return vformat(&k, fmt, ap);
}
int vsnprintf(char* s, size_t cap, const char* fmt, va_list ap) {
  Sink k = {NULL, s, cap, 0};
  int n = vformat(&k, fmt, ap);
  if (cap) s[k.n < cap ? k.n : cap - 1] = 0;
  return n;
}
int printf(const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int n = vfprintf(stdout, fmt, ap);
  va_end(ap);
  return n;
}
int fprintf(FILE* f, const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int n = vfprintf(f, fmt, ap);
  va_end(ap);
  return n;
}
int snprintf(char* s, size_t cap, const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(s, cap, fmt, ap);
  va_end(ap);
  return n;
}

/* ---- strings and numbers ---- */

int strcmp(const char* a, const char* b) {
  while (*a && *a == *b) ++a, ++b;
  return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char* a, const char* b, size_t n) {
  for (; n; --n, ++a, ++b) {
    if (*a != *b || !*a) return (unsigned char)*a - (unsigned char)*b;
  }
  return 0;
}
char* strchr(const char* s, int c) {
  for (;; ++s) {
    if (*s == (char)c) return (char*)s;
    if (!*s) return NULL;
  }
}
char* strcpy(char* d, const char* s) {
  char* o = d;
  while ((*d++ = *s++)) {
  }
  return o;
}

static int digit(char c, int base) {
  int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'z' ? c - 'a' + 10 : c >= 'A' && c <= 'Z' ? c - 'A' + 10 : 99;
  return d < base ? d : -1;
}
static unsigned long long parse_int(const char* s, char** end, int base, int* neg) {
  while (*s == ' ' || (*s >= '\t' && *s <= '\r')) ++s;
  *neg = 0;
  if (*s == '-' || *s == '+') *neg = *s++ == '-';
  if ((base == 0 || base == 16) && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
    s += 2;
    base = 16;
  } else if (base == 0) {
    base = s[0] == '0' ? 8 : 10;
  }
  unsigned long long v = 0;
  int d;
  while ((d = digit(*s, base)) >= 0) v = v * (unsigned)base + (unsigned)d, ++s;
  if (end) *end = (char*)s;
  return v;
}
long strtol(const char* s, char** end, int base) {
  int neg;
  unsigned long long v = parse_int(s, end, base, &neg);
  return neg ? -(long)v : (long)v;
}
unsigned long strtoul(const char* s, char** end, int base) {
  int neg;
  unsigned long long v = parse_int(s, end, base, &neg);
  return (unsigned long)(neg ? -v : v);
}
int atoi(const char* s) { return (int)strtol(s, NULL, 10); }
int abs(int v) { return v < 0 ? -v : v; }
double strtod(const char* s, char** end) {
  int used = 0;
  double v = host_parse_double(s, &used);
  if (end) *end = (char*)s + used;
  return v;
}
double atof(const char* s) { return strtod(s, NULL); }

char* getenv(const char* name) { return host_getenv(name); }

_Noreturn void exit(int code) {
  fflush(NULL);
  host_exit(code);
}
_Noreturn void abort(void) { exit(134); }

/* ---- C++ runtime, the parts a header-only library with no exceptions can still reach ---- */

int __cxa_atexit(void (*fn)(void*), void* arg, void* dso) {
  (void)fn, (void)arg, (void)dso;
  return 0;
}
void* __dso_handle = 0;
void __cxa_pure_virtual(void) { abort(); }

/* ---- entry ---- */

/* clang names a C++ `main(int, char**)` __main_argc_argv on wasm32 and a `main()` __main_void, so
 * the harnesses compile unchanged and whichever one a harness defines is the one that links. */
extern int __main_argc_argv(int, char**) __attribute__((weak));
extern int __main_void(void) __attribute__((weak));
extern void __wasm_call_ctors(void);

EXPORT("bw_run") int bw_run(int argc, char** argv) {
  __wasm_call_ctors();
  int code = __main_argc_argv ? __main_argc_argv(argc, argv) : __main_void();
  fflush(NULL);
  return code;
}

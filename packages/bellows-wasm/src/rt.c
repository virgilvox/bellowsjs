/*
 * What the module needs from a C library, and nothing else: an allocator and the few symbols C++
 * code generation reaches for. memset, memcpy and the libm functions come from compiler-builtins
 * at link time.
 *
 * The allocator hands out 16 byte aligned blocks with a 16 byte header holding the block's size.
 * free() puts a block on the list for its exact size and malloc() takes from that list first.
 * Voices and effects are allocated in a handful of fixed sizes, one per unit, so a page that
 * swaps engines back and forth reuses the same blocks instead of growing the heap each time.
 */
#include <stddef.h>
#include <stdint.h>

extern unsigned char __heap_base;

static uintptr_t top;

typedef struct Free {
  struct Free* next;
} Free;

#define kLists 64
static struct {
  size_t size;
  Free* head;
} lists[kLists];
static int nlists;

static int grow_to(uintptr_t end) {
  const uintptr_t have = __builtin_wasm_memory_size(0) * 65536u;
  if (end <= have) return 1;
  const uintptr_t pages = (end - have + 65535u) / 65536u;
  return __builtin_wasm_memory_grow(0, pages) != (size_t)-1;
}

void* malloc(size_t n) {
  const size_t size = (n + 15u) & ~(size_t)15u;
  for (int i = 0; i < nlists; ++i) {
    if (lists[i].size == size && lists[i].head) {
      Free* f = lists[i].head;
      lists[i].head = f->next;
      return f;
    }
  }
  if (!top) top = ((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u;
  const uintptr_t block = top;
  const uintptr_t end = block + 16u + size;
  if (!grow_to(end)) return 0;
  top = end;
  *(size_t*)block = size;
  return (void*)(block + 16u);
}

void free(void* p) {
  if (!p) return;
  const size_t size = *(size_t*)((uintptr_t)p - 16u);
  int i = 0;
  while (i < nlists && lists[i].size != size) ++i;
  if (i == nlists) {
    if (nlists == kLists) return; /* more distinct sizes than lists: the block is kept, not reused */
    lists[nlists].size = size;
    lists[nlists].head = 0;
    ++nlists;
  }
  Free* f = (Free*)p;
  f->next = lists[i].head;
  lists[i].head = f;
}

void* calloc(size_t n, size_t m) {
  const size_t total = n * m;
  if (m && total / m != n) return 0;
  void* p = malloc(total);
  if (p) __builtin_memset(p, 0, total);
  return p;
}

void* realloc(void* p, size_t n) {
  if (!p) return malloc(n);
  const size_t have = *(size_t*)((uintptr_t)p - 16u);
  if (n <= have) return p;
  void* q = malloc(n);
  if (q) {
    __builtin_memcpy(q, p, have);
    free(p);
  }
  return q;
}

__attribute__((export_name("bw_alloc"))) void* bw_alloc(size_t n) { return malloc(n); }
__attribute__((export_name("bw_free"))) void bw_free(void* p) { free(p); }

_Noreturn void abort(void) { __builtin_trap(); }
void __cxa_pure_virtual(void) { __builtin_trap(); }
int __cxa_atexit(void (*f)(void*), void* a, void* d) {
  (void)f;
  (void)a;
  (void)d;
  return 0;
}
void* __dso_handle = 0;

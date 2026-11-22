/* stdio.h for the WebAssembly build: only what the parity harnesses print with. Output goes to the
 * host's write import; floats are formatted by the host (tools/wasm/host.mjs). */
#pragma once
#include <stdarg.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct BwFile FILE;
extern FILE* const stdout;
extern FILE* const stderr;
int printf(const char*, ...);
int fprintf(FILE*, const char*, ...);
int snprintf(char*, size_t, const char*, ...);
int vsnprintf(char*, size_t, const char*, va_list);
int vfprintf(FILE*, const char*, va_list);
int puts(const char*);
int putchar(int);
int fputs(const char*, FILE*);
size_t fwrite(const void*, size_t, size_t, FILE*);
int fflush(FILE*);
#ifdef __cplusplus
}
#endif

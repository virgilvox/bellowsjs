/* stdlib.h for the WebAssembly build. The allocator is a bump allocator: each harness run gets a
 * fresh instance, so free() has nothing to give back to. */
#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
void* malloc(size_t);
void* calloc(size_t, size_t);
void* realloc(void*, size_t);
void free(void*);
int atoi(const char*);
long strtol(const char*, char**, int);
unsigned long strtoul(const char*, char**, int);
double atof(const char*);
double strtod(const char*, char**);
char* getenv(const char*);
_Noreturn void exit(int);
_Noreturn void abort(void);
int abs(int);
#ifdef __cplusplus
}
#endif

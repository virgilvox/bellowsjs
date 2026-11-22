/* string.h for the WebAssembly build. mem* and strlen come from compiler-builtins. */
#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
void* memcpy(void*, const void*, size_t);
void* memmove(void*, const void*, size_t);
void* memset(void*, int, size_t);
int memcmp(const void*, const void*, size_t);
size_t strlen(const char*);
int strcmp(const char*, const char*);
int strncmp(const char*, const char*, size_t);
char* strchr(const char*, int);
char* strcpy(char*, const char*);
#ifdef __cplusplus
}
#endif

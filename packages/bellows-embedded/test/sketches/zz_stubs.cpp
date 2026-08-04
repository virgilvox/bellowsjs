/* Minimal freestanding stubs so newlib's libm links without a full BSP.
 * Not part of the library; the harness only needs the symbols to exist. */
extern "C" {
static int errno_storage;
int* __errno() { return &errno_storage; }
void _exit(int) { for (;;) {} }
}

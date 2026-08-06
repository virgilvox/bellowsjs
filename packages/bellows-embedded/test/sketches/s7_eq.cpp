#include "harness.h"
#include "bellows/fx/eq.h"
static bellows::Eq3 eq;
extern "C" int main() { eq.Init(kSampleRate); eq.Process(g_l,g_r,0,kBlock); Sink(g_l,g_r,kBlock); return 0; }

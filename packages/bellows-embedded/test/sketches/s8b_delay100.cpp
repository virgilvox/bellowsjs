#include "harness.h"
#include "bellows/fx/delay.h"
static bellows::StereoDelay<100, 48000> d;
extern "C" int main() { d.Init(kSampleRate); d.Process(g_l,g_r,0,kBlock); Sink(g_l,g_r,kBlock); return 0; }

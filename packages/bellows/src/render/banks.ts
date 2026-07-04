/*
 * Bank engine resolver: turns registered sample data into EngineDefs.
 * Injected into KernelEngine by both the worklet entry and the offline
 * renderer, so the kernel itself never imports the engines layer.
 */

import type { EngineDef } from '../types';
import type { SamplerZoneData } from '../kernel/messages';
import { SamplerBank, makeSamplerEngine, type SampleZone } from '../engines/sampler';
import { makeGranularEngine } from '../engines/granular';

export function bankEngineResolver(
  kind: 'sampler' | 'grain',
  bankId: string,
  data: SamplerZoneData[] | { data: Float32Array; sampleRate: number },
): EngineDef {
  if (kind === 'sampler') {
    const bank = new SamplerBank();
    for (const zone of data as SamplerZoneData[]) bank.addZone(zone as SampleZone);
    return makeSamplerEngine(bank, 'sampler:' + bankId);
  }
  const grain = data as { data: Float32Array; sampleRate: number };
  return makeGranularEngine(grain.data, grain.sampleRate, 'granular:' + bankId);
}

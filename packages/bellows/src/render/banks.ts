/*
 * Bank engine resolver: turns registered sample data into EngineDefs.
 * Injected into KernelEngine by both the worklet entry and the offline
 * renderer, so the kernel itself never imports the engines layer.
 */

import type { EngineDef } from '../types';
import type { SamplerZoneData } from '../kernel/messages';
import { SamplerBank, makeSamplerEngine, type SampleZone } from '../engines/sampler';
import { makeGranularEngine } from '../engines/granular';

/*
 * SamplerZoneData and SampleZone are the same record declared twice on
 * purpose: the kernel bundle must not pull in engines/, so kernel/messages.ts
 * carries its own copy. This function is where the two meet, and it used to
 * meet them with `zone as SampleZone`, which is a cast and therefore reports
 * nothing. A required field added to SampleZone was caught at three unrelated
 * call sites and not here. An optional field added to SamplerZoneData was
 * caught nowhere at all.
 *
 * SameShape is a compile-time proof that the field lists and the field types
 * still agree in both directions, so a field added, removed, retyped or made
 * optional on either side fails `tsc --noEmit` on the ZoneShapesAgree line.
 * Mutual assignability alone is not enough: an extra optional field on either
 * side passes it, which is why the key lists are compared as well.
 */
type SameShape<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;
type Assert<T extends true> = T;
type ZoneShapesAgree = Assert<SameShape<SamplerZoneData, SampleZone>>;

export function bankEngineResolver(
  kind: 'sampler' | 'grain',
  bankId: string,
  data: SamplerZoneData[] | { data: Float32Array; sampleRate: number },
): EngineDef {
  if (kind === 'sampler') {
    const bank = new SamplerBank();
    for (const zone of data as SamplerZoneData[]) bank.addZone(zone);
    return makeSamplerEngine(bank, 'sampler:' + bankId);
  }
  const grain = data as { data: Float32Array; sampleRate: number };
  return makeGranularEngine(grain.data, grain.sampleRate, 'granular:' + bankId);
}

/*
 * Serializes an EngineDef or EffectDef to a source string for transport
 * into the worklet realm (tier 3 defOp). Functions are emitted via
 * toString(), so defs must be self-contained: no captured closures, no
 * imports, numeric params only. The kernel rehydrates with new Function.
 */

export function serializeDef(def: object): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(def)) {
    if (typeof value === 'function') {
      const src = value.toString();
      // method shorthand ("createVoice(a, b) {...}") is already valid inside
      // an object literal; arrow and function expressions need key: prefix
      if (/^(async\s+)?(function|\()/.test(src) || src.includes('=>')) {
        parts.push(JSON.stringify(key) + ': ' + src);
      } else {
        parts.push(src);
      }
    } else {
      parts.push(JSON.stringify(key) + ': ' + JSON.stringify(value));
    }
  }
  return '{ ' + parts.join(', ') + ' }';
}

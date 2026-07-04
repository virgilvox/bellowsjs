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
      // Classify by how the source STARTS, never by what the body contains
      // (a method shorthand whose body holds an arrow must stay shorthand).
      // Function expressions and arrows need a key: prefix; method shorthand
      // is already valid inside an object literal.
      const isFunctionExpr = /^(async\s+)?function\b/.test(src);
      const isArrow = /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(src);
      if (isFunctionExpr || isArrow) {
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

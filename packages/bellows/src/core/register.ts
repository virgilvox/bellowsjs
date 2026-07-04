/*
 * Registers every built-in engine and effect. Called once by the facade at
 * boot, by the worklet entry at load, and by the offline renderer, so all
 * three realms resolve the same ids to the same DSP.
 */

let done = false;

export function registerBuiltins(): void {
  if (done) return;
  done = true;
  // Filled in as engine and effect domains land. Idempotent by design.
}

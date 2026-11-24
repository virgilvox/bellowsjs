/*
 * The name and shape of what the kernel leaves on the AudioWorkletGlobalScope for plugins
 * (kernel/plugin.ts). Its own file so the worklet bundle takes only this, not the plugin loader.
 */

/** What the kernel leaves on the worklet's global scope for plugins. */
export interface KernelHook {
  /** The hook's version; 1 has registerEngine and registerEffect, 2 adds registerKernel. */
  version: number;
  registerEngine(def: unknown): void;
  registerEffect(def: unknown): void;
  /**
   * Version 2: makes a kernel available by name in the worklet (kernel/kernels.ts). A processor
   * built with processorOptions.kernel set to that name renders with it in place of KernelEngine.
   * The factory is called as (sampleRate, kernelOptions, env).
   */
  registerKernel?(name: string, factory: unknown): void;
}

/** The global name of the hook. */
export const KERNEL_HOOK = 'bellowsKernel';

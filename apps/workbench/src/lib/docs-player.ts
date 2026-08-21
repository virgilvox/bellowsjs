/*
 * Which listen block on a docs page is allowed to make a sound.
 *
 * A tutorial page holds several players and the app holds ONE Bellows, so
 * two of them running at once is two patches through one output and a
 * reader who cannot tell which is which. This is the whole arbitration:
 * starting one stops whoever was going.
 *
 * It is a module-level singleton on purpose. The alternative, passing a
 * controller down from DocsView, would make every page that embeds a
 * player know about the mechanism, and the mechanism is not the page's
 * business.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not touch the Bellows instance. SimulatorView's stop() calls
 * disposeBellows(), which is right there, where the page owns the whole
 * screen and a fresh seed per firmware is the point. It is wrong here: a
 * docs player that disposed the shared instance would tear down the audio
 * graph under any other player on the page, and under the simulator if a
 * reader had left it running in another tab of the app.
 */

type StopFn = () => void;

let current: StopFn | null = null;

/**
 * Take the floor. Stops whoever holds it first, unless that is already you.
 * Pass the same function you will pass to `release`.
 */
export function claim(stop: StopFn): void {
  if (current && current !== stop) current();
  current = stop;
}

/** Give the floor up. A no-op if somebody else already took it. */
export function release(stop: StopFn): void {
  if (current === stop) current = null;
}

/** Stop whatever is playing. For leaving the docs entirely. */
export function stopAll(): void {
  const stop = current;
  current = null;
  stop?.();
}

/**
 * The seed a fast-check property runs with (PACKCAB-SEED). CI runs CI_PROPERTY_SEED, so a red build is the code's,
 * not the draw's; a local run draws a fresh seed each time, so the properties keep exploring. On failure fast-check
 * prints `{ seed, path }`; FC_SEED=<seed> replays that run, in CI or not.
 */
export const CI_PROPERTY_SEED = 20261120;

type Env = Readonly<Record<string, string | undefined>>;

// (import.meta.env: in a Vitest worker a proxy over process.env, typed for the app's tsconfig, which has no Node types)
export function propertySeed(env: Env = import.meta.env, random: () => number = Math.random): number {
  const pinned = env.FC_SEED;
  if (pinned) {
    const seed = Number(pinned);
    if (!Number.isInteger(seed) || seed < -(2 ** 31) || seed >= 2 ** 31) throw new RangeError(`FC_SEED must be a 32-bit integer, got ${pinned}`);
    return seed;
  }
  if (env.CI && env.CI !== 'false') return CI_PROPERTY_SEED;
  return (random() * 2 ** 32) | 0;
}

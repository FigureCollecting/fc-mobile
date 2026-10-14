/**
 * Whether this browser draws WebGL2 (three.js needs it): asked once, on a
 * throwaway canvas whose context is given back at once. No three import, so
 * the classic view never loads the renderer to ask.
 */
let probed: boolean | null = null;

export function hasWebGL2(): boolean {
  if (probed !== null) return probed;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    probed = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    probed = false;
  }
  return probed;
}

/** Tests: ask again. */
export function resetWebGL2Probe(): void {
  probed = null;
}

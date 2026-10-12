// ADDR-1: an image that fails to load (an address whose origin does not serve it yet, a figure whose
// bytes are gone while offline) is drawn as the figure's plate, never as a blank tile. Remembered per
// address for as long as the component lives.
import { useCallback, useState } from 'preact/hooks';

export interface BrokenImages {
  /** Whether this address failed to load here. */
  broken(src: string | undefined): boolean;
  /** An <img>'s onError for this address. */
  failed(src: string): void;
}

export function useBrokenImages(): BrokenImages {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const failed = useCallback((src: string) => setSeen((s) => (s.has(src) ? s : new Set([...s, src]))), []);
  const broken = useCallback((src: string | undefined) => src !== undefined && seen.has(src), [seen]);
  return { broken, failed };
}

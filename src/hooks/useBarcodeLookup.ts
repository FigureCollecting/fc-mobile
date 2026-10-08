// Barcode lookup (WK-15): a JAN/EAN/UPC through the coordinator's Compare (the spine resolves the
// GTIN to its head), then that head's ProductCard. Online only; nothing is written until the user
// adds the figure.
import { useMutation } from '@tanstack/react-query';
import type { ProductCard } from '@figurecollecting/fc-api-contract';
import { requireSession } from '../local/session';

const LOOKUP_TIMEOUT_MS = 15_000;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export class BarcodeFormatError extends Error {
  constructor() {
    super('Enter the 8, 12, 13 or 14 digits under the barcode.');
    this.name = 'BarcodeFormatError';
  }
}

/** A GTIN-8, UPC-A (12), JAN/EAN-13 or GTIN-14, zero-padded to 14 digits; null for anything else. */
export function toGtin14(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return null;
  return digits.padStart(14, '0');
}

export interface BarcodeResult {
  gtin14: string;
  /** The figures the barcode names (usually one). */
  cards: ProductCard[];
}

function headsOf(resultJson: string): string[] {
  const parsed = JSON.parse(resultJson) as { heads?: Array<{ head?: unknown }> };
  return [...new Set((parsed.heads ?? []).map((h) => h.head).filter((h): h is string => typeof h === 'string' && h !== ''))];
}

export function useBarcodeLookup() {
  return useMutation({
    mutationFn: async (code: string): Promise<BarcodeResult> => {
      const gtin14 = toGtin14(code);
      if (gtin14 === null) throw new BarcodeFormatError();
      const { clients } = requireSession();
      const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
      const compared = await clients.compare.compare({ seed: { case: 'gtin14', value: gtin14 }, nowIso: new Date().toISOString() }, { signal });
      const heads = headsOf(compared.resultJson);
      if (heads.length === 0) return { gtin14, cards: [] };
      const page = await clients.catalog.getProducts({ refs: heads.map((value) => ({ ref: { case: 'headId' as const, value } })) }, { signal });
      return { gtin14, cards: page.products };
    },
  });
}

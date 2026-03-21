/**
 * File reading and parsing utilities for CSV/JSON import.
 */

/** Read a File object as UTF-8 text. */
export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Simple but robust CSV parser.
 * Handles quoted fields containing commas, newlines, and escaped quotes ("").
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const results: Array<Record<string, string>> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // Skip completely empty rows
    if (row.length === 1 && row[0] === '') continue;

    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = j < row.length ? row[j] : '';
    }
    results.push(record);
  }

  return results;
}

/** Parse CSV text into a 2D array of strings, handling quoted fields. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") or end of quoted field
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n and bare \r
        current.push(field.trim());
        field = '';
        rows.push(current);
        current = [];
        i++;
        if (i < text.length && text[i] === '\n') i++;
      } else if (ch === '\n') {
        current.push(field.trim());
        field = '';
        rows.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Push last field/row
  if (field || current.length > 0) {
    current.push(field.trim());
    rows.push(current);
  }

  return rows;
}

/**
 * Parse JSON text as an array of items.
 * Handles: bare arrays, { figures: [...] }, { items: [...] }, or a single object.
 */
export function parseJson(text: string): unknown[] {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.figures)) return obj.figures;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.collection)) return obj.collection;
    if (Array.isArray(obj.data)) return obj.data;
    return [data];
  }
  return [data];
}

/** Detect file format from filename extension. */
export function detectFormat(filename: string): 'csv' | 'json' | 'unknown' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return 'unknown';
}

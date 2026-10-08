// The on-device search index (WK-15), in the manner of pg_bigm: Latin and digit runs cut into
// trigrams, CJK runs (Han, kana, Hangul) into bigrams. A query's grams narrow the candidates to
// the documents holding all of them; a candidate is a hit only when one of its fields holds the
// normalised query as a substring, which is what LIKE '%query%' answers. A query too short for a
// gram scans every document. Text is normalised the same way on both sides: NFKC (full- and
// half-width forms), lower case, katakana folded to hiragana, white space collapsed.

export interface SearchDoc {
  id: string;
  /** In priority order: a hit in an earlier field ranks first. */
  fields: string[];
}

export interface IndexJSON {
  docs: Array<{ id: string; fields: string[] }>;
  postings: Array<[string, number[]]>;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー々〆]/u;
const KATAKANA_FIRST = 0x30a1;
const KATAKANA_LAST = 0x30f6;
const KANA_SHIFT = 0x60;

export function normalize(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC').toLowerCase()) {
    const code = ch.codePointAt(0)!;
    out += code >= KATAKANA_FIRST && code <= KATAKANA_LAST ? String.fromCodePoint(code - KANA_SHIFT) : ch;
  }
  return out.replace(/\s+/gu, ' ').trim();
}

function addGrams(out: Set<string>, run: string[], n: number): void {
  for (let i = 0; i + n <= run.length; i++) out.add(run.slice(i, i + n).join(''));
}

/** The grams of normalised text: trigrams of each non-CJK run, bigrams of each CJK run. */
export function grams(text: string): Set<string> {
  const out = new Set<string>();
  let run: string[] = [];
  let cjk = false;
  for (const ch of text) {
    const isCjk = CJK.test(ch);
    if (run.length > 0 && isCjk !== cjk) {
      addGrams(out, run, cjk ? 2 : 3);
      run = [];
    }
    cjk = isCjk;
    run.push(ch);
  }
  addGrams(out, run, cjk ? 2 : 3);
  return out;
}

export class NgramIndex {
  private readonly docs: Array<{ id: string; fields: string[] }>;
  private readonly postings: Map<string, number[]>;

  private constructor(docs: Array<{ id: string; fields: string[] }>, postings: Map<string, number[]>) {
    this.docs = docs;
    this.postings = postings;
  }

  static build(input: readonly SearchDoc[]): NgramIndex {
    const docs = input.map((d) => ({ id: d.id, fields: d.fields.map(normalize) }));
    const postings = new Map<string, number[]>();
    docs.forEach((doc, i) => {
      const seen = new Set<string>();
      for (const field of doc.fields) for (const g of grams(field)) seen.add(g);
      for (const g of seen) {
        const list = postings.get(g);
        if (list === undefined) postings.set(g, [i]);
        else list.push(i);
      }
    });
    return new NgramIndex(docs, postings);
  }

  static fromJSON(json: IndexJSON): NgramIndex {
    return new NgramIndex(json.docs, new Map(json.postings));
  }

  toJSON(): IndexJSON {
    return { docs: this.docs, postings: [...this.postings] };
  }

  get size(): number {
    return this.docs.length;
  }

  /** Ids of the documents holding the query, a hit in an earlier field first, then in build order. */
  search(query: string): string[] {
    const q = normalize(query);
    if (q === '') return [];
    const hits: Array<{ i: number; field: number }> = [];
    for (const i of this.candidates(grams(q))) {
      const field = this.docs[i]!.fields.findIndex((f) => f.includes(q));
      if (field >= 0) hits.push({ i, field });
    }
    return hits.sort((a, b) => a.field - b.field || a.i - b.i).map((h) => this.docs[h.i]!.id);
  }

  private candidates(qGrams: Set<string>): Iterable<number> {
    if (qGrams.size === 0) return this.docs.keys();
    const lists: number[][] = [];
    for (const g of qGrams) {
      const list = this.postings.get(g);
      if (list === undefined) return [];
      lists.push(list);
    }
    lists.sort((a, b) => a.length - b.length);
    const [first, ...rest] = lists;
    const others = rest.map((l) => new Set(l));
    return first!.filter((i) => others.every((s) => s.has(i)));
  }
}

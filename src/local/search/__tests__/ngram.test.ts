// On-device search (WK-15): an n-gram index like pg_bigm's, trigrams for Latin text and bigrams for
// CJK, over title, manufacturer, character, series and JAN. A hit is a document that holds the
// normalised query as a substring of one of its fields; the grams only narrow the candidates.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { NgramIndex, grams, normalize, type SearchDoc } from '../ngram';

const DOCS: SearchDoc[] = [
  { id: 'miku', fields: ['Hatsune Miku: Deep Sea Girl Ver.', 'Good Smile Company', '初音ミク', 'Vocaloid', '4580416940986'] },
  { id: 'rem', fields: ['Rem: Crystal Dress Ver.', 'FuRyu', 'レム', 'Re:ゼロから始める異世界生活', '4582655070151'] },
  { id: 'madoka', fields: ['鹿目まどか 浴衣Ver.', 'アニプレックス', '鹿目まどか', '魔法少女まどか☆マギカ', '4534530123456'] },
  { id: 'spike', fields: ['Spike Spiegel', 'Bandai Spirits', 'Spike Spiegel', 'Cowboy Bebop', ''] },
];

describe('normalize', () => {
  it('folds width (NFKC), case and katakana to hiragana, and collapses white space', () => {
    expect(normalize('  ＭＩＫＵ  ﾐｸ\tミク ')).toBe('miku みく みく');
  });
});

describe('grams', () => {
  it('cuts Latin and digit runs into trigrams and CJK runs into bigrams', () => {
    expect([...grams('miku')]).toEqual(['mik', 'iku']);
    expect([...grams('初音みく')]).toEqual(['初音', '音み', 'みく']);
    expect([...grams('ab初音')]).toEqual(['初音']);
  });

  it('gives a run shorter than its gram nothing', () => {
    expect([...grams('mi')]).toEqual([]);
    expect([...grams('初')]).toEqual([]);
  });
});

describe('NgramIndex', () => {
  const index = NgramIndex.build(DOCS);

  it('finds a Latin query inside a title, any case, across a space', () => {
    expect(index.search('deep sea')).toEqual(['miku']);
    expect(index.search('SPIEGEL')).toEqual(['spike']);
    expect(index.search('ne mi')).toEqual(['miku']);
  });

  it('finds by manufacturer, character, series and JAN', () => {
    expect(index.search('furyu')).toEqual(['rem']);
    expect(index.search('レム')).toEqual(['rem']);
    expect(index.search('bebop')).toEqual(['spike']);
    expect(index.search('4580416940986')).toEqual(['miku']);
    expect(index.search('0123456')).toEqual(['madoka']);
  });

  it('finds a kana query in either kana, and a kanji query', () => {
    expect(index.search('みく')).toEqual(['miku']);
    expect(index.search('まどか')).toEqual(['madoka']);
    expect(index.search('鹿目')).toEqual(['madoka']);
    expect(index.search('ﾚﾑ')).toEqual(['rem']);
  });

  it('orders a title hit before a hit in another field', () => {
    const both = NgramIndex.build([
      { id: 'b', fields: ['Other figure', 'Spike Works'] },
      { id: 'a', fields: ['Spike Spiegel'] },
    ]);
    expect(both.search('spike')).toEqual(['a', 'b']);
  });

  it('scans for a query too short for a gram, and finds nothing for a blank one', () => {
    expect(index.search('mi')).toEqual(['miku']);
    expect(index.search('鹿')).toEqual(['madoka']);
    // れ: the maker アニプレックス (field 1) ranks before the character レム (field 2).
    expect(index.search('レ')).toEqual(['madoka', 'rem']);
    expect(index.search('   ')).toEqual([]);
  });

  it('finds no document whose grams all match but whose text does not hold the query', () => {
    const tricky = NgramIndex.build([{ id: 'x', fields: ['abcd bcde'] }]);
    expect(tricky.search('abcde')).toEqual([]);
    expect(tricky.search('bcde')).toEqual(['x']);
  });

  it('round-trips through its plain form (the worker hand-off)', () => {
    const copy = NgramIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())));
    expect(copy.search('deep sea')).toEqual(['miku']);
    expect(copy.size).toBe(DOCS.length);
  });

  it('agrees with a plain substring scan on any text and query (property)', () => {
    const text = fc.string({ unit: fc.constantFrom('a', 'b', 'c', ' ', 'ミ', 'み', 'ク', '初', '音', '1', '2'), maxLength: 12 });
    fc.assert(
      fc.property(fc.array(fc.array(text, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 6 }), text, (fieldsList, query) => {
        const docs = fieldsList.map((fields, i) => ({ id: `d${i}`, fields }));
        const q = normalize(query);
        const expected = q === '' ? [] : docs.filter((d) => d.fields.some((f) => normalize(f).includes(q))).map((d) => d.id);
        expect(NgramIndex.build(docs).search(query).sort()).toEqual(expected.sort());
      }),
      { numRuns: 300 },
    );
  });
});

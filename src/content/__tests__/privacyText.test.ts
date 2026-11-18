import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTACT_ADDRESS, PRIVACY, parsePrivacy, splitContact } from '../privacyText';

const FILE = readFileSync(path.resolve(__dirname, '../privacy.md'), 'utf8');

describe('parsePrivacy', () => {
  it('reads a title, the blocks before the first heading, and each section with its paragraphs and lists', () => {
    const doc = parsePrivacy('# Title\n\nFirst.\n\n## One\n\nA paragraph.\n\n- a\n- b\n\nAfter the list.\n\n## Two\n\n- only\n');
    expect(doc).toEqual({
      title: 'Title',
      intro: [{ kind: 'p', text: 'First.' }],
      sections: [
        {
          heading: 'One',
          blocks: [
            { kind: 'p', text: 'A paragraph.' },
            { kind: 'ul', items: ['a', 'b'] },
            { kind: 'p', text: 'After the list.' },
          ],
        },
        { heading: 'Two', blocks: [{ kind: 'ul', items: ['only'] }] },
      ],
    });
  });

  it('starts a new list after a paragraph or a blank line, and takes Windows line ends', () => {
    const doc = parsePrivacy('# T\r\n\r\n## S\r\n\r\n- a\r\n\r\n- b\r\ntext\r\n- c\r\n');
    expect(doc.sections[0]!.blocks).toEqual([
      { kind: 'ul', items: ['a'] },
      { kind: 'ul', items: ['b'] },
      { kind: 'p', text: 'text' },
      { kind: 'ul', items: ['c'] },
    ]);
  });

  it('refuses a text with no title on its first line', () => {
    expect(() => parsePrivacy('Privacy\n\n## One\n')).toThrow(/first line/);
    expect(() => parsePrivacy('')).toThrow(/first line/);
  });

  it('refuses markup it would show as typed: a second title, a deeper heading, an empty heading or list item', () => {
    expect(() => parsePrivacy('# T\n\n# Again\n')).toThrow(/line 3/);
    expect(() => parsePrivacy('# T\n\n### Deep\n')).toThrow(/line 3/);
    expect(() => parsePrivacy('# T\n\n## \n')).toThrow(/line 3/);
    expect(() => parsePrivacy('# T\n\n- \n')).toThrow(/line 3/);
    expect(() => parsePrivacy('# \n')).toThrow(/first line/);
  });
});

describe('splitContact', () => {
  it('cuts a text at each contact address and keeps everything else as it is', () => {
    expect(splitContact(`Write to ${CONTACT_ADDRESS}.`)).toEqual(['Write to ', { address: CONTACT_ADDRESS }, '.']);
    expect(splitContact(`${CONTACT_ADDRESS} or ${CONTACT_ADDRESS}`)).toEqual([
      { address: CONTACT_ADDRESS },
      ' or ',
      { address: CONTACT_ADDRESS },
    ]);
    expect(splitContact('No address here.')).toEqual(['No address here.']);
  });
});

describe('the privacy text (src/content/privacy.md)', () => {
  it('is what the page shows: the parsed file', () => {
    expect(PRIVACY).toEqual(parsePrivacy(FILE));
    expect(PRIVACY.title).toBe('Privacy');
  });

  it('covers every subject the page owes its reader, in order', () => {
    expect(PRIVACY.sections.map((s) => s.heading)).toEqual([
      'Who runs this',
      'The short version',
      'Your account',
      'What stays on your device',
      'Your collection',
      'Pictures',
      'Server logs',
      'Where it is kept',
      'What we never do',
      'Getting an account',
      'A copy of your data, or deleting it',
      'Contact',
    ]);
    for (const section of PRIVACY.sections) expect(section.blocks.length, section.heading).toBeGreaterThan(0);
  });

  it('carries the date of this version before the first section', () => {
    expect(PRIVACY.intro).toEqual([{ kind: 'p', text: expect.stringMatching(/^Version of \d{1,2} [A-Z][a-z]+ 20\d\d\.$/) }]);
  });

  it('names the contact address where it tells the reader to write, and no other address', () => {
    const withAddress = PRIVACY.sections.filter((s) => JSON.stringify(s.blocks).includes(CONTACT_ADDRESS)).map((s) => s.heading);
    expect(withAddress).toEqual(['A copy of your data, or deleting it', 'Contact']);
    expect(FILE.match(/[\w.+-]+@[\w.-]+\.\w+/g)).toEqual([CONTACT_ADDRESS, CONTACT_ADDRESS]);
  });

  it('has no note that one language is the official one, and no markup left for the reader to see', () => {
    expect(FILE).not.toMatch(/official (version|language|wording)|English (version|wording|text)/i);
    const shown = [PRIVACY.title, ...PRIVACY.intro, ...PRIVACY.sections.flatMap((s) => [s.heading, ...s.blocks])]
      .flatMap((b) => (typeof b === 'string' ? [b] : b.kind === 'p' ? [b.text] : b.items));
    for (const text of shown) expect(text).not.toMatch(/[*_`#\[\]<>]|^\s|\s$|^- /);
  });
});

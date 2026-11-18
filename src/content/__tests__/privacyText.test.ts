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

  // Challenge round 1: sentences that were false or said less than is recorded. Each is pinned by what it must
  // and must not say; the proof that each is true is FACTS.md, not this test.
  const section = (heading: string) => JSON.stringify(PRIVACY.sections.find((s) => s.heading === heading)!.blocks);

  it('says a signed-in search is sent to the server, and does not list searches among what is never sent', () => {
    const device = section('What stays on your device');
    expect(device).toMatch(/signed in, what you type in Search is also sent to our server to search the catalogue/);
    expect(device).toMatch(/barcode/);
    const neverSent = FILE.split('\n').filter((line) => /never sent/.test(line));
    expect(neverSent).toHaveLength(1);
    expect(neverSent[0]).not.toMatch(/search/i);
  });

  it('tells the reader how to clear the device, and does not promise that removing the app clears it', () => {
    const device = section('What stays on your device');
    expect(device).toMatch(/clear this site's data in your browser's site settings/);
    expect(FILE).not.toMatch(/or removing the app, deletes/);
    expect(device).toMatch(/Removing the app or its icon may leave/);
  });

  it('the short version agrees with the body: no other account can read a collection, the person running the servers can', () => {
    const short = section('The short version');
    expect(FILE).not.toMatch(/Only your account can read/);
    expect(short).toMatch(/No other account can read your collection/);
    expect(short).toMatch(/person who runs the servers/);
    expect(section('Your collection')).toMatch(/whoever runs it can technically read it/);
  });

  it('lists what the web server logs and what the sign-in server records', () => {
    const logs = section('Server logs');
    for (const field of [/the time/, /the address asked for/, /the result/, /referrer/, /user agent/, /IP address/]) expect(logs).toMatch(field);
    const account = section('Your account');
    for (const field of [/sign-in name/, /email address/, /IP address/, /city/, /browser and device/]) expect(account).toMatch(field);
  });

  it('gives no backup period it cannot keep: none of the old three-month claims, and the collection copies have no limit yet', () => {
    expect(FILE).not.toMatch(/kept for three months|after three months/);
    const kept = section('Where it is kept');
    expect(kept).toMatch(/sign-in database/);
    expect(kept).toMatch(/30 days/);
    expect(kept).toMatch(/collection database/);
    expect(kept).toMatch(/until we delete them by hand/);
    expect(kept).toMatch(/We are setting a limit/);
  });

  // Challenge round 2: the sign-in copies made before the 5 November 2026 move to the new store have no expiry rule.
  it('says only the sign-in backups made since the move expire, and that the older sign-in copies stay until deleted by hand', () => {
    const kept = section('Where it is kept');
    expect(kept).not.toMatch(/Backups of the sign-in database reach back/);
    expect(kept).toMatch(/sign-in database made since 5 November 2026 reach back three months, and a backup older than that is removed 30 days later/);
    expect(kept).toMatch(/sign-in database from before 5 November 2026 are kept until we delete them by hand/);
  });

  it('does not mention the Sync switches or the Delete Account button', () => {
    expect(FILE).not.toMatch(/Delete Account|Sync (switch|Owned|Ordered|Wished)/i);
    expect(section('A copy of your data, or deleting it')).toMatch(/privacy@figurecollecting\.com/);
  });

  it('describes getting an account as the invitation flow runs: one-time link, the four fields, second step, email confirmation', () => {
    const account = section('Getting an account');
    for (const part of [/by invitation/, /works once/, /sign-in name, your name, your email address and a password/, /second sign-in step/, /follow the link in the email/]) {
      expect(account).toMatch(part);
    }
    expect(FILE).not.toMatch(/When invitations start/);
  });

  it('has no note that one language is the official one, and no markup left for the reader to see', () => {
    expect(FILE).not.toMatch(/official (version|language|wording)|English (version|wording|text)/i);
    const shown = [PRIVACY.title, ...PRIVACY.intro, ...PRIVACY.sections.flatMap((s) => [s.heading, ...s.blocks])]
      .flatMap((b) => (typeof b === 'string' ? [b] : b.kind === 'p' ? [b.text] : b.items));
    for (const text of shown) expect(text).not.toMatch(/[*_`#\[\]<>]|^\s|\s$|^- /);
  });
});

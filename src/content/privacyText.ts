// The privacy page's text (P1) is privacy.md beside this file, in the few marks read here: a `# ` title on the
// first line, `## ` section headings, `- ` list items, and one-line paragraphs. A second title, a deeper heading and an
// empty heading or item are refused at load. Other marks show as typed; the test refuses only *_`#[]<> and a leading "- ".
import source from './privacy.md?raw';

export type PrivacyBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

export interface PrivacySection {
  heading: string;
  blocks: PrivacyBlock[];
}

export interface PrivacyDoc {
  title: string;
  /** What stands between the title and the first heading: the date of this version. */
  intro: PrivacyBlock[];
  sections: PrivacySection[];
}

/** Where an objection or a request goes (Ross's PRIVACY-ADDR). The page makes each mention a mail link. */
export const CONTACT_ADDRESS = 'privacy@figurecollecting.com';

/** The words of every link to /privacy (the desk wording Settings already carries, src/auth/diagIds.ts). */
export const PRIVACY_LINK_LABEL = 'How we use your data';

export function parsePrivacy(markdown: string): PrivacyDoc {
  // A line is trimmed before it is read, so a heading or list item that matches below has words after its mark.
  const lines = markdown.split(/\r?\n/);
  const title = /^# (\S.*)$/.exec(lines[0]!)?.[1]?.trim();
  if (title === undefined) throw new Error('privacy text: the first line is the title, "# ..."');

  const doc: PrivacyDoc = { title, intro: [], sections: [] };
  let blocks = doc.intro;
  let list: string[] | undefined;
  lines.slice(1).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') {
      list = undefined;
    } else if (line.startsWith('## ')) {
      list = undefined;
      blocks = [];
      doc.sections.push({ heading: line.slice(3).trim(), blocks });
    } else if (line.startsWith('- ')) {
      if (list === undefined) {
        list = [];
        blocks.push({ kind: 'ul', items: list });
      }
      list.push(line.slice(2).trim());
    } else if (line.startsWith('#') || line === '-' || line === '##') {
      throw new Error(`privacy text: line ${i + 2} is not a heading, a list item or a paragraph: ${JSON.stringify(line)}`);
    } else {
      list = undefined;
      blocks.push({ kind: 'p', text: line });
    }
  });
  return doc;
}

/** `text` cut at each contact address: the pieces in order, an address as { address }. */
export function splitContact(text: string): Array<string | { address: string }> {
  return text
    .split(CONTACT_ADDRESS)
    .flatMap((piece, i) => (i === 0 ? [piece] : [{ address: CONTACT_ADDRESS }, piece]))
    .filter((piece) => piece !== '');
}

export const PRIVACY: PrivacyDoc = parsePrivacy(source);

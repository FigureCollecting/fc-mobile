import finalE from '../../assets/brand/final-E.svg?raw';

// Traced from the brand mark; the source fill is baked black, swap for
// currentColor so the mark follows the header's text color in both themes.
const MARK_SVG = finalE.replace(/fill="#000000"/g, 'fill="currentColor"');

/**
 * Small brand glyph carried in the slim header next to page context — the
 * one place the app identifies itself, since page titles were cut app-wide.
 * Sized to fit inside the 48px header without changing its height.
 */
export function HeaderMark() {
  return (
    <>
      <span class="brand-header-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARK_SVG }} />
      <style>{`
        .brand-header-mark {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          height: 22px;
          color: var(--text-secondary);
        }

        .brand-header-mark svg {
          display: block;
          height: 100%;
          width: auto;
        }
      `}</style>
    </>
  );
}

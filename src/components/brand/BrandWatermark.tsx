import finalC from '../../assets/brand/final-C.svg?raw';

// Traced from the brand mark; the source fill is baked black, swap for
// currentColor so this renders as a plain white mark on the always-dark
// display backgrounds. (Luminance-adaptive theming is a future export-path
// concern, not this in-app overlay.)
const MARK_SVG = finalC.replace(/fill="#000000"/g, 'fill="currentColor"');

/**
 * Faint "C" watermark for the virtual-case and justified-rows displays.
 * The caller sizes the wrapping slot (height = 21% of the display's own
 * rendered height, capped at 120px); this just fills that box at a fixed
 * white / 5% opacity, aspect preserved from the source viewBox.
 */
export function BrandWatermark() {
  return (
    <>
      <span class="brand-watermark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARK_SVG }} />
      <style>{`
        .brand-watermark {
          display: block;
          height: 100%;
          width: auto;
          color: #ffffff;
          opacity: 0.05;
          pointer-events: none;
        }

        .brand-watermark svg {
          display: block;
          height: 100%;
          width: auto;
        }
      `}</style>
    </>
  );
}

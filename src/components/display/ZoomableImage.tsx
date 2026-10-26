/**
 * CARD-VIEW-1 (Ross 10-25: "not every card view had zoom available"): a card's picture that zooms where PhotoSwipe is
 * not (the side pane, the figure page), the way the full-screen viewer's does: a pinch about the fingers, a double-tap
 * at the point tapped (again: back to whole), one finger panning the zoomed picture, a visible zoom control at the
 * picture's bottom-right (low and right, clear of the notification shade: feedback-no-frequent-controls-at-top) and the
 * viewer's `z` key; the control and the key start at the face (FACE_ANCHOR). Whole, a drag is the page's (it scrolls);
 * the maths is imageZoom.ts.
 */
import { useRef, useState } from 'preact/hooks';
import { Style } from '../../styles/Style';
import {
  IMAGE_ZOOM_STEP,
  UNZOOMED,
  faceZoom,
  imageZoomTransform,
  panImageZoom,
  pinchImageZoom,
  settleImageZoom,
  zoomAtPoint,
  type ImageZoom,
  type Point,
  type Size,
} from './imageZoom';

/** Two taps within this long and this close are a double-tap (the case's own, CabinetScene). */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
/** A finger that moves this far is a pan (or the page's scroll), not a tap. */
const PAN_START_PX = 6;

const isZoomed = (z: ImageZoom): boolean => z.k > 1;
const num = (v: number): number => Math.round(v * 1000) / 1000;

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** The frame's class: its box, which the picture is laid out whole in and zooms within. */
  frameClass?: string;
  /** The picture's class. */
  imgClass?: string;
  onError?: () => void;
}

export function ZoomableImage({ src, alt, frameClass = '', imgClass = '', onError }: ZoomableImageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // a new picture starts whole: the zoom belongs to the picture it was made on
  const [shown, setShown] = useState<{ src: string; zoom: ImageZoom }>({ src, zoom: UNZOOMED });
  const zoom = shown.src === src ? shown.zoom : UNZOOMED;
  const latest = useRef(zoom);
  latest.current = zoom;
  const setZoom = (z: ImageZoom) => {
    latest.current = z;
    setShown({ src, zoom: z });
  };
  // while fingers move it, the picture follows them at once (no glide)
  const [live, setLive] = useState(false);

  /** The frame as laid out, and the picture's own size (0 x 0 until it has loaded: then it fills the frame). */
  const measure = (): { rect: DOMRect; frame: Size; natural: Size } => {
    const rect = frameRef.current!.getBoundingClientRect();
    const img = imgRef.current;
    return { rect, frame: { width: rect.width, height: rect.height }, natural: { width: img?.naturalWidth ?? 0, height: img?.naturalHeight ?? 0 } };
  };
  const local = (clientX: number, clientY: number): Point => {
    const { rect } = measure();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** The zoom control and the `z` key: one step in, centred on the face (faceZoom, CARD-VIEW-1 part 2), or back to whole. */
  const toggle = () => {
    const { frame, natural } = measure();
    setZoom(isZoomed(latest.current) ? UNZOOMED : faceZoom(frame, natural, IMAGE_ZOOM_STEP));
  };

  // the fingers down on the picture (client px); the pinch of the first two; one finger's press; the last tap
  const fingers = useRef(new Map<number, Point>());
  const pinch = useRef<{ a: number; b: number; a0: Point; b0: Point; from: ImageZoom } | null>(null);
  const press = useRef<{ id: number; x0: number; y0: number; from: ImageZoom; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: PointerEvent) => {
    // the zoom control is its own: a press on it is no tap or pan of the picture
    if ((e.target as Element).closest('button')) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) return;
    const p = press.current;
    const first = p && p.id !== e.pointerId ? fingers.current.get(p.id) : undefined;
    if (p && first) {
      // a second finger: a pinch, from where the picture stands now
      press.current = null;
      lastTap.current = null;
      pinch.current = { a: p.id, b: e.pointerId, a0: local(first.x, first.y), b0: local(e.clientX, e.clientY), from: latest.current };
      setLive(true);
      return;
    }
    press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: latest.current, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pin = pinch.current;
    if (pin) {
      if (e.pointerId !== pin.a && e.pointerId !== pin.b) return;
      const a = fingers.current.get(pin.a)!;
      const b = fingers.current.get(pin.b)!;
      const { frame, natural } = measure();
      setZoom(pinchImageZoom(pin.from, pin.a0, pin.b0, local(a.x, a.y), local(b.x, b.y), frame, natural));
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (!p.moved && Math.hypot(dx, dy) >= PAN_START_PX) {
      p.moved = true;
      lastTap.current = null;
      if (isZoomed(p.from)) setLive(true);
    }
    if (p.moved && isZoomed(p.from)) {
      const { frame, natural } = measure();
      setZoom(panImageZoom(p.from, dx, dy, frame, natural));
    }
  };

  const endPress = (e: PointerEvent, commit: boolean) => {
    fingers.current.delete(e.pointerId);
    const pin = pinch.current;
    if (pin) {
      if (e.pointerId !== pin.a && e.pointerId !== pin.b) return;
      // let go: near 1x, 1x; the finger left down pans from there, never a tap
      pinch.current = null;
      setLive(false);
      const { frame, natural } = measure();
      const settled = settleImageZoom(latest.current, frame, natural);
      setZoom(settled);
      const other = e.pointerId === pin.a ? pin.b : pin.a;
      const at = fingers.current.get(other);
      press.current = at ? { id: other, x0: at.x, y0: at.y, from: settled, moved: true } : null;
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    setLive(false);
    if (p.moved || !commit) return;
    // a tap: the second of two quick ones close together is a double-tap, in at the point (or back out to whole)
    const t = Date.now();
    const last = lastTap.current;
    lastTap.current = null;
    if (last && t - last.t <= DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= DOUBLE_TAP_PX) {
      const { frame, natural } = measure();
      setZoom(isZoomed(latest.current) ? UNZOOMED : zoomAtPoint(UNZOOMED, local(e.clientX, e.clientY), IMAGE_ZOOM_STEP, frame, natural));
      return;
    }
    lastTap.current = { t, x: e.clientX, y: e.clientY };
  };

  const capture = (e: PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    try {
      frameRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer cannot be captured */
    }
  };

  const zoomed = isZoomed(zoom);
  return (
    <div
      ref={frameRef}
      class={`zoomable ${frameClass} ${live ? 'zoomable--live' : ''}`}
      role="group"
      aria-label={`${alt}: pinch, double-tap or press z to zoom`}
      tabIndex={0}
      data-zoom={JSON.stringify({ k: num(zoom.k), x: num(zoom.x), y: num(zoom.y) })}
      data-zoomed={zoomed ? '1' : '0'}
      onPointerDown={(e) => {
        capture(e);
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, true)}
      onPointerCancel={(e) => endPress(e, false)}
      onKeyDown={(e) => {
        if (e.key !== 'z' && e.key !== 'Z') return;
        e.preventDefault();
        toggle();
      }}
    >
      <img
        ref={imgRef}
        class={`zoomable__img ${imgClass}`}
        src={src}
        alt={alt}
        crossOrigin="anonymous"
        draggable={false}
        style={{ transform: imageZoomTransform(zoom) }}
        onError={onError}
      />
      <button type="button" class="zoomable__button" aria-label={zoomed ? 'Zoom out' : 'Zoom in'} onClick={toggle}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5L21 21" />
          <path d="M7.5 10.5h6" />
          {!zoomed && <path d="M10.5 7.5v6" />}
        </svg>
      </button>
      <Style css={styles} />
    </div>
  );
}

const styles = `
  .zoomable {
    position: relative;
    display: flex;
    overflow: hidden;
    /* whole, a vertical drag is the page's scroll; zoomed, every finger is the picture's */
    touch-action: pan-y;
  }
  .zoomable[data-zoomed='1'] { touch-action: none; cursor: grab; }
  .zoomable__img {
    min-width: 0;
    min-height: 0;
    transform-origin: 0 0;
    transition: transform 200ms ease-out;
    user-select: none;
    -webkit-user-select: none;
  }
  .zoomable--live .zoomable__img { transition: none; }
  @media (prefers-reduced-motion: reduce) {
    .zoomable__img { transition: none; }
  }
  .zoomable__button {
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-2);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-primary) 70%, transparent);
    color: var(--text-primary);
  }
`;

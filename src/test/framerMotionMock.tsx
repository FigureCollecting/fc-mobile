// Shared stub for framer-motion — lets component tests render without dragging
// into pointer-event / animation-loop territory.
import type { ComponentChildren } from 'preact';

const SKIP_PROPS = new Set([
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragControls',
  'dragListener',
  'dragMomentum',
  'dragTransition',
  'dragDirectionLock',
  'dragPropagation',
  'dragSnapToOrigin',
  'onDrag',
  'onDragStart',
  'onDragEnd',
  'onDragTransitionEnd',
  'whileDrag',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileInView',
  'variants',
  'initial',
  'animate',
  'exit',
  'transition',
  'custom',
  'layout',
  'layoutId',
  'layoutDependency',
  'layoutRoot',
  'layoutScroll',
  'viewport',
  'style',
  'motionValues',
]);

function cleanProps(props: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (SKIP_PROPS.has(key) || key.startsWith('onPan')) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function makeTag(tag: string) {
  return (props: { children?: ComponentChildren } & Record<string, unknown>) => {
    const { children, ...rest } = props;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TagAny = tag as any;
    return <TagAny {...cleanProps(rest)}>{children}</TagAny>;
  };
}

export const motion = new Proxy(
  {},
  { get: (_, prop: string) => makeTag(prop) },
) as unknown as Record<string, (props: unknown) => unknown>;

export function AnimatePresence({ children }: { children?: ComponentChildren }) {
  return <>{children}</>;
}

export function useDragControls() {
  return { start: () => {}, componentControls: new Set() };
}

export function useAnimationControls() {
  return { start: async () => {}, stop: () => {}, set: () => {}, mount: () => () => {} };
}

export function useMotionValue<T>(initial: T) {
  let v = initial;
  return {
    get: () => v,
    set: (next: T) => { v = next; },
    onChange: () => () => {},
    destroy: () => {},
  };
}

export function useTransform<T, U>(_src: unknown, mapper: (v: T) => U): { get: () => U } {
  return { get: () => mapper(undefined as unknown as T) };
}

export function useScroll() {
  return {
    scrollX: useMotionValue(0),
    scrollY: useMotionValue(0),
    scrollXProgress: useMotionValue(0),
    scrollYProgress: useMotionValue(0),
  };
}

export function useSpring(value: unknown) {
  return value;
}

export function animate() {
  return { stop: () => {} };
}

export const domAnimation = {};
export const domMax = {};
export function LazyMotion({ children }: { children?: ComponentChildren }) {
  return <>{children}</>;
}

export const MotionConfig = ({ children }: { children?: ComponentChildren }) => <>{children}</>;
export const LayoutGroup = ({ children }: { children?: ComponentChildren }) => <>{children}</>;

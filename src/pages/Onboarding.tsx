import { useState, useCallback, useRef } from 'preact/hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { PageDots } from '../components/ui/PageDots';

interface OnboardingProps {
  onComplete: (action: 'register' | 'login' | 'guest') => void;
}

const SCREENS = [
  {
    title: 'Your Collection, Anywhere',
    description: 'Track your figures, statues, and collectibles in one place.',
    decorator: 'collection',
  },
  {
    title: 'Price Intelligence',
    description:
      'Monitor prices across 14+ sites worldwide. Get alerts when prices drop on your wishlist.',
    decorator: 'prices',
  },
  {
    title: 'Sync with MFC',
    description:
      'Import your MyFigureCollection data instantly. Keep everything in sync automatically.',
    decorator: 'sync',
  },
  {
    title: 'Get Started',
    description: 'Create your free account or sign in to get started.',
    decorator: 'start',
  },
] as const;

const SWIPE_THRESHOLD = 50;
const DRAG_ELASTIC = 0.2;

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0,
  }),
};

export function Onboarding({ onComplete }: OnboardingProps) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(0);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const isLast = page === SCREENS.length - 1;

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= SCREENS.length || index === page) return;
      setDirection(index > page ? 1 : -1);
      setPage(index);
    },
    [page],
  );

  const handleDragEnd = useCallback(
    (_event: PointerEvent, info: { offset: { x: number }; velocity: { x: number } }) => {
      const { offset, velocity } = info;
      if (offset.x < -SWIPE_THRESHOLD || velocity.x < -500) {
        if (page < SCREENS.length - 1) goTo(page + 1);
      } else if (offset.x > SWIPE_THRESHOLD || velocity.x > 500) {
        if (page > 0) goTo(page - 1);
      }
    },
    [page, goTo],
  );

  const handleSkip = useCallback(() => {
    onComplete('guest');
  }, [onComplete]);

  return (
    <div class="onboarding" ref={constraintsRef}>
      {/* Skip button */}
      {!isLast && (
        <button class="onboarding__skip" onClick={handleSkip} type="button">
          Skip
        </button>
      )}

      {/* Swipeable content area */}
      <div class="onboarding__viewport">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={page}
            class="onboarding__slide"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={DRAG_ELASTIC}
            onDragEnd={handleDragEnd}
          >
            {/* Decorative element */}
            <div class={`onboarding__decor onboarding__decor--${SCREENS[page].decorator}`}>
              <DecorativeElement type={SCREENS[page].decorator} />
            </div>

            {/* Text content */}
            <h1 class="onboarding__title">{SCREENS[page].title}</h1>
            <p class="onboarding__desc">{SCREENS[page].description}</p>

            {/* CTA buttons on last screen */}
            {isLast && (
              <div class="onboarding__actions">
                <button
                  class="onboarding__btn onboarding__btn--primary"
                  type="button"
                  onClick={() => onComplete('register')}
                >
                  Create Account
                </button>
                <button
                  class="onboarding__btn onboarding__btn--secondary"
                  type="button"
                  onClick={() => onComplete('login')}
                >
                  Sign In
                </button>
                <button
                  class="onboarding__btn onboarding__btn--ghost"
                  type="button"
                  onClick={() => onComplete('guest')}
                >
                  Browse as Guest
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dot indicators */}
      <div class="onboarding__footer">
        <PageDots total={SCREENS.length} active={page} onDotClick={goTo} />
      </div>

      <style>{styles}</style>
    </div>
  );
}

/* ── CSS-only decorative elements ── */

function DecorativeElement({ type }: { type: string }) {
  switch (type) {
    case 'collection':
      return (
        <div class="decor-collection">
          <div class="decor-collection__grid">
            <div class="decor-collection__cell decor-collection__cell--1" />
            <div class="decor-collection__cell decor-collection__cell--2" />
            <div class="decor-collection__cell decor-collection__cell--3" />
            <div class="decor-collection__cell decor-collection__cell--4" />
            <div class="decor-collection__cell decor-collection__cell--5" />
            <div class="decor-collection__cell decor-collection__cell--6" />
          </div>
        </div>
      );
    case 'prices':
      return (
        <div class="decor-prices">
          <div class="decor-prices__bar decor-prices__bar--1" />
          <div class="decor-prices__bar decor-prices__bar--2" />
          <div class="decor-prices__bar decor-prices__bar--3" />
          <div class="decor-prices__bar decor-prices__bar--4" />
          <div class="decor-prices__bar decor-prices__bar--5" />
          <div class="decor-prices__line" />
        </div>
      );
    case 'sync':
      return (
        <div class="decor-sync">
          <div class="decor-sync__ring decor-sync__ring--outer" />
          <div class="decor-sync__ring decor-sync__ring--inner" />
          <div class="decor-sync__arrows">
            <div class="decor-sync__arrow decor-sync__arrow--up" />
            <div class="decor-sync__arrow decor-sync__arrow--down" />
          </div>
        </div>
      );
    case 'start':
      return (
        <div class="decor-start">
          <div class="decor-start__circle" />
          <div class="decor-start__check" />
        </div>
      );
    default:
      return null;
  }
}

const styles = `
  .onboarding {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    background: var(--surface-primary);
    padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);
    overflow: hidden;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }

  .onboarding__skip {
    position: absolute;
    top: calc(var(--safe-area-top) + var(--space-4));
    right: calc(var(--safe-area-right) + var(--space-4));
    z-index: 10;
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-secondary);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--surface-secondary);
    -webkit-tap-highlight-color: transparent;
  }

  .onboarding__skip:active {
    background: var(--surface-tertiary);
  }

  .onboarding__viewport {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .onboarding__slide {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-6);
    gap: var(--space-4);
    touch-action: none;
  }

  .onboarding__decor {
    width: 180px;
    height: 180px;
    margin-bottom: var(--space-6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .onboarding__title {
    font-size: var(--font-2xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    text-align: center;
    line-height: var(--line-height-tight);
  }

  .onboarding__desc {
    font-size: var(--font-base);
    color: var(--text-secondary);
    text-align: center;
    line-height: var(--line-height-normal);
    max-width: 320px;
  }

  .onboarding__actions {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 320px;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .onboarding__btn {
    width: 100%;
    height: var(--touch-min);
    border-radius: var(--radius-md);
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-base);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
  }

  .onboarding__btn--primary {
    background: var(--brand-500);
    color: white;
  }

  .onboarding__btn--primary:active {
    background: var(--brand-600);
  }

  .onboarding__btn--secondary {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-primary);
  }

  .onboarding__btn--secondary:active {
    background: var(--surface-tertiary);
  }

  .onboarding__btn--ghost {
    height: auto;
    padding: var(--space-2) 0;
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-tertiary);
  }

  .onboarding__btn--ghost:active {
    color: var(--text-secondary);
  }

  .onboarding__footer {
    flex-shrink: 0;
    padding-bottom: var(--space-6);
  }

  /* ── Decorative: Collection Grid ── */

  .decor-collection__grid {
    display: grid;
    grid-template-columns: repeat(3, 48px);
    grid-template-rows: repeat(2, 56px);
    gap: 8px;
  }

  .decor-collection__cell {
    border-radius: var(--radius-md);
    animation: decor-shimmer 2.5s ease-in-out infinite;
  }

  .decor-collection__cell--1 {
    background: linear-gradient(135deg, var(--brand-500), var(--brand-400));
    animation-delay: 0s;
  }

  .decor-collection__cell--2 {
    background: linear-gradient(135deg, var(--accent-success), #34d399);
    animation-delay: 0.15s;
  }

  .decor-collection__cell--3 {
    background: linear-gradient(135deg, var(--accent-warning), #fbbf24);
    animation-delay: 0.3s;
  }

  .decor-collection__cell--4 {
    background: linear-gradient(135deg, var(--accent-info), #60a5fa);
    animation-delay: 0.45s;
  }

  .decor-collection__cell--5 {
    background: linear-gradient(135deg, #a78bfa, #c084fc);
    animation-delay: 0.6s;
  }

  .decor-collection__cell--6 {
    background: linear-gradient(135deg, var(--accent-danger), #f87171);
    animation-delay: 0.75s;
  }

  @keyframes decor-shimmer {
    0%, 100% { opacity: 0.7; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.04); }
  }

  /* ── Decorative: Price Chart ── */

  .decor-prices {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    height: 140px;
    position: relative;
    padding-bottom: 2px;
  }

  .decor-prices__bar {
    width: 24px;
    border-radius: 4px 4px 0 0;
    animation: decor-grow 2s ease-in-out infinite;
  }

  .decor-prices__bar--1 {
    height: 50%;
    background: var(--surface-tertiary);
    animation-delay: 0s;
  }

  .decor-prices__bar--2 {
    height: 70%;
    background: var(--surface-tertiary);
    animation-delay: 0.1s;
  }

  .decor-prices__bar--3 {
    height: 40%;
    background: var(--brand-500);
    animation-delay: 0.2s;
  }

  .decor-prices__bar--4 {
    height: 85%;
    background: var(--accent-success);
    animation-delay: 0.3s;
  }

  .decor-prices__bar--5 {
    height: 60%;
    background: var(--surface-tertiary);
    animation-delay: 0.4s;
  }

  .decor-prices__line {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--border-subtle);
  }

  @keyframes decor-grow {
    0%, 100% { transform: scaleY(1); }
    50% { transform: scaleY(1.1); }
  }

  /* ── Decorative: Sync Rings ── */

  .decor-sync {
    position: relative;
    width: 140px;
    height: 140px;
  }

  .decor-sync__ring {
    position: absolute;
    border-radius: 50%;
    border: 3px solid transparent;
  }

  .decor-sync__ring--outer {
    inset: 0;
    border-top-color: var(--brand-500);
    border-right-color: var(--brand-400);
    animation: decor-spin 3s linear infinite;
  }

  .decor-sync__ring--inner {
    inset: 20px;
    border-bottom-color: var(--accent-success);
    border-left-color: #34d399;
    animation: decor-spin-reverse 2.5s linear infinite;
  }

  .decor-sync__arrows {
    position: absolute;
    inset: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .decor-sync__arrow {
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
  }

  .decor-sync__arrow--up {
    border-bottom: 12px solid var(--brand-500);
    animation: decor-bounce-up 1.5s ease-in-out infinite;
  }

  .decor-sync__arrow--down {
    border-top: 12px solid var(--accent-success);
    animation: decor-bounce-down 1.5s ease-in-out infinite;
  }

  @keyframes decor-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes decor-spin-reverse {
    to { transform: rotate(-360deg); }
  }

  @keyframes decor-bounce-up {
    0%, 100% { transform: translateY(2px); }
    50% { transform: translateY(-4px); }
  }

  @keyframes decor-bounce-down {
    0%, 100% { transform: translateY(-2px); }
    50% { transform: translateY(4px); }
  }

  /* ── Decorative: Get Started ── */

  .decor-start {
    position: relative;
    width: 120px;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .decor-start__circle {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--brand-500), var(--brand-400));
    opacity: 0.15;
    animation: decor-pulse 2s ease-in-out infinite;
  }

  .decor-start__check {
    width: 40px;
    height: 24px;
    border-left: 4px solid var(--brand-500);
    border-bottom: 4px solid var(--brand-500);
    transform: rotate(-45deg);
    margin-bottom: 8px;
    animation: decor-check-pop 2s ease-in-out infinite;
  }

  @keyframes decor-pulse {
    0%, 100% { transform: scale(1); opacity: 0.15; }
    50% { transform: scale(1.1); opacity: 0.25; }
  }

  @keyframes decor-check-pop {
    0%, 100% { transform: rotate(-45deg) scale(1); }
    50% { transform: rotate(-45deg) scale(1.1); }
  }
`;

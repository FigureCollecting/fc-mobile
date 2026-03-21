import { useState, useRef, useCallback, useEffect } from 'preact/hooks';

interface LazyImageProps {
  src: string;
  alt: string;
  class?: string;
  width?: number;
  height?: number;
  /** Optional placeholder color or blur-hash data URL */
  placeholder?: string;
}

export function LazyImage({ src, alt, class: className, width, height, placeholder }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  return (
    <div
      ref={containerRef}
      class={`lazy-image ${className ?? ''}`}
      style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
    >
      {/* Pulsing skeleton placeholder */}
      {!loaded && !error && (
        <div
          class="lazy-image__skeleton"
          style={placeholder ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' } : undefined}
        />
      )}

      {/* Error fallback */}
      {error && (
        <div class="lazy-image__error">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </div>
      )}

      {/* Actual image */}
      {inView && !error && (
        <img
          class={`lazy-image__img ${loaded ? 'lazy-image__img--loaded' : ''}`}
          src={src}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          width={width}
          height={height}
        />
      )}

      <style>{lazyImageStyles}</style>
    </div>
  );
}

const lazyImageStyles = `
  .lazy-image {
    position: relative;
    overflow: hidden;
    background: var(--surface-tertiary);
  }

  .lazy-image__skeleton {
    position: absolute;
    inset: 0;
    background: var(--surface-tertiary);
    animation: lazy-image-pulse 1.5s ease-in-out infinite;
  }

  .lazy-image__error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-tertiary);
  }

  .lazy-image__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    filter: blur(8px);
    transform: scale(1.05);
    transition: opacity 0.4s ease, filter 0.4s ease, transform 0.4s ease;
    will-change: opacity, filter, transform;
  }

  .lazy-image__img--loaded {
    opacity: 1;
    filter: blur(0);
    transform: scale(1);
  }

  @keyframes lazy-image-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
`;

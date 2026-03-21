import { useState, useCallback } from 'preact/hooks';
import { Lightbox } from './Lightbox';

interface ImageGalleryProps {
  images: string[];
  alt: string;
}

export function ImageGallery({ images, alt }: ImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleThumbnailClick = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const handleHeroClick = useCallback(() => {
    if (images.length > 0) {
      setLightboxOpen(true);
    }
  }, [images.length]);

  const handleLightboxClose = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  if (images.length === 0) return null;

  return (
    <div class="image-gallery">
      {/* Hero / main image */}
      <button
        class="image-gallery__hero"
        onClick={handleHeroClick}
        type="button"
        aria-label="View image full screen"
      >
        <img
          class="image-gallery__hero-img"
          src={images[activeIndex]}
          alt={alt}
        />
        {/* Expand icon hint */}
        <div class="image-gallery__expand-hint">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </div>
      </button>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div class="image-gallery__thumbs">
          <div class="image-gallery__thumbs-scroll">
            {images.map((url, i) => (
              <button
                key={url}
                class={`image-gallery__thumb ${i === activeIndex ? 'image-gallery__thumb--active' : ''}`}
                onClick={() => handleThumbnailClick(i)}
                type="button"
                aria-label={`View image ${i + 1}`}
              >
                <img
                  class="image-gallery__thumb-img"
                  src={url}
                  alt=""
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      <Lightbox
        images={images}
        initialIndex={activeIndex}
        isOpen={lightboxOpen}
        onClose={handleLightboxClose}
      />

      <style>{galleryStyles}</style>
    </div>
  );
}

const galleryStyles = `
  .image-gallery {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .image-gallery__hero {
    position: relative;
    flex: 1;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .image-gallery__hero:active {
    opacity: 0.92;
  }

  .image-gallery__hero-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: var(--surface-tertiary);
  }

  .image-gallery__expand-hint {
    position: absolute;
    bottom: var(--space-3);
    right: var(--space-3);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    border-radius: var(--radius-sm);
    color: #ffffff;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    opacity: 0.7;
    transition: opacity var(--transition-fast);
  }

  .image-gallery__hero:active .image-gallery__expand-hint {
    opacity: 1;
  }

  /* Thumbnail strip */
  .image-gallery__thumbs {
    flex-shrink: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-tertiary);
  }

  .image-gallery__thumbs-scroll {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .image-gallery__thumbs-scroll::-webkit-scrollbar {
    display: none;
  }

  .image-gallery__thumb {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color var(--transition-fast);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    padding: 0;
  }

  .image-gallery__thumb--active {
    border-color: var(--brand-500);
  }

  .image-gallery__thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

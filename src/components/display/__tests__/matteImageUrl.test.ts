import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import {
  buildMatteServeUrl,
  resolveFigureImageUrl,
  resolveImageManagerBaseUrl,
} from '../matteImageUrl';

function fig(overrides: Partial<Figure> & { _id: string }): Figure {
  return {
    name: overrides._id,
    manufacturer: '',
    scale: '',
    userId: 'u1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as Figure;
}

describe('buildMatteServeUrl', () => {
  it('builds the image-manager /serve/{id}@{version} URL when both matte ids are present', () => {
    const url = buildMatteServeUrl(
      { matted: true, matteImageId: '42', matteVersionId: '7' },
      'https://images.example.com',
    );
    expect(url).toBe('https://images.example.com/serve/42@7');
  });

  it('strips a trailing slash from the base URL before joining', () => {
    const url = buildMatteServeUrl(
      { matted: true, matteImageId: '42', matteVersionId: '7' },
      'https://images.example.com/',
    );
    expect(url).toBe('https://images.example.com/serve/42@7');
  });

  it('returns undefined when displayMeta is undefined', () => {
    expect(buildMatteServeUrl(undefined, 'https://images.example.com')).toBeUndefined();
  });

  it('returns undefined when matteImageId is missing', () => {
    const url = buildMatteServeUrl({ matted: true, matteVersionId: '7' }, 'https://images.example.com');
    expect(url).toBeUndefined();
  });

  it('returns undefined when matteVersionId is missing', () => {
    const url = buildMatteServeUrl({ matted: true, matteImageId: '42' }, 'https://images.example.com');
    expect(url).toBeUndefined();
  });
});

describe('resolveFigureImageUrl', () => {
  it('resolves the matted serve URL when the figure has matte ids', () => {
    const f = fig({
      _id: 'f1',
      imageUrl: 'https://legacy.example.com/f1.jpg',
      displayMeta: { matted: true, matteImageId: '42', matteVersionId: '7' },
    });
    expect(resolveFigureImageUrl(f, 'https://images.example.com')).toBe('https://images.example.com/serve/42@7');
  });

  it('falls back to figure.imageUrl when displayMeta is absent', () => {
    const f = fig({ _id: 'f1', imageUrl: 'https://legacy.example.com/f1.jpg' });
    expect(resolveFigureImageUrl(f, 'https://images.example.com')).toBe('https://legacy.example.com/f1.jpg');
  });

  it('falls back to figure.imageUrl when displayMeta has no matte ids', () => {
    const f = fig({
      _id: 'f1',
      imageUrl: 'https://legacy.example.com/f1.jpg',
      displayMeta: { matted: false },
    });
    expect(resolveFigureImageUrl(f, 'https://images.example.com')).toBe('https://legacy.example.com/f1.jpg');
  });

  it('returns undefined when neither a matte nor a plain imageUrl exists', () => {
    const f = fig({ _id: 'f1' });
    expect(resolveFigureImageUrl(f, 'https://images.example.com')).toBeUndefined();
  });

  it('defaults the base URL to resolveImageManagerBaseUrl() when not passed explicitly', () => {
    const f = fig({
      _id: 'f1',
      displayMeta: { matted: true, matteImageId: '1', matteVersionId: '2' },
    });
    expect(resolveFigureImageUrl(f)).toBe(`${resolveImageManagerBaseUrl()}/serve/1@2`);
  });
});

describe('resolveImageManagerBaseUrl', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('uses the localStorage runtime override when present', () => {
    localStorage.setItem('fc.imageManagerUrl', 'https://override.example.com');
    expect(resolveImageManagerBaseUrl()).toBe('https://override.example.com');
  });

  it('falls back to import.meta.env.VITE_IMAGE_MANAGER_URL when no override is set', () => {
    vi.stubEnv('VITE_IMAGE_MANAGER_URL', 'https://env.example.com');
    expect(resolveImageManagerBaseUrl()).toBe('https://env.example.com');
  });

  it('falls back to the production default when neither override nor env is set', () => {
    vi.stubEnv('VITE_IMAGE_MANAGER_URL', '');
    expect(resolveImageManagerBaseUrl()).toMatch(/^https:\/\//);
  });
});

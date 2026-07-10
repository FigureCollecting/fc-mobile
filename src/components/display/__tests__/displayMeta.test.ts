import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { getDisplayMeta, UNMATTED_META } from '../displayMeta';
import { FIXTURE_META, FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

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

describe('getDisplayMeta — real figure.displayMeta (fc-shared API contract)', () => {
  it('maps matted + contactBand into footprintCenterX/footprintWidth and marks the base recovered', () => {
    const f = fig({
      _id: 'real-1',
      displayMeta: {
        matted: true,
        matteImageId: '10',
        matteVersionId: '3',
        bottomMarginFrac: 0.08,
        contactBand: { centerXFrac: 0.42, widthFrac: 0.31 },
        thumbhash: 'abc123',
        dominantColor: '#112233',
      },
    });
    const meta = getDisplayMeta(f);
    expect(meta.matted).toBe(true);
    expect(meta.baseRecovered).toBe(true);
    expect(meta.footprintCenterX).toBe(0.42);
    expect(meta.footprintWidth).toBe(0.31);
    expect(meta.bottomMarginFrac).toBe(0.08);
    expect(meta.contactBand).toEqual({ centerXFrac: 0.42, widthFrac: 0.31 });
    expect(meta.matteImageId).toBe('10');
    expect(meta.matteVersionId).toBe('3');
    expect(meta.thumbhash).toBe('abc123');
    expect(meta.dominantColor).toBe('#112233');
  });

  it('marks the base NOT recovered when displayMeta has no contactBand (synthetic wider shadow)', () => {
    const f = fig({ _id: 'real-2', displayMeta: { matted: true } });
    const meta = getDisplayMeta(f);
    expect(meta.matted).toBe(true);
    expect(meta.baseRecovered).toBe(false);
    expect(meta.footprintCenterX).toBe(UNMATTED_META.footprintCenterX);
    expect(meta.footprintWidth).toBe(UNMATTED_META.footprintWidth);
  });

  it('renders matted:false when displayMeta.matted is explicitly false (framed-photo fallback)', () => {
    const f = fig({ _id: 'real-3', displayMeta: { matted: false } });
    expect(getDisplayMeta(f).matted).toBe(false);
  });

  it('takes priority over an id that happens to collide with a fixture id', () => {
    const [firstFixtureId] = Object.keys(FIXTURE_META);
    const f = fig({
      _id: firstFixtureId,
      displayMeta: { matted: true, contactBand: { centerXFrac: 0.9, widthFrac: 0.1 } },
    });
    expect(getDisplayMeta(f).footprintCenterX).toBe(0.9);
  });

  it('falls back to FIXTURE_META by exact id when displayMeta is absent', () => {
    const fixture = FIXTURE_FIGURES[0];
    expect(getDisplayMeta(fixture)).toEqual(FIXTURE_META[fixture._id]);
  });

  it('falls back to FIXTURE_META by stripped -xN suffix id when displayMeta is absent', () => {
    const fixture = FIXTURE_FIGURES[0];
    const f = { ...fixture, _id: `${fixture._id}-x3` };
    expect(getDisplayMeta(f)).toEqual(FIXTURE_META[fixture._id]);
  });

  it('falls back to UNMATTED_META when neither displayMeta nor a fixture match exists', () => {
    const f = fig({ _id: 'unknown-real-figure' });
    expect(getDisplayMeta(f)).toEqual(UNMATTED_META);
  });
});

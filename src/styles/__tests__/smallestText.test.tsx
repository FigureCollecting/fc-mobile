import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { SitePrice } from '../../components/prices/SitePrice';
import { SyncBadge } from '../../components/sync/SyncBadge';
import { SyncProgress } from '../../components/sync/SyncProgress';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/ui/StatusBadge';

/** The declarations the rendered stylesheet holds for `selector` (jsdom takes Style's <style> fallback), whitespace collapsed. */
function declarations(selector: string): string {
  const css = Array.from(document.head.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!rule) throw new Error(`no rule for ${selector} in the rendered styles`);
  return rule[1].replace(/\s+/g, ' ').trim();
}

describe('the smallest text renders through --font-2xs, so TYPE-1 and user text scaling reach it', () => {
  afterEach(cleanup);

  it("SyncBadge, the tiles' as-of timestamp, with a line height that grows with it", () => {
    render(<SyncBadge sync="offline-stale" asOf={Date.UTC(2026, 9, 3, 14, 5)} id="badge" />);
    expect(declarations('.sync-badge')).toContain('font-size: var(--font-2xs);');
    expect(declarations('.sync-badge')).toContain('line-height: 1.2;');
  });

  it('StatusBadge, small', () => {
    render(<StatusBadge status="owned" size="sm" />);
    expect(declarations('.status-badge--sm')).toContain('font-size: var(--font-2xs);');
  });

  it('Badge', () => {
    render(<Badge count={3} />);
    expect(declarations('.badge')).toContain('font-size: var(--font-2xs);');
  });

  it("SitePrice's stock label", () => {
    render(
      <SitePrice
        data={{ site: 'Store', price: 12_800, currency: 'JPY', stockStatus: 'pre_order', url: 'https://store.example/item', lastUpdated: '2026-10-01T00:00:00Z' }}
      />,
    );
    expect(declarations('.site-price__stock')).toContain('font-size: var(--font-2xs);');
  });

  it("SyncProgress's phase labels", () => {
    render(<SyncProgress phase="parsing" completed={1} total={4} failed={0} skipped={0} />);
    expect(declarations('.sync-progress__phase-label')).toContain('font-size: var(--font-2xs);');
  });
});

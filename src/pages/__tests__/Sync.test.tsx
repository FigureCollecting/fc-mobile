import { describe, it, expect, vi } from 'vitest';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
    scraperApi: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  };
});

import { Sync } from '../Sync';
import { renderWithProviders } from '../../test/testUtils';

describe('Sync page', () => {
  it('mounts without crashing', () => {
    const { container } = renderWithProviders(<Sync />, { initialPath: '/sync' });
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

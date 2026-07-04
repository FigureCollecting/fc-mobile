import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

import { DetentSheet } from '../DetentSheet';
import { renderWithProviders } from '../../../test/testUtils';

describe('DetentSheet', () => {
  it('portals the sheet to document.body to escape the container-query containing block', () => {
    const { container } = renderWithProviders(
      <DetentSheet open onClose={() => {}} footer={<div>foot</div>}>
        <p>sheet body</p>
      </DetentSheet>,
    );
    // The sheet is NOT in the component's own subtree — a container-query
    // ancestor there would become its `position: fixed` containing block.
    expect(container.querySelector('.detent-sheet')).toBeNull();
    // It is a direct child of document.body instead.
    const sheet = document.body.querySelector('.detent-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.parentElement).toBe(document.body);
    // Content and footer still render through the portal.
    expect(screen.getByText('sheet body')).toBeInTheDocument();
    expect(screen.getByText('foot')).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    renderWithProviders(
      <DetentSheet open={false} onClose={() => {}}>
        <p>hidden</p>
      </DetentSheet>,
    );
    expect(document.body.querySelector('.detent-sheet')).toBeNull();
    expect(screen.queryByText('hidden')).toBeNull();
  });
});

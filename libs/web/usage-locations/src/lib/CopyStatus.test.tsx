/**
 * Tests for CopyStatus.
 *
 * Focus: the phone pill's bottom clearance (toast offset and FAB reserve via
 * the `max()` expression), the floating desktop pill's fixed bottom offset,
 * and the pill being withdrawn while the live region stays mounted. The
 * component has no collaborators, so nothing is mocked.
 */

import { render, screen } from '@testing-library/react';
import { CopyStatus } from './CopyStatus';

const PHONE_BOTTOM_CLASS =
  'bottom-[max(calc(var(--toast-offset,0px)+1.5rem),calc(var(--toast-fab-reserve,0px)+1rem))]';

describe('CopyStatus', () => {
  it('clears both the toast stack and the phone FAB on the phone variant', () => {
    render(<CopyStatus message="Copied" variant="phone" />);

    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('Copied');
    expect(pill.className).toContain(PHONE_BOTTOM_CLASS);
    expect(pill.className).toContain('var(--toast-offset,0px)');
    expect(pill.className).toContain('var(--toast-fab-reserve,0px)');
  });

  it('keeps the fixed bottom-6 offset and no FAB reserve on the floating variant', () => {
    render(<CopyStatus message="Copied" variant="floating" />);

    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('Copied');
    expect(pill.className).toContain('bottom-6');
    expect(pill.className).not.toContain('toast-fab-reserve');
    expect(pill.className).not.toContain(PHONE_BOTTOM_CLASS);
  });

  it('keeps the live region mounted but draws no pill when the message is null', () => {
    render(<CopyStatus message={null} variant="phone" />);

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('');
    expect(region.className).not.toContain('bottom-[max(');
    expect(region.className).not.toContain('toast-fab-reserve');
    expect(region.className).not.toContain('bottom-6');
    expect(region.className).toBe('');
  });
});

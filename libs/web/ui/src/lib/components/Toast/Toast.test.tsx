import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ToastProvider, ToastViewport } from './Toast';

// Regression guard for the phone bottom inset: the viewport must take the
// largest of the three reserves, and md:bottom-0 must still drop it on desktop.
// jsdom does not evaluate max() or the custom properties, so this asserts the
// class tokens only.
describe('ToastViewport', () => {
  it('carries the max() phone bottom utility and md:bottom-0 on the viewport', () => {
    render(
      <ToastProvider>
        <ToastViewport />
      </ToastProvider>,
    );

    expect(screen.getByRole('list')).toHaveClass(
      'bottom-[max(var(--toast-offset,0px),var(--toast-fab-reserve,0px),var(--toast-sheet-reserve,0px))]',
      'md:bottom-0',
    );
  });
});

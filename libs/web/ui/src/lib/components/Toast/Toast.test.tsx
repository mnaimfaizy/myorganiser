import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ToastProvider, ToastViewport } from './Toast';

// Class-contract guards for the viewport's placement. jsdom does not evaluate
// Tailwind CSS, max(), env(), or custom properties, so these assert the class
// tokens only. The phone bottom inset is the larger of the tab-bar and FAB
// reserves; while a [data-bottom-sheet] is in the document, phone pins the
// viewport to the top via max-md:-scoped variants; md and up stay bottom-right.
const renderViewport = () => {
  render(
    <ToastProvider>
      <ToastViewport />
    </ToastProvider>,
  );
  return screen.getByRole('list');
};

describe('ToastViewport', () => {
  it('takes the max() of the tab-bar and FAB reserves for its phone bottom inset, without a sheet reserve', () => {
    const viewport = renderViewport();

    expect(viewport).toHaveClass(
      'bottom-[max(var(--toast-offset,0px),var(--toast-fab-reserve,0px))]',
      'md:bottom-0',
    );
    expect(viewport.className).not.toContain('--toast-sheet-reserve');
  });

  it('carries the sheet-open top-pin classes on phone, each scoped with max-md:', () => {
    const viewport = renderViewport();

    expect(viewport).toHaveClass(
      'max-md:in-[body:has([data-bottom-sheet])]:top-[env(safe-area-inset-top)]',
      'max-md:in-[body:has([data-bottom-sheet])]:bottom-auto',
      'max-md:in-[body:has([data-bottom-sheet])]:flex-col',
    );

    const sheetVariantTokens = Array.from(viewport.classList).filter((token) =>
      token.includes('data-bottom-sheet'),
    );
    expect(sheetVariantTokens).toHaveLength(3);
    expect(
      sheetVariantTokens.every((token) => token.startsWith('max-md:')),
    ).toBe(true);
  });

  it('keeps the desktop bottom-right placement', () => {
    const viewport = renderViewport();

    expect(viewport).toHaveClass('md:bottom-0', 'md:left-auto', 'md:right-0');
  });
});

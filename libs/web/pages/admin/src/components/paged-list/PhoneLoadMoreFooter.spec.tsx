import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  PhoneLoadMoreFooter,
  type PhoneLoadMoreFooterProps,
} from './PhoneLoadMoreFooter';

const ERROR_MESSAGE = 'Could not load more users';

// jsdom has no scrollIntoView, which the error reveal calls.
const scrollIntoView = jest.fn();
Element.prototype.scrollIntoView = scrollIntoView;

// jsdom has no matchMedia. The footer reads it only to pick the scroll behaviour,
// so stub it per test: reduced motion matches only its own query.
function stubMatchMedia(reduceMotion: boolean): jest.Mock {
  const matchMedia = jest.fn((query: string) => ({
    matches: reduceMotion && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  return matchMedia;
}

function footerProps(
  overrides: Partial<PhoneLoadMoreFooterProps> = {},
): PhoneLoadMoreFooterProps {
  return {
    shownCount: 20,
    total: 50,
    hasMore: true,
    loadingMore: false,
    loadMoreError: false,
    errorMessage: ERROR_MESSAGE,
    onLoadMore: jest.fn(),
    ...overrides,
  };
}

describe('PhoneLoadMoreFooter', () => {
  beforeEach(() => {
    scrollIntoView.mockClear();
    stubMatchMedia(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('should scroll the error block into view once with smooth behaviour when reduced motion is off', () => {
    const matchMedia = stubMatchMedia(false);

    render(<PhoneLoadMoreFooter {...footerProps({ loadMoreError: true })} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'smooth',
    });
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('should scroll with instant behaviour when the user prefers reduced motion', () => {
    stubMatchMedia(true);

    render(<PhoneLoadMoreFooter {...footerProps({ loadMoreError: true })} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'instant',
    });
  });

  it('should not scroll again on re-render while the error is still present, but should once more for a new failure', () => {
    const { rerender } = render(
      <PhoneLoadMoreFooter
        {...footerProps({ loadMoreError: true, shownCount: 20 })}
      />,
    );

    rerender(
      <PhoneLoadMoreFooter
        {...footerProps({ loadMoreError: true, shownCount: 40 })}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      <PhoneLoadMoreFooter {...footerProps({ loadMoreError: false })} />,
    );
    rerender(<PhoneLoadMoreFooter {...footerProps({ loadMoreError: true })} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('should not scroll when there is no load-more error', () => {
    render(<PhoneLoadMoreFooter {...footerProps({ loadMoreError: false })} />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('should show the error message without a Try again button when no onRetry is given', () => {
    render(<PhoneLoadMoreFooter {...footerProps({ loadMoreError: true })} />);

    expect(screen.getByText(ERROR_MESSAGE)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('should call onRetry when Try again is clicked', () => {
    const onRetry = jest.fn();
    render(
      <PhoneLoadMoreFooter
        {...footerProps({ loadMoreError: true, onRetry })}
      />,
    );

    expect(screen.getByText(ERROR_MESSAGE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should set scroll-margin-bottom on the error block to the toast offset', () => {
    render(<PhoneLoadMoreFooter {...footerProps({ loadMoreError: true })} />);

    const errorBlock = screen.getByText(ERROR_MESSAGE).parentElement;

    expect(errorBlock).not.toBeNull();
    expect(errorBlock?.style.scrollMarginBottom).toBe(
      'var(--toast-offset, 0px)',
    );
  });
});

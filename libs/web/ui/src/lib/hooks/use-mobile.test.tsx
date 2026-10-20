import { act, renderHook } from '@testing-library/react';
import { useIsMobile } from './use-mobile';

type MatchMediaFn = (query: string) => MediaQueryList;

const originalInnerWidth = window.innerWidth;

function setMatchMedia(value: MatchMediaFn) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value,
  });
}

function removeMatchMedia() {
  Reflect.deleteProperty(window, 'matchMedia');
}

describe('useIsMobile', () => {
  beforeEach(() => {
    removeMatchMedia();
  });

  afterEach(() => {
    window.innerWidth = originalInnerWidth;
    removeMatchMedia();
    jest.restoreAllMocks();
  });

  it('reports desktop at 1024px and phone at 375px when matchMedia is unavailable', () => {
    expect(typeof window.matchMedia).not.toBe('function');

    window.innerWidth = 1024;
    const desktop = renderHook(() => useIsMobile());
    expect(desktop.result.current).toBe(false);
    desktop.unmount();

    window.innerWidth = 375;
    const phone = renderHook(() => useIsMobile());
    expect(phone.result.current).toBe(true);
  });

  it('subscribes to the media query change event and unsubscribes the same handler on unmount', () => {
    const addEventListener = jest.fn();
    const removeEventListener = jest.fn();
    const matchMedia = jest.fn(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener,
          removeEventListener,
        }) as unknown as MediaQueryList,
    );
    setMatchMedia(matchMedia);

    const { unmount } = renderHook(() => useIsMobile());

    expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
    expect(addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    const handler = addEventListener.mock.calls[0][1];

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('change', handler);
  });

  it('updates from innerWidth when the media query change handler fires', () => {
    const addEventListener = jest.fn();
    setMatchMedia(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener,
          removeEventListener: jest.fn(),
        }) as unknown as MediaQueryList,
    );
    window.innerWidth = 1024;

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    window.innerWidth = 375;
    const handler = addEventListener.mock.calls[0][1] as () => void;
    act(() => {
      handler();
    });

    expect(result.current).toBe(true);
  });
});

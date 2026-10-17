/* eslint-disable import/first */

// A generic icon mock, as in LandingContent.spec.tsx: any named lucide export
// becomes a stable svg component, so the clip bodies render without an SVG set.
jest.mock('lucide-react', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const icons = new Map<string, unknown>();
  const iconFor = (name: string) => {
    let icon = icons.get(name);
    if (!icon) {
      icon = (iconProps: Record<string, unknown>) =>
        ReactActual.createElement('svg', { 'data-icon': name, ...iconProps });
      icons.set(name, icon);
    }
    return icon;
  };
  return new Proxy(
    { __esModule: true },
    {
      get: (target, property) => {
        if (typeof property !== 'string' || property in target) {
          return Reflect.get(target, property);
        }
        return iconFor(property);
      },
    },
  );
});

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FeatureClip } from './FeatureClip';
import { LandingMotion } from './LandingMotion';

const CLIP_STEP_MS = 1100;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const SCROLL_DRIVEN_SUPPORT =
  '(animation-timeline: view()) and (animation-range: entry)';

// jsdom has no matchMedia, CSS.supports, or IntersectionObserver. Stub each at
// the window boundary and restore the originals after every test.
const globalWithCss = globalThis as typeof globalThis & { CSS?: unknown };
const originalCss = globalWithCss.CSS;
const originalMatchMedia = window.matchMedia;
const originalIntersectionObserver = window.IntersectionObserver;

function stubMatchMedia(reducedMotion: boolean) {
  window.matchMedia = jest.fn((query: string) => ({
    matches: reducedMotion && query === REDUCED_MOTION_QUERY,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

function stubCssSupports(supported: boolean) {
  const supports = jest.fn(() => supported);
  globalWithCss.CSS = { supports } as unknown as typeof CSS;
  return supports;
}

/** Records every observer LandingMotion creates so a test can drive its callback. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('FeatureClip', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
    jest.useFakeTimers();
    stubMatchMedia(false);
  });

  afterEach(() => {
    const errors = consoleError.mock.calls;
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
    globalWithCss.CSS = originalCss;
    window.IntersectionObserver = originalIntersectionObserver;
  });

  describe('timing and playback', () => {
    it('advances one step per interval and loops back to the first step after the last', () => {
      render(<FeatureClip feature="addresses" />);
      expect(screen.getByText('0 of 5 notified')).toBeInTheDocument();

      advance(CLIP_STEP_MS - 1);
      expect(screen.getByText('0 of 5 notified')).toBeInTheDocument();

      advance(1);
      expect(screen.getByText('1 of 5 notified')).toBeInTheDocument();

      // Step 7 is the last of the eight addresses steps.
      advance(CLIP_STEP_MS * 6);
      expect(screen.getByText('All notified ✓')).toBeInTheDocument();

      advance(CLIP_STEP_MS);
      expect(screen.getByText('0 of 5 notified')).toBeInTheDocument();
    });

    it('stops advancing while paused and resumes when played again', () => {
      render(<FeatureClip feature="addresses" />);
      advance(CLIP_STEP_MS);
      expect(screen.getByText('1 of 5 notified')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Pause demo' }));
      expect(
        screen.getByRole('button', { name: 'Play demo' }),
      ).toBeInTheDocument();

      advance(CLIP_STEP_MS * 5);
      expect(screen.getByText('1 of 5 notified')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Play demo' }));
      expect(
        screen.getByRole('button', { name: 'Pause demo' }),
      ).toBeInTheDocument();

      advance(CLIP_STEP_MS);
      expect(screen.getByText('2 of 5 notified')).toBeInTheDocument();
    });

    it('holds the final step without any interval under prefers-reduced-motion', () => {
      stubMatchMedia(true);
      render(<FeatureClip feature="addresses" />);
      expect(screen.getByText('All notified ✓')).toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(0);

      advance(CLIP_STEP_MS * 5);
      expect(screen.getByText('All notified ✓')).toBeInTheDocument();
    });

    it('clears its interval on unmount', () => {
      const { unmount } = render(<FeatureClip feature="addresses" />);
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      unmount();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('rendering', () => {
    it('renders the checklist body for each change-of-details feature', () => {
      const { unmount } = render(<FeatureClip feature="addresses" />);
      expect(
        screen.getByText('Who needs your new address'),
      ).toBeInTheDocument();
      expect(screen.getByText('12 Elm Grove')).toBeInTheDocument();
      unmount();

      render(<FeatureClip feature="mobileNumbers" />);
      expect(screen.getByText('Who needs your new number')).toBeInTheDocument();
      expect(screen.getByText('07700 900123')).toBeInTheDocument();
    });

    it('shows the window chrome with the clip path unless bare is set', () => {
      const { unmount } = render(<FeatureClip feature="tasks" />);
      expect(screen.getByText('/dashboard/tasks')).toBeInTheDocument();
      unmount();

      render(<FeatureClip feature="tasks" bare />);
      expect(screen.queryByText('/dashboard/tasks')).not.toBeInTheDocument();
      expect(screen.getByText('Today')).toBeInTheDocument();
    });

    it('drops the secondary detail and trailing rows in the compact checklist', () => {
      const { unmount } = render(<FeatureClip feature="addresses" />);
      expect(screen.getByText('App → Profile')).toBeInTheDocument();
      expect(screen.getByText('Energy supplier')).toBeInTheDocument();
      unmount();

      render(<FeatureClip feature="addresses" compact />);
      expect(screen.queryByText('App → Profile')).not.toBeInTheDocument();
      expect(screen.queryByText('Energy supplier')).not.toBeInTheDocument();
      expect(screen.getByText('Electoral roll')).toBeInTheDocument();
    });

    it('hides the mock UI from assistive technology and keeps the pause control outside it', () => {
      render(<FeatureClip feature="tasks" />);

      expect(
        screen.getByText('Today').closest('[aria-hidden="true"]'),
      ).not.toBeNull();
      expect(
        screen
          .getByRole('button', { name: 'Pause demo' })
          .closest('[aria-hidden="true"]'),
      ).toBeNull();
    });
  });
});

describe('LandingMotion', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
    FakeIntersectionObserver.instances = [];
    stubMatchMedia(false);
    window.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    const errors = consoleError.mock.calls;
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    window.matchMedia = originalMatchMedia;
    globalWithCss.CSS = originalCss;
    window.IntersectionObserver = originalIntersectionObserver;
  });

  it('applies no fallback class and creates no observer when scroll-driven animations are supported', () => {
    const supports = stubCssSupports(true);
    const { container } = render(
      <LandingMotion>
        <div className="lp-reveal">Reveal</div>
      </LandingMotion>,
    );

    expect(supports).toHaveBeenCalledWith(SCROLL_DRIVEN_SUPPORT);
    expect(container.querySelector('.mo-landing')).not.toHaveClass(
      'lp-fallback',
    );
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('marks the root for fallback and reveals only the reveal targets the observer reports intersecting', () => {
    stubCssSupports(false);
    const { container, unmount } = render(
      <LandingMotion>
        <div className="lp-reveal" data-testid="shown">
          Shown
        </div>
        <div className="lp-reveal" data-testid="later">
          Later
        </div>
      </LandingMotion>,
    );

    const root = container.querySelector('.mo-landing');
    expect(root).toHaveClass('lp-fallback');
    expect(FakeIntersectionObserver.instances).toHaveLength(1);

    const [observer] = FakeIntersectionObserver.instances;
    expect(observer.options).toEqual({
      rootMargin: '0px 0px -10% 0px',
      threshold: 0.1,
    });
    const shown = screen.getByTestId('shown');
    const later = screen.getByTestId('later');
    expect(observer.observe).toHaveBeenCalledWith(shown);
    expect(observer.observe).toHaveBeenCalledWith(later);

    observer.callback(
      [
        { isIntersecting: true, target: shown },
        { isIntersecting: false, target: later },
      ] as unknown as IntersectionObserverEntry[],
      observer as unknown as IntersectionObserver,
    );

    expect(shown).toHaveClass('is-in');
    expect(later).not.toHaveClass('is-in');
    expect(observer.unobserve).toHaveBeenCalledWith(shown);

    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(root).not.toHaveClass('lp-fallback');
  });

  it('takes its early return under prefers-reduced-motion even when scroll-driven animations are unsupported', () => {
    stubMatchMedia(true);
    stubCssSupports(false);
    const { container } = render(
      <LandingMotion>
        <div className="lp-reveal">Reveal</div>
      </LandingMotion>,
    );

    expect(container.querySelector('.mo-landing')).not.toHaveClass(
      'lp-fallback',
    );
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });
});

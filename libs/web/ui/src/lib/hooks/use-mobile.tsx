import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * The shared breakpoint read. `undefined` until the first effect has decided
 * (SSR and the first client render), then `true` below 768px and `false` at
 * or above it. Both public hooks read through this so the logic stays in one
 * place.
 */
function useBreakpointState(): boolean | undefined {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    // jsdom has no matchMedia: read the width once, which is desktop there.
    if (typeof window.matchMedia !== 'function') {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      return;
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

export function useIsMobile() {
  return !!useBreakpointState();
}

/**
 * Like `useIsMobile`, but returns `undefined` until the breakpoint has been
 * decided. Use it where a desktop-first first frame would be wrong on a phone:
 * render a layout-stable placeholder while `undefined`, then the phone or
 * desktop variant.
 */
export function useIsMobileState(): boolean | undefined {
  return useBreakpointState();
}

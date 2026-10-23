/**
 * Width guards for play functions that measure a breakpoint.
 *
 * The CLI test-runner sizes its page from `parameters.viewport` before a story
 * renders (`.storybook/test-runner.ts`), so a Phone story is always measured at
 * phone width there. The dev Storybook has no viewport addon installed, so the
 * same story renders at whatever width the browser has; on a wide screen a
 * phone-size assertion would fail against the desktop layout. A play calls one
 * of these first and skips its size assertions when the window is the other
 * side of the `md` breakpoint (768px, as `useIsMobile`).
 */
const MD_BREAKPOINT = 768;

/** True when the window is narrower than `md`: the phone layout is showing. */
export function isPhoneWidth(): boolean {
  return window.innerWidth < MD_BREAKPOINT;
}

/** True when the window is at least `md`: the desktop layout is showing. */
export function isDesktopWidth(): boolean {
  return !isPhoneWidth();
}

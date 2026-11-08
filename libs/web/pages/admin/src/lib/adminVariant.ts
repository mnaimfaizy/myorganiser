/**
 * Which layout an admin view renders: the desktop table or the phone list.
 * The page client decides it from `useIsMobileState()`: desktop is the md
 * breakpoint (768px) and up, phone is below.
 */
export type AdminVariant = 'desktop' | 'phone';

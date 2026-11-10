type CopyStatusVariant = 'floating' | 'phone';

export interface CopyStatusProps {
  /** The live confirmation, or null once it has faded. */
  message: string | null;
  /**
   * `floating` is the desktop pill fixed to the bottom of the viewport;
   * `phone` is the full-width pill above the bottom edge and any toast.
   */
  variant: CopyStatusVariant;
}

const COPY_STATUS_CLASSES = {
  floating:
    'fixed bottom-6 left-1/2 z-20 flex min-h-12 -translate-x-1/2 items-center rounded-control bg-navy px-4 text-body-sm font-semibold text-navy-foreground shadow-toast',
  /**
   * Clears the toast stack via `--toast-offset`, and also the phone FAB via
   * `--toast-fab-reserve` (the FAB's top edge, set by the dashboard layout
   * while a `[data-phone-fab]` is mounted), keeping a 1rem gap above it.
   * Whichever clearance is taller wins.
   */
  phone:
    'fixed inset-x-4 bottom-[max(calc(var(--toast-offset,0px)+1.5rem),calc(var(--toast-fab-reserve,0px)+1rem))] z-20 flex min-h-13 items-center rounded-control bg-navy px-4 text-body font-semibold text-navy-foreground shadow-toast',
} as const satisfies Record<CopyStatusVariant, string>;

/**
 * The copy confirmation. Its live region stays mounted so screen readers
 * announce the message; the pill is drawn only while a message is set.
 */
export function CopyStatus({ message, variant }: CopyStatusProps) {
  return (
    <div
      role="status"
      className={message ? COPY_STATUS_CLASSES[variant] : undefined}
    >
      {message}
    </div>
  );
}

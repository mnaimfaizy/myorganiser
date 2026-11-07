import type { FieldErrors, FieldValues } from 'react-hook-form';

const FALLBACK = 'Check your choices and try again.';

/**
 * The toast shown when validation blocks a save, so a blocked save is never
 * silent. It carries the first field's schema message.
 */
export function invalidSaveToast<T extends FieldValues>(
  errors: FieldErrors<T>,
) {
  const first = Object.values(errors)[0] as { message?: unknown } | undefined;
  const message =
    typeof first?.message === 'string' && first.message
      ? first.message
      : FALLBACK;
  return {
    title: 'Not saved',
    description: message,
    variant: 'destructive' as const,
  };
}

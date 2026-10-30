/**
 * Whether a stored link is safe to follow: scheme `http` or `https`,
 * case-insensitive, after trimming. Anything else — `javascript:`, `data:`,
 * `vbscript:`, `intent:`, `tel:`, or a scheme-less value — is not, and
 * neither is an empty value.
 */
export function isSafeLink(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A stored link, trimmed, only when it is safe to open — `null` otherwise,
 * including a missing or empty value.
 */
export function openableLink(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return isSafeLink(trimmed) ? trimmed : null;
}

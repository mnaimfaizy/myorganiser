/**
 * Whether a stored link is safe to follow: after trimming, it literally starts
 * `http://` or `https://`, case-insensitive, and parses. Anything else —
 * `javascript:`, `data:`, `vbscript:`, `intent:`, `tel:`, a scheme-less value,
 * or an empty one — is not. The text itself has to say so, not only what
 * `URL` makes of it: the parser strips tabs and newlines and accepts
 * `https:example.com`, and what gets opened is the text.
 */
export function isSafeLink(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed) || /[\t\r\n]/.test(trimmed)) return false;
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

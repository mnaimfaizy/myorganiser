'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a copied address line stays on the clipboard. */
export const COPY_EXPIRY_SECONDS = 60;

/** How long the "copied" confirmation stays on screen. */
const CONFIRMATION_MS = 4000;

/** What the page says when the browser refuses the write. */
export const COPY_FAILED_MESSAGE =
  'Could not copy. Select the text and copy it instead.';

export interface ExpiringCopy {
  /**
   * Writes `value` to the clipboard and announces `${label} copied — clears
   * in 60 s`. Resolves false, and announces `COPY_FAILED_MESSAGE`, when the
   * browser refuses the write.
   */
  copy: (label: string, value: string) => Promise<boolean>;
  /** The live confirmation, or null once it has faded. */
  message: string | null;
}

// The pending clear lives at module scope, not in the component: copying on
// the list and then opening an Address unmounts the list, and the copied
// address must still leave the clipboard on time.
let pendingClear: ReturnType<typeof setTimeout> | null = null;
let copiedElsewhere = false;
let listening = false;

function listenForUserCopies() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // writeText does not fire `copy`, so only a copy the user makes lands here.
  document.addEventListener('copy', () => {
    copiedElsewhere = true;
  });
}

function scheduleClear() {
  copiedElsewhere = false;
  if (pendingClear) clearTimeout(pendingClear);
  pendingClear = setTimeout(() => {
    pendingClear = null;
    void clearIfStillOurs();
  }, COPY_EXPIRY_SECONDS * 1000);
}

async function clearIfStillOurs(): Promise<void> {
  if (copiedElsewhere) return;
  try {
    await navigator.clipboard.writeText('');
  } catch {
    // A tab without focus may not write; the copy then outlives its timer.
  }
}

/**
 * Copies an address line and clears it from the clipboard after
 * `COPY_EXPIRY_SECONDS`, even if the page that copied it has gone, unless the
 * user has copied something else in this document since. The clipboard is
 * never read back: reading asks the user for a permission, and a prompt a
 * minute after the copy would make no sense.
 */
export function useExpiringCopy(): ExpiringCopy {
  const [message, setMessage] = useState<string | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listenForUserCopies();
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  const announce = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => {
      messageTimer.current = null;
      setMessage(null);
    }, CONFIRMATION_MS);
  }, []);

  const copy = useCallback(
    async (label: string, value: string) => {
      const clipboard =
        typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      try {
        if (!clipboard?.writeText) throw new Error('No clipboard');
        await clipboard.writeText(value);
      } catch {
        announce(COPY_FAILED_MESSAGE);
        return false;
      }

      scheduleClear();
      announce(`${label} copied — clears in ${COPY_EXPIRY_SECONDS} s`);
      return true;
    },
    [announce],
  );

  return { copy, message };
}

'use client';

import { EscapeCopyReaderCard } from './EscapeCopyReaderCard';

/** Content for `/dashboard/vault/reader`. The phone shell supplies the bar and back link. */
export function VaultReaderScreen() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-display text-display sr-only md:not-sr-only">
        Escape Copy reader
      </h1>
      <EscapeCopyReaderCard justMadeACopy={false} />
    </div>
  );
}

import type { ReactNode } from 'react';

import { Card, Illustration } from '@myorganiser/web-ui';

export interface VaultGateFrameProps {
  /** The screen title, rendered as the page's only h1 on the gate. */
  title: string;
  children: ReactNode;
  /**
   * The top-bordered footer section (the Recovery Key Claim Offer). Omit it on
   * a screen that has no offer.
   */
  footer?: ReactNode;
}

/**
 * The one frame every VaultGate screen that asks something of the User shares
 * (VaultUnlock artboard): a centred card with the vault illustration, the title
 * as an h1, the screen's own content, and an optional footer section below a
 * hairline. Presentational only; the gate keeps its state and handlers and
 * passes its content in.
 */
export function VaultGateFrame({
  title,
  children,
  footer,
}: VaultGateFrameProps) {
  return (
    <div className="flex flex-1 flex-col items-center gap-4 p-4 md:pt-14">
      <Card className="flex w-full flex-col gap-4 p-6 md:max-w-md md:p-9">
        <Illustration kind="vault" size={96} />
        <h1 className="font-display text-title-lg">{title}</h1>
        {children}
        {footer ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            {footer}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

import type { ReactNode } from 'react';

import { Card, Illustration } from '@myorganiser/web-ui';

export interface VaultGateFrameProps {
  /** The screen title, rendered as the page's only h1 on the gate. */
  title: string;
  /**
   * The explanatory line rendered directly under the h1, grouped with it at a
   * 6px gap in muted body text. Omit it on a screen that has none.
   */
  description?: ReactNode;
  children: ReactNode;
  /**
   * The top-bordered footer section (the Recovery Key Claim Offer). Omit it on
   * a screen that has no offer.
   */
  footer?: ReactNode;
}

/**
 * The one frame every VaultGate screen that asks something of the User shares
 * (VaultUnlock artboard): a card with the vault illustration, the title as an
 * h1, an optional description, the screen's own content, and an optional
 * footer section below a hairline. Presentational only; the gate keeps its
 * state and handlers and passes its content in.
 *
 * Below md the header group (illustration, h1, description) is centred, as on
 * the phone artboard. From md the card takes the desktop artboard's 24px
 * radius, 36px padding, 18px rhythm and 480px maximum width, and the header
 * group is left-aligned.
 */
export function VaultGateFrame({
  title,
  description,
  children,
  footer,
}: VaultGateFrameProps) {
  return (
    <div className="flex flex-1 flex-col items-center gap-4 p-4 md:pt-14">
      <Card className="flex w-full flex-col gap-4 p-6 md:max-w-[30rem] md:gap-4.5 md:rounded-[var(--radius-2xl)] md:p-9 md:shadow-popover">
        <div className="flex flex-col items-center gap-3.5 text-center md:items-start md:gap-4.5 md:text-left">
          <Illustration kind="vault" size={96} className="size-26 md:size-22" />
          <div className="flex flex-col items-center gap-1.5 md:items-start">
            <h1 className="font-display text-title-lg">{title}</h1>
            {description ? (
              <p className="text-body-sm text-foreground-supporting">
                {description}
              </p>
            ) : null}
          </div>
        </div>
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

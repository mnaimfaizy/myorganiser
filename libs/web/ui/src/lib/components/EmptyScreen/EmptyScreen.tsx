import * as React from 'react';
import { cn } from '../../utils';
import {
  Illustration,
  type IllustrationKind,
} from '../Illustration/Illustration';

export interface EmptyScreenProps {
  /** Section illustration, shown at 112. */
  illustration: IllustrationKind;
  /** The screen h1, for example "Addresses". */
  title: string;
  /** The centred h2, for example "No addresses yet". */
  heading: string;
  /** The centred body copy. */
  line: React.ReactNode;
  /**
   * The call to action. It is stretched to the full width of the screen. Pass
   * a `Button variant="brand" size="lg"` with a plus icon, or a link
   * `Button asChild`.
   */
  action: React.ReactNode;
  /** The trust note under the action. Defaults to "Encrypted on this phone". Pass `null` to hide it. */
  note?: React.ReactNode | null;
  /** The top bar slot, for example the "‹ More" back link. Owned by the phone shell. */
  navigation?: React.ReactNode;
  className?: string;
}

/**
 * Empty state for a phone screen (below md). The page title sits under the
 * navigation slot and the content is centred. Presentational, with no domain
 * knowledge.
 */
const EmptyScreen = React.forwardRef<HTMLDivElement, EmptyScreenProps>(
  (
    {
      illustration,
      title,
      heading,
      line,
      action,
      note = 'Encrypted on this phone',
      navigation,
      className,
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-dvh flex-col bg-background text-foreground',
        className,
      )}
    >
      {navigation}
      <h1 className="px-4 font-display text-display text-foreground">
        {title}
      </h1>
      <div className="flex grow flex-col items-center justify-center gap-3 px-8 pb-20 text-center">
        <Illustration kind={illustration} size={112} />
        <h2 className="font-display text-title text-foreground">{heading}</h2>
        <p className="text-body-sm text-foreground-supporting">{line}</p>
        <div className="mt-2 flex w-full flex-col [&>*]:w-full">{action}</div>
        {note !== null ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-trust-text">
            <span aria-hidden="true" className="size-2 rounded-full bg-trust" />
            {note}
          </span>
        ) : null}
      </div>
    </div>
  ),
);
EmptyScreen.displayName = 'EmptyScreen';

export { EmptyScreen };

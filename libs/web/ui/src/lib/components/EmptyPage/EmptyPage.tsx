import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils';
import {
  Illustration,
  type IllustrationKind,
} from '../Illustration/Illustration';

export interface EmptyPageProps {
  /** Section illustration shown at 64 beside the title and at 168 in the card. */
  illustration: IllustrationKind;
  /** The page h1, for example "Addresses". */
  title: string;
  /** The line under the title. Defaults to "Nothing saved yet". */
  summary?: string;
  /** The card h2, for example "No addresses yet". */
  heading: string;
  /** The card body copy. */
  line: React.ReactNode;
  /** Short tips rendered as a checked list. Omit or pass an empty list to hide it. */
  tips?: readonly string[];
  /**
   * The call to action. Pass a `Button variant="brand" size="lg"` with a plus
   * icon, or a link `Button asChild`, so the caller can open a dialog or navigate.
   */
  action: React.ReactNode;
  /**
   * The trust note beside the action. Defaults to "Encrypted on this device
   * before it syncs". Pass `null` to hide it.
   */
  note?: React.ReactNode | null;
  className?: string;
}

/**
 * Empty state for a feature page (Addresses, Mobile numbers, Subscriptions).
 * Renders the content column only (a div, not a landmark). The app shell (sidebar and header) is
 * owned by the page layout. Presentational, with no domain knowledge.
 *
 * On phones the card stacks through its flex-wrap, but phone screens use
 * EmptyScreen instead.
 */
const EmptyPage = React.forwardRef<HTMLDivElement, EmptyPageProps>(
  (
    {
      illustration,
      title,
      summary = 'Nothing saved yet',
      heading,
      line,
      tips,
      action,
      note = 'Encrypted on this device before it syncs',
      className,
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'mx-auto flex w-full max-w-300 flex-col gap-6 p-8',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <Illustration kind={illustration} size={64} />
        <div className="flex min-w-0 grow flex-col">
          <h1 className="font-display text-title-lg text-foreground">
            {title}
          </h1>
          <span className="text-body-sm text-muted-foreground">{summary}</span>
        </div>
      </div>
      <section className="flex flex-wrap items-center gap-10 rounded-2xl border border-border bg-card p-12">
        <Illustration kind={illustration} size={168} />
        <div className="flex grow basis-95 flex-col gap-3.5">
          <h2 className="font-display text-title-lg text-foreground">
            {heading}
          </h2>
          <p className="max-w-130 text-body text-foreground-supporting">
            {line}
          </p>
          {tips && tips.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {tips.map((tip) => (
                <li
                  key={tip}
                  className="flex items-center gap-2.5 text-body-sm text-foreground-secondary"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text"
                  >
                    <Check className="size-3" />
                  </span>
                  {tip}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
            {action}
            {note !== null ? (
              <span className="inline-flex items-center gap-1.5 text-caption text-trust-text">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-trust"
                />
                {note}
              </span>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  ),
);
EmptyPage.displayName = 'EmptyPage';

export { EmptyPage };

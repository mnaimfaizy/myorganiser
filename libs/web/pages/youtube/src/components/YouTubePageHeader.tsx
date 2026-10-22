import { Illustration } from '@myorganiser/web-ui';
import type { ReactNode } from 'react';

interface YouTubePageHeaderProps {
  title: string;
  /** Visible under the title on both variants (phone: caption size). */
  subtitle?: ReactNode;
  /** Right-hand controls, e.g. the Sync uploads button. */
  actions?: ReactNode;
  /** Desktop shows the illustration and visible title; phone hides the title (the shell draws it). */
  variant: 'desktop' | 'phone';
}

/**
 * The YouTube page heading. On phone the app shell already draws the pushed
 * title, so the h1 is visually hidden and only the subtitle and actions show.
 */
const YouTubePageHeader = ({
  title,
  subtitle,
  actions,
  variant,
}: YouTubePageHeaderProps) => {
  if (variant === 'phone') {
    return (
      <div className="flex items-start gap-3">
        <Illustration kind="youtube" size={48} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="sr-only">{title}</h1>
          {subtitle ? (
            <p className="text-caption text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center">{actions}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Illustration kind="youtube" size={64} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 font-display text-title-lg text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-body text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export { YouTubePageHeader };
export type { YouTubePageHeaderProps };

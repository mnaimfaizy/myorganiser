import { cn, Illustration, type IllustrationKind } from '@myorganiser/web-ui';
import { LEGAL_CONTENT_WIDTH } from '../lib/legal-styles';
import { LegalBackLink } from './LegalBackLink';

export interface LegalPageHeroProps {
  title: string;
  illustration: IllustrationKind;
  /** Shown as "Last updated: …" under the title when given. */
  lastUpdated?: string;
}

/** Navy hero with the back link, the document title and its illustration. */
export function LegalPageHero({
  title,
  illustration,
  lastUpdated,
}: LegalPageHeroProps) {
  return (
    <div className="bg-primary px-6 py-10 text-primary-foreground">
      <div
        className={cn(LEGAL_CONTENT_WIDTH, 'flex flex-wrap items-center gap-6')}
      >
        <div className="flex min-w-0 flex-[1_1_320px] flex-col items-start">
          <LegalBackLink />
          <h1 className="font-display text-display">{title}</h1>
          {lastUpdated && (
            <p className="mt-2 text-body-sm text-navy-muted-foreground">
              Last updated: {lastUpdated}
            </p>
          )}
        </div>
        <Illustration kind={illustration} size={96} />
      </div>
    </div>
  );
}

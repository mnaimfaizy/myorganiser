import { Button, Illustration } from '@myorganiser/web-ui';
import Link from 'next/link';

import type { HomeVaultPrompt } from '../home-view';

export interface HomeVaultCardProps {
  prompt: HomeVaultPrompt;
}

/** The phone's not-open headline: the Vault state's own words and one way in. */
export function HomeVaultCard({ prompt }: HomeVaultCardProps) {
  return (
    <section
      aria-label={prompt.cardTitle}
      className="flex flex-col gap-3 rounded-panel bg-navy p-4.5 text-navy-foreground"
    >
      <div className="flex items-center gap-3.5">
        <Illustration kind="vault" size={64} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-title text-navy-foreground">
            {prompt.cardTitle}
          </span>
          <span className="text-caption text-navy-muted-foreground">
            {prompt.cardCaption}
          </span>
        </span>
      </div>
      <Button variant="brand" className="h-12 w-full" asChild>
        <Link href={prompt.cardAction.href}>{prompt.cardAction.label}</Link>
      </Button>
      {prompt.cardSecondaryAction !== null && (
        <Link
          href={prompt.cardSecondaryAction.href}
          className="self-center p-1.5 text-caption font-semibold text-navy-accent no-underline"
        >
          {prompt.cardSecondaryAction.label}
        </Link>
      )}
    </section>
  );
}

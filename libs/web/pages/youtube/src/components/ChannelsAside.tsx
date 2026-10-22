import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import { YOUTUBE_DATA_PRIVACY_BULLETS } from '../lib/dataPrivacyCopy';

interface ChannelsAsideProps {
  onRequestDisconnect: () => void;
  disconnectDisabled: boolean;
  disconnectDisabledReason?: string;
}

export function ChannelsAside({
  onRequestDisconnect,
  disconnectDisabled,
  disconnectDisabledReason,
}: ChannelsAsideProps) {
  const disconnectReason =
    disconnectDisabled && disconnectDisabledReason
      ? disconnectDisabledReason
      : undefined;

  return (
    <aside className="flex min-w-0 flex-col gap-4 md:flex-[1_1_300px]">
      <section className="flex flex-col gap-2.5 rounded-panel border border-border bg-raised-surface p-4.5">
        <h2 className="m-0 text-body font-semibold text-foreground">
          How your YouTube data is kept
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-body-sm text-foreground-secondary">
          {YOUTUBE_DATA_PRIVACY_BULLETS.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <Link
          href="/youtube/data-privacy"
          className="w-fit text-body-sm font-semibold text-brand-text underline-offset-4 hover:underline"
        >
          Read the details
        </Link>
      </section>

      <section className="flex items-center gap-3 rounded-panel border border-border bg-raised-surface p-4.5">
        <h2 className="m-0 min-w-0 flex-1 text-body font-semibold text-foreground">
          Weekly digest
        </h2>
        <Link
          href="/dashboard/account"
          className="shrink-0 text-body-sm font-semibold text-brand-text underline-offset-4 hover:underline"
        >
          Change in Account
        </Link>
      </section>

      <section className="flex flex-col gap-2.5 rounded-panel border border-destructive-edge bg-raised-surface p-4.5">
        <h2 className="m-0 text-body font-semibold text-foreground">
          Disconnect YouTube
        </h2>
        <p className="m-0 text-body-sm text-muted-foreground">
          Deletes cached uploads and Watched marks. Reconnecting starts fresh.
        </p>
        <Button
          variant="outline"
          onClick={onRequestDisconnect}
          disabled={disconnectDisabled}
          aria-label={disconnectReason ?? 'Disconnect YouTube account'}
          title={disconnectReason}
          className="w-fit border-destructive-edge text-destructive-text hover:text-destructive-text"
        >
          Disconnect…
        </Button>
      </section>
    </aside>
  );
}

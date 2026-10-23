import { Button, Illustration } from '@myorganiser/web-ui';
import Link from 'next/link';

/** The phone's locked headline: unlock from here, or with a recovery key. */
export function HomeLockedCard() {
  return (
    <section
      aria-label="Vault locked"
      className="flex flex-col gap-3 rounded-panel bg-navy p-4.5 text-navy-foreground"
    >
      <div className="flex items-center gap-3.5">
        <Illustration kind="vault" size={64} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-title text-navy-foreground">
            Vault locked
          </span>
          <span className="text-caption text-navy-muted-foreground">
            Your data stays encrypted on this device
          </span>
        </span>
      </div>
      <Button variant="brand" className="h-12 w-full" asChild>
        <Link href="/dashboard/vault">Unlock</Link>
      </Button>
      <Link
        href="/dashboard/vault"
        className="self-center p-1.5 text-caption font-semibold text-navy-accent no-underline"
      >
        Use recovery key instead
      </Link>
    </section>
  );
}

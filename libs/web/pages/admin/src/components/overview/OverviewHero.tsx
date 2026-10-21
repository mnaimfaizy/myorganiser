import Link from 'next/link';

import { Button, Illustration } from '@myorganiser/web-ui';

import { ADMIN_SECTIONS } from '../../lib/adminNav';

/** The desktop Overview hero: the admin illustration, the h1, and two links. */
export function OverviewHero() {
  return (
    <div className="hidden flex-wrap items-center gap-5 md:flex">
      <Illustration kind="admin" size={64} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="font-display text-display text-foreground">
          Platform overview
        </h1>
        <p className="text-body text-muted-foreground">
          Accounts and access only. Vault contents are never visible to admins.
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Button asChild variant="outline">
          <Link href={ADMIN_SECTIONS.users.url}>Open users</Link>
        </Button>
        <Button asChild>
          <Link href={ADMIN_SECTIONS.audit.url}>View audit log</Link>
        </Button>
      </div>
    </div>
  );
}

'use client';

import { getCurrentUser, isPlatformAdmin } from '@myorganiser/auth';
import { User } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Illustration, type IllustrationKind } from '@myorganiser/web-ui';

import { createFeedbackApi } from '../../lib/apiClient';
import { openFeedbackDialog } from '../../hooks/use-feedback-dialog';
import { useLogOut } from '../../hooks/use-log-out';
import { useYouTubeNavVisible } from '../../hooks/useYouTubeNavVisible';
import { initialsOf } from '../../utils';

interface MoreLink {
  id: string;
  href: string;
  kind: IllustrationKind;
  label: string;
}

const ORGANISE_LINKS: readonly MoreLink[] = [
  {
    id: 'subscriptions',
    href: '/dashboard/subscriptions',
    kind: 'subscriptions',
    label: 'Subscriptions',
  },
  {
    id: 'addresses',
    href: '/dashboard/addresses',
    kind: 'addresses',
    label: 'Addresses',
  },
  {
    id: 'mobile',
    href: '/dashboard/mobile-numbers',
    kind: 'mobile',
    label: 'Mobile numbers',
  },
  {
    id: 'youtube',
    href: '/dashboard/youtube',
    kind: 'youtube',
    label: 'YouTube',
  },
];

/** One row of a grouped card: a 56px tap target with a rule under it. */
const ROW_CLASS =
  'flex min-h-14 w-full items-center gap-3 border-b border-border-subtle py-1.5 pr-3.5 pl-3 text-left text-body text-foreground no-underline last:border-b-0';

/**
 * The More tab: the sections that do not fit the tab bar, plus the account
 * actions. The visible large title comes from PhoneAppBar on the phone and
 * from DashboardHeader on desktop, so this screen keeps only a visually
 * hidden h1.
 */
export function MoreScreen() {
  const currentUser = getCurrentUser();
  const name = currentUser?.name ?? '';
  const email = currentUser?.email ?? '';
  const initials = initialsOf(name) || email.charAt(0).toUpperCase();
  const youtubeVisible = useYouTubeNavVisible();
  const [hasUnreadReports, setHasUnreadReports] = useState(false);

  useEffect(() => {
    let active = true;
    const loadReports = async () => {
      try {
        const response = await createFeedbackApi().listReports();
        if (active) {
          setHasUnreadReports(response.data.hasChangedSinceLastSeen === true);
        }
      } catch {
        // No badge on failure; the reports page holds the real content.
      }
    };
    void loadReports();
    return () => {
      active = false;
    };
  }, []);

  const sendFeedback = useCallback(() => {
    openFeedbackDialog();
  }, []);

  const logOut = useLogOut();

  const organiseLinks = ORGANISE_LINKS.filter(
    (link) => link.id !== 'youtube' || youtubeVisible,
  );

  return (
    <div className="flex flex-col gap-3 pt-3 pb-6 pl-[calc(1rem_+_env(safe-area-inset-left))] pr-[calc(1rem_+_env(safe-area-inset-right))] md:pt-6 md:pr-8 md:pl-8">
      <h1 className="sr-only">More</h1>

      <h2 className="text-label-caps text-muted-foreground">ORGANISE</h2>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        {organiseLinks.map((link) => (
          <Link key={link.id} href={link.href} className={ROW_CLASS}>
            <Illustration kind={link.kind} size={32} />
            <span className="flex-1">{link.label}</span>
          </Link>
        ))}
      </div>

      <h2 className="text-label-caps text-muted-foreground">YOU</h2>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <Link href="/dashboard/account" className={ROW_CLASS}>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand font-display text-label-caps text-brand-foreground"
          >
            {initials || <User aria-hidden="true" className="size-4" />}
          </span>
          <span className="flex-1">Account</span>
        </Link>
        <button type="button" onClick={sendFeedback} className={ROW_CLASS}>
          <Illustration kind="feedback" size={32} />
          <span className="flex-1">Send feedback</span>
        </button>
        <Link href="/dashboard/account/reports" className={ROW_CLASS}>
          <Illustration kind="feedback" size={32} />
          <span className="flex-1">Your reports</span>
          {hasUnreadReports && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-label-caps text-brand-foreground">
              Updated
            </span>
          )}
        </Link>
        {isPlatformAdmin(currentUser) && (
          <Link href="/admin" className={ROW_CLASS}>
            <Illustration kind="admin" size={32} />
            <span className="flex-1">Admin portal</span>
          </Link>
        )}
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          onClick={logOut}
          className="flex min-h-14 w-full items-center py-1.5 pr-3.5 pl-3 text-left text-body font-semibold text-destructive"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

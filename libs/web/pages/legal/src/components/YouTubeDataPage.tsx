import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL_NUMBER_BADGE, LEGAL_TEXT } from '../lib/legal-styles';
import { LegalPageActions } from './LegalPageActions';
import { LegalPageBody } from './LegalPageBody';
import { LegalPageFooter } from './LegalPageFooter';
import { LegalPageHeader } from './LegalPageHeader';
import { LegalPageHero } from './LegalPageHero';
import { LegalPageLayout } from './LegalPageLayout';

const FACT_ROW_CLASS =
  'flex items-start gap-3.5 rounded-panel border border-border bg-card px-5 py-4 text-body text-foreground-secondary';

/** The seven numbered facts, in order. The badge number is the index plus one. */
const YOUTUBE_DATA_FACTS: readonly ReactNode[] = [
  <>
    We store <strong className={LEGAL_TEXT.page.strong}>metadata only</strong> —
    titles, thumbnails, video IDs, publish times, duration, and channel info. We
    never store the video files themselves.
  </>,
  <>
    <strong className={LEGAL_TEXT.page.strong}>Watched</strong> is a simple
    yes/no marker for what you've already seen. It is not a viewing history or
    analytics feature — no progress percentages, watch counts, or archives.
  </>,
  <>
    We keep the <strong className={LEGAL_TEXT.page.strong}>latest 100</strong>{' '}
    Cached Uploads per Enabled Channel.
  </>,
  <>
    If you disable a channel, its Cached Uploads and Watched status are kept for{' '}
    <strong className={LEGAL_TEXT.page.strong}>30 days</strong>, then
    permanently deleted.
  </>,
  <>
    <strong className={LEGAL_TEXT.page.strong}>Disconnecting</strong> your
    YouTube account immediately deletes Followed Channels, Cached Uploads,
    Watched marks, notification and digest settings, and OAuth tokens. Nothing
    is kept for a later reconnect.
  </>,
  <>
    Your <strong className={LEGAL_TEXT.page.strong}>Shorts Daily Budget</strong>{' '}
    is tracked locally in your browser, not on our servers.
  </>,
  <>
    This YouTube metadata is{' '}
    <strong className={LEGAL_TEXT.page.strong}>not</strong> covered by
    MyOrganiser's Vault or end-to-end encryption — those apply elsewhere in the
    app. (Your YouTube sign-in tokens are still encrypted at rest.)
  </>,
];

export default function YouTubeDataPage() {
  return (
    <LegalPageLayout>
      <LegalPageHeader />
      <LegalPageHero
        title="How we store your YouTube data"
        illustration="youtube"
      />
      <LegalPageBody>
        <ul className="flex flex-col gap-3">
          {YOUTUBE_DATA_FACTS.map((body, index) => (
            <li key={index} className={FACT_ROW_CLASS}>
              <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
                {index + 1}
              </span>
              <span>{body}</span>
            </li>
          ))}
        </ul>
        <LegalPageActions>
          <Button asChild>
            <Link href="/dashboard/youtube">Back to YouTube</Link>
          </Button>
        </LegalPageActions>
      </LegalPageBody>
      <LegalPageFooter />
    </LegalPageLayout>
  );
}

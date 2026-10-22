import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import { LEGAL_NUMBER_BADGE, LEGAL_TEXT } from '../lib/legal-styles';
import { LegalPageLayout } from './LegalPageLayout';

const ROW =
  'flex items-start gap-3.5 rounded-[18px] border border-border bg-card px-[22px] py-[18px] text-base leading-[25px] text-foreground-secondary';

export default function YouTubeDataPage() {
  return (
    <LegalPageLayout>
      <LegalPageLayout.Header />
      <LegalPageLayout.Hero
        title="How we store your YouTube data"
        illustration="youtube"
      />
      <LegalPageLayout.Body>
        <ul className="flex flex-col gap-3">
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              1
            </span>
            <span>
              We store{' '}
              <strong className={LEGAL_TEXT.page.strong}>metadata only</strong>{' '}
              — titles, thumbnails, video IDs, publish times, duration, and
              channel info. We never store the video files themselves.
            </span>
          </li>
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              2
            </span>
            <span>
              <strong className={LEGAL_TEXT.page.strong}>Watched</strong> is a
              simple yes/no marker for what you've already seen. It is not a
              viewing history or analytics feature — no progress percentages,
              watch counts, or archives.
            </span>
          </li>
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              3
            </span>
            <span>
              We keep the{' '}
              <strong className={LEGAL_TEXT.page.strong}>latest 100</strong>{' '}
              Cached Uploads per Enabled Channel.
            </span>
          </li>
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              4
            </span>
            <span>
              If you disable a channel, its Cached Uploads and Watched status
              are kept for{' '}
              <strong className={LEGAL_TEXT.page.strong}>30 days</strong>, then
              permanently deleted.
            </span>
          </li>
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              5
            </span>
            <span>
              <strong className={LEGAL_TEXT.page.strong}>Disconnecting</strong>{' '}
              your YouTube account immediately deletes Followed Channels, Cached
              Uploads, Watched marks, notification and digest settings, and
              OAuth tokens. Nothing is kept for a later reconnect.
            </span>
          </li>
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              6
            </span>
            <span>
              Your{' '}
              <strong className={LEGAL_TEXT.page.strong}>
                Shorts Daily Budget
              </strong>{' '}
              is tracked locally in your browser, not on our servers.
            </span>
          </li>
          <li className={ROW}>
            <span aria-hidden="true" className={LEGAL_NUMBER_BADGE}>
              7
            </span>
            <span>
              This YouTube metadata is{' '}
              <strong className={LEGAL_TEXT.page.strong}>not</strong> covered by
              MyOrganiser's Vault or end-to-end encryption — those apply
              elsewhere in the app. (Your YouTube sign-in tokens are still
              encrypted at rest.)
            </span>
          </li>
        </ul>
        <LegalPageLayout.Actions>
          <Button asChild>
            <Link href="/dashboard/youtube">Back to YouTube</Link>
          </Button>
        </LegalPageLayout.Actions>
      </LegalPageLayout.Body>
      <LegalPageLayout.Footer />
    </LegalPageLayout>
  );
}

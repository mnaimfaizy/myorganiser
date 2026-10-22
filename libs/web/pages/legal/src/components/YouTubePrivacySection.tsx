import Link from 'next/link';
import {
  legalSectionTitle,
  type LegalVariant,
  PRIVACY_POLICY_SECTIONS,
} from '../lib/legal-sections';
import { LEGAL_TEXT } from '../lib/legal-styles';
import { LegalSection } from './LegalSection';

export interface YouTubePrivacySectionProps {
  /** Where the section renders: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Page variant only: the section number shown in its badge. */
  number?: string;
  /** Set to '_blank' inside the Sign up dialog so in-document links keep the form mounted. */
  linkTarget?: '_blank';
}

export function YouTubePrivacySection({
  variant = 'page',
  number,
  linkTarget,
}: YouTubePrivacySectionProps) {
  const text = LEGAL_TEXT[variant];

  return (
    <LegalSection
      id="youtube"
      title={legalSectionTitle(PRIVACY_POLICY_SECTIONS, 'youtube')}
      variant={variant}
      number={number}
    >
      <p className={text.paragraph}>
        MyOrganiser has an optional YouTube feature. It is a private feature run
        personally by the operator. It is available only to accounts the
        operator has enabled in MyOrganiser; without that, YouTube is not
        available to your account. It is not offered to the public.
      </p>
      <p className={text.paragraph}>
        The feature uses YouTube API Services. If your account has it and you
        connect your YouTube account through Google OAuth, MyOrganiser requests
        the <code className={text.code}>youtube.readonly</code> scope, which
        gives MyOrganiser read-only access to your YouTube subscriptions and the
        uploads of those channels — with no ability to write, delete, or modify
        anything on YouTube. Google&apos;s handling of your data is described in
        the{' '}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className={text.link}
        >
          Google Privacy Policy
        </a>
        .
      </p>
      <p className={text.paragraph}>
        <strong className={text.strong}>What we store:</strong> For the channels
        you follow we store the channel ID, title, and thumbnail. For their
        recent uploads we store the video ID, title, thumbnail, publish date,
        and duration, and which uploads you have marked as watched. We never
        store the video files themselves. This metadata is kept on our servers
        and is not part of the end-to-end encrypted Vault. Your YouTube OAuth
        tokens are encrypted at rest on our servers with AES-256-GCM.
      </p>
      <p className={text.paragraph}>
        <strong className={text.strong}>How we use and share it:</strong> We use
        this data only to show you new uploads from your channels inside
        MyOrganiser and, if you opt in, to email you a digest of them. We do not
        sell it, we do not use it for advertising, and we do not use it to train
        artificial intelligence or machine learning models. It is stored with
        our hosting provider, and a digest you opted in to is sent through our
        email delivery provider. It is not shared with anyone else, and no other
        MyOrganiser user can see it. MyOrganiser&apos;s use and transfer of
        information received from Google APIs adheres to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
          className={text.link}
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p className={text.paragraph}>
        <strong className={text.strong}>Revocation and deletion:</strong> You
        can end this connection at any time by disconnecting YouTube from the
        YouTube page in your dashboard, or by revoking MyOrganiser&apos;s access
        from your{' '}
        <a
          href="https://security.google.com/settings/security/permissions"
          target="_blank"
          rel="noopener noreferrer"
          className={text.link}
        >
          Google security settings
        </a>
        . Disconnecting revokes MyOrganiser&apos;s access at Google and
        immediately deletes your stored tokens, followed channels, cached
        uploads, watched marks, and notification and digest settings. If you
        revoke MyOrganiser&apos;s access at Google instead, MyOrganiser stops
        syncing and deletes the same data within seven days unless you
        reconnect. The operator may also withdraw the feature from an account;
        doing so deletes the same data as a disconnect, revoking
        MyOrganiser&apos;s access at Google and deleting your stored tokens,
        followed channels, cached uploads, watched marks, and notification and
        digest settings.
      </p>
      <p className={text.paragraph}>
        For detailed information about how long we keep your YouTube metadata
        and how to request deletion, see our{' '}
        <Link
          href="/youtube/data-privacy"
          target={linkTarget}
          rel={linkTarget ? 'noopener noreferrer' : undefined}
          className={text.link}
        >
          YouTube Data Privacy page
        </Link>
        .
      </p>
    </LegalSection>
  );
}

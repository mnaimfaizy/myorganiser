import type { ReactNode } from 'react';
import {
  legalSectionAccessors,
  type LegalVariant,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
  type PrivacyPolicySectionId,
} from '../lib/legal-sections';
import { LEGAL_TEXT } from '../lib/legal-styles';
import { LegalSection } from './LegalSection';
import { PrivacyAccountDeletionSection } from './PrivacyAccountDeletionSection';
import { PrivacyMobileAppSection } from './PrivacyMobileAppSection';
import { YouTubePrivacySection } from './YouTubePrivacySection';

export interface PrivacyPolicyContentProps {
  /** Where the policy renders: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Operator & Contact section, supplied by the host page or dialog. */
  operatorContact?: ReactNode;
  /** Set to '_blank' inside the Sign up dialog so in-document links keep the form mounted. */
  linkTarget?: '_blank';
  /** Page variant only: section number by anchor id, from legalPageSections. */
  sectionNumbers?: Partial<Record<PrivacyPolicySectionId, string>>;
}

export function PrivacyPolicyContent({
  variant = 'page',
  operatorContact,
  linkTarget,
  sectionNumbers,
}: PrivacyPolicyContentProps) {
  const text = LEGAL_TEXT[variant];
  const { title, numberOf } = legalSectionAccessors(
    PRIVACY_POLICY_SECTIONS,
    variant,
    sectionNumbers,
  );

  return (
    <>
      {variant === 'dialog' && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last updated: {PRIVACY_POLICY_LAST_UPDATED}
        </p>
      )}

      <LegalSection
        id="overview"
        title={title('overview')}
        variant={variant}
        number={numberOf('overview')}
      >
        <p className={text.paragraph}>
          MyOrganiser is a personal organizer that helps you manage tasks,
          addresses, contacts, grocery lists, and other personal information, on
          the web and in the MyOrganiser Mobile App. Your personal content is
          kept in a Vault that is end-to-end encrypted: it is encrypted on your
          device with a key only you can unlock, and our servers store only the
          encrypted version, which we cannot read. Your account data — such as
          your name and email address — is stored unencrypted, because we need
          it to operate your account.
        </p>
      </LegalSection>

      <PrivacyMobileAppSection
        variant={variant}
        number={numberOf('mobile-app')}
        linkTarget={linkTarget}
      />

      <YouTubePrivacySection
        variant={variant}
        number={numberOf('youtube')}
        linkTarget={linkTarget}
      />

      <LegalSection
        id="account-data"
        title={title('account-data')}
        variant={variant}
        number={numberOf('account-data')}
      >
        <p className={text.paragraph}>
          We collect and store the information you provide when creating and
          managing your account: your name, your email address, a hash of your
          password (never the password itself), and a User ID that identifies
          your account. We use this data only to sign you in and operate your
          account — not for advertising or tracking — and we do not sell or
          share it.
        </p>
      </LegalSection>

      <LegalSection
        id="cookies"
        title={title('cookies')}
        variant={variant}
        number={numberOf('cookies')}
      >
        <p className={text.paragraph}>
          MyOrganiser uses session cookies to keep you signed in. These cookies
          are secure, encrypted, and removed when you sign out or they expire.
          We do not use tracking cookies or third-party analytics cookies.
        </p>
      </LegalSection>

      <PrivacyAccountDeletionSection
        variant={variant}
        number={numberOf('deleting')}
      />

      <LegalSection
        id="rights"
        title={title('rights')}
        variant={variant}
        number={numberOf('rights')}
      >
        <p className={text.paragraph}>
          You have the right to access, update, and delete your account and
          associated data at any time. You can export your Vault data from the
          Vault page on the web, and delete your account as described above. To
          request a complete copy of your data, or for help deleting it, contact
          us using the information below.
        </p>
      </LegalSection>

      {operatorContact}

      <LegalSection
        id="changes"
        title={title('changes')}
        variant={variant}
        number={numberOf('changes')}
      >
        <p className={text.paragraph}>
          We may update this privacy policy from time to time. Any changes will
          be reflected on this page, and the last update date will be noted. We
          encourage you to review this policy periodically to stay informed
          about how we protect your privacy.
        </p>
      </LegalSection>
    </>
  );
}

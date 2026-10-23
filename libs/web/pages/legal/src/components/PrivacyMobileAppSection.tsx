import Link from 'next/link';
import {
  legalSectionTitle,
  type LegalVariant,
  PRIVACY_POLICY_SECTIONS,
} from '../lib/legal-sections';
import { LEGAL_TEXT } from '../lib/legal-styles';
import { LegalSection } from './LegalSection';

export interface PrivacyMobileAppSectionProps {
  /** Where the section renders: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Page variant only: the section number shown in its badge. */
  number?: string;
  /** As PrivacyPolicyContent's: '_blank' inside the Sign up dialog. */
  linkTarget?: '_blank';
}

/** The privacy policy's "The Mobile App" section. */
export function PrivacyMobileAppSection({
  variant = 'page',
  number,
  linkTarget,
}: PrivacyMobileAppSectionProps) {
  const text = LEGAL_TEXT[variant];

  return (
    <LegalSection
      id="mobile-app"
      title={legalSectionTitle(PRIVACY_POLICY_SECTIONS, 'mobile-app')}
      variant={variant}
      number={number}
    >
      <p className={text.paragraph}>
        The MyOrganiser Mobile App for Android is distributed as a download from
        our{' '}
        <Link
          href="/download"
          target={linkTarget}
          rel={linkTarget ? 'noopener noreferrer' : undefined}
          className={text.link}
        >
          download page
        </Link>
        , not through an app store. On iPhone and iPad there is no app to
        download: you add the MyOrganiser web app to your Home Screen instead,
        and this policy covers it as the web app.
      </p>
      <p className={text.paragraph}>
        The Mobile App uses the same account and the same encrypted Vault as the
        web app, and this policy applies to it in the same way. With each
        request it tells our servers its version number and whether it runs on
        Android or iOS, so we can tell when it needs updating. On your device it
        keeps your sign-in in the device&apos;s secure storage, the key for
        Biometric Unlock if you turn it on (protected by your fingerprint or
        face), and your display settings. The Mobile App contains no
        advertising, analytics, or tracking.
      </p>
    </LegalSection>
  );
}

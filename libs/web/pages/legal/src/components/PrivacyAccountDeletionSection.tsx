import {
  legalSectionTitle,
  type LegalVariant,
  PRIVACY_POLICY_SECTIONS,
} from '../lib/legal-sections';
import { LEGAL_TEXT } from '../lib/legal-styles';
import { LegalSection } from './LegalSection';

export interface PrivacyAccountDeletionSectionProps {
  /** Where the section renders: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Page variant only: the section number shown in its badge. */
  number?: string;
}

/** The privacy policy's "Deleting Your Account" section. */
export function PrivacyAccountDeletionSection({
  variant = 'page',
  number,
}: PrivacyAccountDeletionSectionProps) {
  const text = LEGAL_TEXT[variant];

  return (
    <LegalSection
      id="deleting"
      title={legalSectionTitle(PRIVACY_POLICY_SECTIONS, 'deleting')}
      variant={variant}
      number={number}
    >
      <p className={text.paragraph}>
        You can delete your account yourself, at any time: in the Mobile App
        under Account, and on the web on your Account page. Before deleting, you
        are offered an Escape Copy — a download of your encrypted Vault that you
        keep. You then confirm with your password and by typing DELETE.
      </p>
      <p className={text.paragraph}>
        Deletion is immediate and cannot be undone. It removes your account,
        your encrypted Vault, and all your YouTube data from our servers, ends
        your YouTube connection, and signs you out everywhere. We send a
        confirmation to your email address. Our security logs keep a record that
        administrative actions took place, with your account removed from them.
        The Mobile App also removes your sign-in and Biometric Unlock key from
        the device. An Escape Copy you downloaded, or an encrypted copy of your
        Vault kept in your web browser, stays on your own devices and is yours
        to delete.
      </p>
    </LegalSection>
  );
}

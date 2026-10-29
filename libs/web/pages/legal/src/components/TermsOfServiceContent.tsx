import type { ReactNode } from 'react';
import {
  legalSectionAccessors,
  type LegalVariant,
  TERMS_OF_SERVICE_LAST_UPDATED,
  TERMS_OF_SERVICE_SECTIONS,
  type TermsOfServiceSectionId,
} from '../lib/legal-sections';
import { LEGAL_TEXT } from '../lib/legal-styles';
import { LegalSection } from './LegalSection';

export interface TermsOfServiceContentProps {
  /** Where the terms render: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Operator & Contact section, supplied by the host page or dialog. */
  operatorContact?: ReactNode;
  /** Page variant only: section number by anchor id, from legalPageSections. */
  sectionNumbers?: Partial<Record<TermsOfServiceSectionId, string>>;
}

export function TermsOfServiceContent({
  variant = 'page',
  operatorContact,
  sectionNumbers,
}: TermsOfServiceContentProps) {
  const text = LEGAL_TEXT[variant];
  const { title, numberOf } = legalSectionAccessors(
    TERMS_OF_SERVICE_SECTIONS,
    variant,
    sectionNumbers,
  );
  // The dialog stacks its sections with space-y-4 rather than per-paragraph margins.
  const dialogStack = variant === 'dialog' ? 'space-y-4' : undefined;

  return (
    <>
      {variant === 'dialog' && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last updated: {TERMS_OF_SERVICE_LAST_UPDATED}
        </p>
      )}
      <LegalSection
        id="acceptance"
        title={title('acceptance')}
        variant={variant}
        number={numberOf('acceptance')}
        className={dialogStack}
      >
        <p className={text.paragraph}>
          By using MyOrganiser, you agree to these Terms. If you do not agree,
          you may not use the service.
        </p>
      </LegalSection>

      <LegalSection
        id="description"
        title={title('description')}
        variant={variant}
        number={numberOf('description')}
        className={dialogStack}
      >
        <p className={text.paragraph}>
          MyOrganiser is a personal organizer application that helps you manage
          and store personal information, including tasks, addresses, contacts,
          grocery lists, and similar items. The service is built around an
          end-to-end encrypted Vault that stores your data securely. The server
          stores only the encrypted version of your data (ciphertext) and never
          has access to the unencrypted contents.
        </p>
        <p className={text.paragraph}>
          MyOrganiser has an optional YouTube feature, which is available only
          to accounts the operator has enabled. It uses YouTube API Services and
          is read-only: it retrieves and displays your subscriptions and their
          uploads. By using it you agree to be bound by the{' '}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className={text.link}
          >
            YouTube Terms of Service <span aria-hidden="true">↗</span>
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection
        id="accounts"
        title={title('accounts')}
        variant={variant}
        number={numberOf('accounts')}
        className={dialogStack}
      >
        <p className={text.paragraph}>
          You are responsible for maintaining the confidentiality of your
          account credentials and for all activity that occurs under your
          account. You must keep your Vault passphrase and recovery material
          safe and secure.
        </p>
        <p className={text.paragraph}>
          You acknowledge that the server never stores your encryption key or
          the plaintext contents of your Vault. If you lose your passphrase or
          recovery material, MyOrganiser cannot recover your encrypted data, as
          recovery is technically impossible without these credentials.
        </p>
      </LegalSection>

      <LegalSection
        id="acceptable-use"
        title={title('acceptable-use')}
        variant={variant}
        number={numberOf('acceptable-use')}
        className={dialogStack}
      >
        <p className={text.paragraph}>You agree not to:</p>
        <ul className={text.list}>
          <li>Use the service for any unlawful purpose or activity</li>
          <li>
            Attempt to breach, compromise, or bypass the security of the service
          </li>
          <li>
            Attempt to gain unauthorized access to the service or its servers
          </li>
          <li>
            Misuse connected third-party integrations beyond their intended
            read-only purpose
          </li>
          <li>
            Reverse-engineer, decompile, or otherwise attempt to circumvent the
            service&apos;s technical protections
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="availability"
        title={title('availability')}
        variant={variant}
        number={numberOf('availability')}
        className={dialogStack}
      >
        <p className={text.paragraph}>
          MyOrganiser is provided on an &quot;as is&quot; basis without any
          warranty of uninterrupted availability. We do not guarantee that the
          service will be available at all times, and we may perform maintenance
          or updates that temporarily affect availability. Features,
          functionality, and data structures may change at any time.
        </p>
      </LegalSection>

      <LegalSection
        id="liability"
        title={title('liability')}
        variant={variant}
        number={numberOf('liability')}
        className={dialogStack}
      >
        <p className={text.paragraph}>
          To the fullest extent permitted by law, MyOrganiser and its operators
          shall not be liable for any indirect, incidental, special,
          consequential, or punitive damages, including without limitation
          damages for loss of data, loss of profits, or interruption of service,
          arising out of or in connection with your use of the service, even if
          we have been advised of the possibility of such damages.
        </p>
      </LegalSection>

      <LegalSection
        id="changes"
        title={title('changes')}
        variant={variant}
        number={numberOf('changes')}
        className={dialogStack}
      >
        <p className={text.paragraph}>
          We may update these Terms of Service at any time. Changes will be
          reflected on this page. Your continued use of the service following
          any changes constitutes your acceptance of the updated terms.
        </p>
      </LegalSection>

      {operatorContact}
    </>
  );
}

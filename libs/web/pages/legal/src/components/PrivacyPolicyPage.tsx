import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import {
  numberLegalSections,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
} from '../lib/legal-sections';
import { LegalPageLayout } from './LegalPageLayout';
import { OperatorContact } from './OperatorContact';
import { PrivacyPolicyContent } from './PrivacyPolicyContent';

export default function PrivacyPolicyPage() {
  const hasOperator = Boolean(
    process.env.OPERATOR_NAME?.trim() ||
    process.env.OPERATOR_CONTACT_EMAIL?.trim(),
  );
  const sections = numberLegalSections(PRIVACY_POLICY_SECTIONS, {
    hasOperator,
  });
  const sectionNumbers = Object.fromEntries(
    sections.map((section) => [section.id, section.number]),
  );

  return (
    <LegalPageLayout>
      <LegalPageLayout.Header current="privacy" />
      <LegalPageLayout.Hero
        title="Privacy Policy"
        illustration="vault"
        lastUpdated={PRIVACY_POLICY_LAST_UPDATED}
      />
      <LegalPageLayout.Body toc={sections}>
        <PrivacyPolicyContent
          operatorContact={
            <OperatorContact variant="page" number={sectionNumbers.contact} />
          }
          sectionNumbers={sectionNumbers}
        />
        <LegalPageLayout.Actions>
          <Button asChild variant="outline">
            <Link href="/">Back to Home</Link>
          </Button>
          <Button asChild>
            <Link href="/terms">Terms of Service</Link>
          </Button>
        </LegalPageLayout.Actions>
      </LegalPageLayout.Body>
      <LegalPageLayout.Footer />
    </LegalPageLayout>
  );
}

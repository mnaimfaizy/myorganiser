import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import {
  numberLegalSections,
  TERMS_OF_SERVICE_SECTIONS,
} from '../lib/legal-sections';
import { LegalPageLayout } from './LegalPageLayout';
import { OperatorContact } from './OperatorContact';
import { TermsOfServiceContent } from './TermsOfServiceContent';

export default function TermsOfServicePage() {
  const hasOperator = Boolean(
    process.env.OPERATOR_NAME?.trim() ||
    process.env.OPERATOR_CONTACT_EMAIL?.trim(),
  );
  const sections = numberLegalSections(TERMS_OF_SERVICE_SECTIONS, {
    hasOperator,
  });
  const sectionNumbers = Object.fromEntries(
    sections.map((section) => [section.id, section.number]),
  );

  return (
    <LegalPageLayout>
      <LegalPageLayout.Header current="terms" />
      <LegalPageLayout.Hero title="Terms of Service" illustration="tasks" />
      <LegalPageLayout.Body toc={sections}>
        <TermsOfServiceContent
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
            <Link href="/privacy">Privacy Policy</Link>
          </Button>
        </LegalPageLayout.Actions>
      </LegalPageLayout.Body>
      <LegalPageLayout.Footer />
    </LegalPageLayout>
  );
}

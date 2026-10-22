import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import { TERMS_OF_SERVICE_SECTIONS } from '../lib/legal-sections';
import { LegalPageActions } from './LegalPageActions';
import { LegalPageBody } from './LegalPageBody';
import { LegalPageFooter } from './LegalPageFooter';
import { LegalPageHeader } from './LegalPageHeader';
import { LegalPageHero } from './LegalPageHero';
import { LegalPageLayout } from './LegalPageLayout';
import { legalPageSections, OperatorContact } from './OperatorContact';
import { TermsOfServiceContent } from './TermsOfServiceContent';

export default function TermsOfServicePage() {
  const { toc, sectionNumbers } = legalPageSections(TERMS_OF_SERVICE_SECTIONS);

  return (
    <LegalPageLayout>
      <LegalPageHeader current="terms" />
      <LegalPageHero title="Terms of Service" illustration="tasks" />
      <LegalPageBody toc={toc}>
        <TermsOfServiceContent
          operatorContact={
            <OperatorContact variant="page" number={sectionNumbers.contact} />
          }
          sectionNumbers={sectionNumbers}
        />
        <LegalPageActions>
          <Button asChild variant="outline">
            <Link href="/">Back to Home</Link>
          </Button>
          <Button asChild>
            <Link href="/privacy">Privacy Policy</Link>
          </Button>
        </LegalPageActions>
      </LegalPageBody>
      <LegalPageFooter />
    </LegalPageLayout>
  );
}

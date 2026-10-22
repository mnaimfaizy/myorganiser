import { Button } from '@myorganiser/web-ui';
import Link from 'next/link';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
} from '../lib/legal-sections';
import { LegalPageActions } from './LegalPageActions';
import { LegalPageBody } from './LegalPageBody';
import { LegalPageFooter } from './LegalPageFooter';
import { LegalPageHeader } from './LegalPageHeader';
import { LegalPageHero } from './LegalPageHero';
import { LegalPageLayout } from './LegalPageLayout';
import { legalPageSections, OperatorContact } from './OperatorContact';
import { PrivacyPolicyContent } from './PrivacyPolicyContent';

export default function PrivacyPolicyPage() {
  const { toc, sectionNumbers } = legalPageSections(PRIVACY_POLICY_SECTIONS);

  return (
    <LegalPageLayout>
      <LegalPageHeader current="privacy" />
      <LegalPageHero
        title="Privacy Policy"
        illustration="vault"
        lastUpdated={PRIVACY_POLICY_LAST_UPDATED}
      />
      <LegalPageBody toc={toc}>
        <PrivacyPolicyContent
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
            <Link href="/terms">Terms of Service</Link>
          </Button>
        </LegalPageActions>
      </LegalPageBody>
      <LegalPageFooter />
    </LegalPageLayout>
  );
}

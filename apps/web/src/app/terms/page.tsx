import { TermsOfServicePage } from '@myorganiser/web-pages/legal';

export const metadata = {
  title: 'Terms of Service',
  alternates: { canonical: '/terms' },
};

export default function Page() {
  return <TermsOfServicePage />;
}

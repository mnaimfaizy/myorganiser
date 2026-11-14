import { LegalOperatorProvider } from '@myorganiser/web-pages/legal';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up - MyOrganiser',
  description: 'Create your MyOrganiser account',
  alternates: { canonical: '/signup' },
};

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LegalOperatorProvider
      name={process.env.OPERATOR_NAME}
      email={process.env.OPERATOR_CONTACT_EMAIL}
    >
      {children}
    </LegalOperatorProvider>
  );
}

import type { Metadata } from 'next';

// The page is a Client Component, so its metadata lives here.
export const metadata: Metadata = {
  title: 'Forgot Password',
  robots: { index: false, follow: true },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

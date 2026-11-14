import type { Metadata } from 'next';

// The page is a Client Component, so its metadata lives here. The canonical
// drops query strings such as `?redirect=` so every variant counts as /login.
export const metadata: Metadata = {
  title: 'Log In',
  alternates: { canonical: '/login' },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

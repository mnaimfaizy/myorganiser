import type { Metadata } from 'next';

// Token links from emails: one-off pages with nothing to index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ResetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

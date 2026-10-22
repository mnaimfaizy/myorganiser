import type { ReactNode } from 'react';

export interface LegalPageLayoutProps {
  children: ReactNode;
}

/**
 * Shell shared by the standalone legal pages. The page arranges its parts from
 * LegalPageHeader, LegalPageHero, LegalPageBody and LegalPageFooter.
 */
export function LegalPageLayout({ children }: LegalPageLayoutProps) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';

export interface LegalPageActionsProps {
  children: ReactNode;
}

/** Row of buttons at the foot of the body. */
export function LegalPageActions({ children }: LegalPageActionsProps) {
  return <div className="flex flex-wrap gap-2.5 pt-2">{children}</div>;
}

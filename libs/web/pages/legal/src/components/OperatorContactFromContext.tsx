'use client';

import type { LegalVariant } from '../lib/legal-sections';
import { useLegalOperator } from '../lib/legal-operator-context';
import { OperatorContactView } from './OperatorContactView';

export interface OperatorContactFromContextProps {
  /** Where the section renders: the Sign up legal dialog passes 'dialog'. */
  variant?: LegalVariant;
  /** Page variant only: the section number shown in its badge. */
  number?: string;
}

/** Client-side Operator & Contact section, fed by LegalOperatorProvider. */
export function OperatorContactFromContext({
  variant,
  number,
}: OperatorContactFromContextProps) {
  const operator = useLegalOperator();

  if (!operator) return null;

  return (
    <OperatorContactView
      name={operator.name}
      email={operator.email}
      variant={variant}
      number={number}
    />
  );
}

import type { LegalVariant } from '../lib/legal-sections';
import { OperatorContactView } from './OperatorContactView';

export interface OperatorContactProps {
  /** Where the section renders: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Page variant only: the section number shown in its badge. */
  number?: string;
}

/**
 * Server-side Operator & Contact section for the standalone legal pages. Reads
 * the operator env vars; the dialog gets the same values via LegalOperatorProvider.
 */
export function OperatorContact({ variant, number }: OperatorContactProps) {
  return (
    <OperatorContactView
      name={process.env.OPERATOR_NAME}
      email={process.env.OPERATOR_CONTACT_EMAIL}
      variant={variant}
      number={number}
    />
  );
}

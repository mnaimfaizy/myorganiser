import { LegalSection } from './LegalSection';
import {
  OPERATOR_CONTACT_TITLE,
  type LegalVariant,
} from '../lib/legal-sections';
import { LEGAL_TEXT } from '../lib/legal-styles';

export interface OperatorContactViewProps {
  /** Operator name. Blank or missing values are omitted. */
  name?: string | null;
  /** Operator contact email. Blank or missing values are omitted. */
  email?: string | null;
  /** Where the section renders: the standalone page (default) or the dialog. */
  variant?: LegalVariant;
  /** Page variant only: the section number shown in its badge. */
  number?: string;
}

/** Pure presentation of the Operator & Contact section. Reads no environment. */
export function OperatorContactView({
  name,
  email,
  variant = 'page',
  number,
}: OperatorContactViewProps) {
  const trimmedName = name?.trim();
  const trimmedEmail = email?.trim();

  // If neither is set, render nothing
  if (!trimmedName && !trimmedEmail) {
    return null;
  }

  if (variant === 'page') {
    return (
      <LegalSection
        id="contact"
        title={OPERATOR_CONTACT_TITLE}
        variant="page"
        number={number}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1.5 text-base leading-[26px] text-foreground-secondary">
          {trimmedName && (
            <>
              <dt className="font-bold text-foreground">Operator:</dt>
              <dd className="m-0">{trimmedName}</dd>
            </>
          )}
          {trimmedEmail && (
            <>
              <dt className="font-bold text-foreground">Contact:</dt>
              <dd className="m-0">
                <a
                  href={`mailto:${trimmedEmail}`}
                  className={LEGAL_TEXT.page.link}
                >
                  {trimmedEmail}
                </a>
              </dd>
            </>
          )}
        </dl>
      </LegalSection>
    );
  }

  return (
    <LegalSection id="contact" title={OPERATOR_CONTACT_TITLE} variant="dialog">
      {trimmedName && (
        <p className="mt-3 text-sm text-muted-foreground">
          <strong>Operator:</strong> {trimmedName}
        </p>
      )}
      {trimmedEmail && (
        <p
          className={
            trimmedName
              ? 'mt-2 text-sm text-muted-foreground'
              : 'mt-3 text-sm text-muted-foreground'
          }
        >
          <strong>Contact:</strong>{' '}
          <a href={`mailto:${trimmedEmail}`} className={LEGAL_TEXT.dialog.link}>
            {trimmedEmail}
          </a>
        </p>
      )}
    </LegalSection>
  );
}

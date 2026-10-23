/**
 * Where a legal document renders. `page` is the standalone /privacy, /terms and
 * /youtube/data-privacy pages; `dialog` is the Sign up dialog.
 */
export type LegalVariant = 'page' | 'dialog';

/** Which legal document a page, nav link or dialog trigger refers to. */
export type LegalDocumentKind = 'terms' | 'privacy';

export interface LegalSectionEntry<Id extends string = string> {
  id: Id;
  title: string;
}

/** Heading shared by both documents' operator section. */
export const OPERATOR_CONTACT_TITLE = 'Operator & Contact';

/** The single source for the Privacy Policy anchors, TOC labels and headings. */
export const PRIVACY_POLICY_SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'mobile-app', title: 'The Mobile App' },
  { id: 'youtube', title: 'YouTube Integration' },
  { id: 'account-data', title: 'Account Data' },
  { id: 'cookies', title: 'Cookies & Sessions' },
  { id: 'deleting', title: 'Deleting Your Account' },
  { id: 'rights', title: 'Your Rights' },
  { id: 'contact', title: OPERATOR_CONTACT_TITLE },
  { id: 'changes', title: 'Policy Changes' },
] as const satisfies readonly LegalSectionEntry[];

/** The single source for the Terms of Service anchors, TOC labels and headings. */
export const TERMS_OF_SERVICE_SECTIONS = [
  { id: 'acceptance', title: 'Acceptance of Terms' },
  { id: 'description', title: 'Description of Service' },
  { id: 'accounts', title: 'Accounts and User Responsibilities' },
  { id: 'acceptable-use', title: 'Acceptable Use' },
  { id: 'availability', title: 'Service Availability' },
  { id: 'liability', title: 'Limitation of Liability' },
  { id: 'changes', title: 'Changes to These Terms' },
  { id: 'contact', title: OPERATOR_CONTACT_TITLE },
] as const satisfies readonly LegalSectionEntry[];

export type PrivacyPolicySectionId =
  (typeof PRIVACY_POLICY_SECTIONS)[number]['id'];

export type TermsOfServiceSectionId =
  (typeof TERMS_OF_SERVICE_SECTIONS)[number]['id'];

/**
 * True when the operator has a name or a contact email. A blank or whitespace-only
 * value counts as absent. The Operator & Contact section renders only when this holds.
 */
export function hasOperatorContact(
  name: string | null | undefined,
  email: string | null | undefined,
): boolean {
  return Boolean(name?.trim() || email?.trim());
}

/**
 * Drops `contact` when there is no operator, then numbers the rest '01', '02',
 * … in order, so the printed numbers never skip over a missing section.
 */
export function numberLegalSections<Id extends string>(
  sections: readonly LegalSectionEntry<Id>[],
  options: { hasOperator: boolean },
): ReadonlyArray<LegalSectionEntry<Id> & { number: string }> {
  const kept = options.hasOperator
    ? sections
    : sections.filter((section) => section.id !== 'contact');
  return kept.map((section, index) => ({
    ...section,
    number: String(index + 1).padStart(2, '0'),
  }));
}

/** The heading of the section with this id. Throws on an unknown id. */
export function legalSectionTitle<Id extends string>(
  sections: readonly LegalSectionEntry<Id>[],
  id: Id,
): string {
  const entry = sections.find((section) => section.id === id);
  if (!entry) {
    throw new Error(`Unknown legal section "${id}".`);
  }
  return entry.title;
}

/**
 * The title and page-variant number accessors a document body uses for its
 * sections. The dialog variant never shows a number.
 */
export function legalSectionAccessors<Id extends string>(
  sections: readonly LegalSectionEntry<Id>[],
  variant: LegalVariant,
  sectionNumbers: Partial<Record<Id, string>> | undefined,
) {
  return {
    title: (id: Id): string => legalSectionTitle(sections, id),
    numberOf: (id: Id): string | undefined =>
      variant === 'page' ? sectionNumbers?.[id] : undefined,
  };
}

/** When this policy last changed. Update it with every change to the wording. */
export const PRIVACY_POLICY_LAST_UPDATED = '15 October 2026';

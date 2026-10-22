/**
 * Where a legal document renders. `page` is the standalone /privacy, /terms and
 * /youtube/data-privacy pages; `dialog` is the Sign up dialog.
 */
export type LegalVariant = 'page' | 'dialog';

export interface LegalSectionEntry {
  id: string;
  title: string;
}

/** Heading shared by both documents' operator section. */
export const OPERATOR_CONTACT_TITLE = 'Operator & Contact';

/** The single source for the Privacy Policy anchors, TOC labels and headings. */
export const PRIVACY_POLICY_SECTIONS: readonly LegalSectionEntry[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'mobile-app', title: 'The Mobile App' },
  { id: 'youtube', title: 'YouTube Integration' },
  { id: 'account-data', title: 'Account Data' },
  { id: 'cookies', title: 'Cookies & Sessions' },
  { id: 'deleting', title: 'Deleting Your Account' },
  { id: 'rights', title: 'Your Rights' },
  { id: 'contact', title: OPERATOR_CONTACT_TITLE },
  { id: 'changes', title: 'Policy Changes' },
];

/** The single source for the Terms of Service anchors, TOC labels and headings. */
export const TERMS_OF_SERVICE_SECTIONS: readonly LegalSectionEntry[] = [
  { id: 'acceptance', title: 'Acceptance of Terms' },
  { id: 'description', title: 'Description of Service' },
  { id: 'accounts', title: 'Accounts and User Responsibilities' },
  { id: 'acceptable-use', title: 'Acceptable Use' },
  { id: 'availability', title: 'Service Availability' },
  { id: 'liability', title: 'Limitation of Liability' },
  { id: 'changes', title: 'Changes to These Terms' },
  { id: 'contact', title: OPERATOR_CONTACT_TITLE },
];

/**
 * Drops `contact` when there is no operator, then numbers the rest '01', '02',
 * … in order, so the printed numbers never skip over a missing section.
 */
export function numberLegalSections(
  sections: readonly LegalSectionEntry[],
  options: { hasOperator: boolean },
): ReadonlyArray<LegalSectionEntry & { number: string }> {
  const kept = options.hasOperator
    ? sections
    : sections.filter((section) => section.id !== 'contact');
  return kept.map((section, index) => ({
    ...section,
    number: String(index + 1).padStart(2, '0'),
  }));
}

/** The heading of the section with this id. Throws on an unknown id. */
export function legalSectionTitle(
  sections: readonly LegalSectionEntry[],
  id: string,
): string {
  const entry = sections.find((section) => section.id === id);
  if (!entry) {
    throw new Error(`Unknown legal section "${id}".`);
  }
  return entry.title;
}

/** When this policy last changed. Update it with every change to the wording. */
export const PRIVACY_POLICY_LAST_UPDATED = '15 October 2026';

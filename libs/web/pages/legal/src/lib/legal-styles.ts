import type { LegalVariant } from './legal-sections';

export interface LegalTextClasses {
  paragraph: string;
  strong?: string;
  link: string;
  code: string;
  list: string;
}

/**
 * Text classes for legal copy, by where it renders. The page entries use the
 * named type scale whole. The dialog entries keep the classes the Sign up dialog
 * has always used.
 */
export const LEGAL_TEXT = {
  page: {
    paragraph: 'text-body text-foreground-secondary',
    strong: 'font-bold text-foreground',
    link: 'font-semibold text-brand-text underline underline-offset-[3px] hover:text-brand-text-strong',
    code: 'rounded-md bg-subtle px-1.5 font-mono text-body-sm text-foreground',
    list: 'list-disc space-y-2 pl-5 text-body text-foreground-secondary',
  },
  dialog: {
    paragraph: 'mt-3 text-sm text-muted-foreground',
    strong: undefined,
    link: 'font-medium underline hover:text-foreground',
    code: 'rounded bg-muted px-1 py-0.5 font-mono text-xs',
    list: 'ml-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground',
  },
} as const satisfies Record<LegalVariant, LegalTextClasses>;

/** The numbered badge on a page-variant section card and on a YouTube data row. */
export const LEGAL_NUMBER_BADGE =
  'flex h-8 min-w-8 shrink-0 items-center justify-center rounded-control-sm bg-brand-soft px-1.5 text-caption font-bold text-brand-text';

/**
 * Width of the artboard content column, shared by the hero, body and footer. No
 * design token exists for it, so the value is defined here once.
 */
export const LEGAL_CONTENT_WIDTH = 'mx-auto w-full max-w-[1040px]';

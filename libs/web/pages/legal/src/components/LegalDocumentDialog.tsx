'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  cn,
} from '@myorganiser/web-ui';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useState,
} from 'react';
import type { LegalDocumentKind, LegalVariant } from '../lib/legal-sections';
import { OperatorContactFromContext } from './OperatorContactFromContext';
import { PrivacyPolicyContent } from './PrivacyPolicyContent';
import { TermsOfServiceContent } from './TermsOfServiceContent';

interface LegalDocumentBodyProps {
  variant: LegalVariant;
  operatorContact?: ReactNode;
  linkTarget?: '_blank';
}

const LEGAL_DOCUMENTS = {
  terms: {
    title: 'Terms of Service',
    Body: TermsOfServiceContent,
  },
  privacy: {
    title: 'Privacy Policy',
    Body: PrivacyPolicyContent,
  },
} as const satisfies Record<
  LegalDocumentKind,
  { title: string; Body: ComponentType<LegalDocumentBodyProps> }
>;

export interface LegalDocumentDialogProps {
  /** Which legal document the trigger opens. */
  kind: LegalDocumentKind;
  /** Trigger label, e.g. "Terms". */
  children: ReactNode;
  /** Extra classes for the trigger, on top of the AuthTextLink look. */
  className?: string;
}

/**
 * Link-styled button that opens a legal document in a dialog over the current
 * page, so a form beneath it stays mounted and keeps its values.
 */
export function LegalDocumentDialog({
  kind,
  children,
  className,
}: LegalDocumentDialogProps) {
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const { title, Body } = LEGAL_DOCUMENTS[kind];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'cursor-pointer font-medium text-primary underline-offset-2 hover:underline',
            className,
          )}
        >
          {children}
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pr-12 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Full text of the MyOrganiser {title}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          <Body
            variant="dialog"
            operatorContact={<OperatorContactFromContext variant="dialog" />}
            linkTarget="_blank"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

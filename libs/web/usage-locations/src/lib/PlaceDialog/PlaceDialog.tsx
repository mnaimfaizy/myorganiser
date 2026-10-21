'use client';

import type { UsageLocationRecord } from '@myorganiser/vault-core';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Form,
  Illustration,
  type IllustrationKind,
} from '@myorganiser/web-ui';
import { X } from 'lucide-react';

import type { PlaceFormValues } from '../placeForm';
import { usePlaceForm } from '../usePlaceForm';
import { PlaceDialogLinkFields } from './PlaceDialogLinkFields';
import { PlaceDialogOrganisationFields } from './PlaceDialogOrganisationFields';
import { PlaceDialogUpdateFields } from './PlaceDialogUpdateFields';

export type PlaceNoun = 'address' | 'number';

/** The page-specific illustration for each noun. */
const NOUN_ILLUSTRATION = {
  address: 'addresses',
  number: 'mobile',
} as const satisfies Record<PlaceNoun, IllustrationKind>;

export interface PlaceDialogProps {
  open: boolean;
  /** null means add; a record means edit with that record loaded. */
  location: UsageLocationRecord | null;
  /** Every place already on this address or number, for duplicate detection. */
  existingLocations: UsageLocationRecord[];
  /** Whose places these are, for example "Home" or "Personal (+61 412 345 678)". */
  subject: string;
  /** The page's word for the thing the places hang off. */
  noun: PlaceNoun;
  onOpenChange: (open: boolean) => void;
  /** Resolves when saved. Rejecting keeps the dialog open for a retry. */
  onSubmit: (
    values: PlaceFormValues,
    editingId: string | null,
  ) => Promise<void>;
}

export function PlaceDialog({
  open,
  location,
  existingLocations,
  subject,
  noun,
  onOpenChange,
  onSubmit,
}: PlaceDialogProps) {
  const place = usePlaceForm({
    open,
    location,
    existingLocations,
    onOpenChange,
    onSubmit,
  });
  const { form, editingId, isSaving, orgName, duplicateLocation } = place;

  // Editing keeps "Save changes": the warning still shows, but "Add anyway"
  // would describe an add the User is not making.
  const submitLabel = editingId
    ? 'Save changes'
    : duplicateLocation
      ? 'Add anyway'
      : 'Add place';

  return (
    <Dialog open={open} onOpenChange={place.handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-150 gap-0 p-0">
        <Form {...form}>
          <form onSubmit={place.handleSubmit} className="flex flex-col">
            <div className="flex items-start gap-3.5 border-b border-border px-6 pb-4 pt-6">
              <Illustration kind={NOUN_ILLUSTRATION[noun]} size={48} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <DialogTitle className="font-display text-title">
                  {editingId ? 'Edit place' : 'Add place'}
                </DialogTitle>
                <DialogDescription className="text-body-sm text-foreground-supporting">
                  {`Who needs to know about ${subject}?`}
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  disabled={isSaving}
                >
                  <X />
                </Button>
              </DialogClose>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <PlaceDialogOrganisationFields
                control={form.control}
                orgName={orgName}
                isDuplicate={duplicateLocation !== null}
                noun={noun}
                onOrgNameChange={place.handleOrgNameChange}
                onOrgTypeChange={place.handleOrgTypeChange}
              />

              <PlaceDialogUpdateFields
                control={form.control}
                onUpdateMethodChange={place.handleUpdateMethodChange}
                onPriorityChange={place.handlePriorityChange}
              />

              <PlaceDialogLinkFields
                control={form.control}
                onLinkChange={place.handleLinkChange}
                onChangedChange={place.handleChangedChange}
              />
            </div>

            <DialogFooter className="border-t border-border px-6 pb-6 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={place.handleCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={isSaving}
                disabled={!form.formState.isValid}
              >
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

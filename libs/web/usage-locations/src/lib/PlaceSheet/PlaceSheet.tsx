'use client';

import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetTitle,
  Button,
  Form,
} from '@myorganiser/web-ui';

import type { PlaceDialogProps } from '../PlaceDialog/PlaceDialog';
import { usePlaceForm } from '../usePlaceForm';
import { PlaceSheetFields } from './PlaceSheetFields';

/** The phone sheet takes the same props as the desktop PlaceDialog. */
export type PlaceSheetProps = PlaceDialogProps;

/**
 * The add/edit place form as a phone bottom sheet (UsageLocationPhone
 * artboard). The duplicate warning carries the "already here" meaning, so the
 * submit stays a short "Add" or "Save".
 */
export function PlaceSheet({
  open,
  location,
  existingLocations,
  subject,
  noun,
  onOpenChange,
  onSubmit,
}: PlaceSheetProps) {
  const place = usePlaceForm({
    open,
    location,
    existingLocations,
    onOpenChange,
    onSubmit,
  });
  const { editingId, isSaving, form } = place;

  return (
    <BottomSheet open={open} onOpenChange={place.handleOpenChange}>
      <BottomSheetContent className="h-[calc(100dvh_-_2.5rem)] max-h-[calc(100dvh_-_2.5rem)] gap-0 overflow-hidden px-0">
        <Form {...form}>
          <form
            noValidate
            onSubmit={place.handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center px-2">
              <Button
                type="button"
                variant="ghost"
                onClick={place.handleCancel}
                disabled={isSaving}
                className="h-11 justify-self-start px-2"
              >
                Cancel
              </Button>
              <BottomSheetTitle className="text-center text-body font-semibold">
                {editingId ? 'Edit place' : 'Add place'}
              </BottomSheetTitle>
              <Button
                type="submit"
                variant="link"
                loading={isSaving}
                disabled={!form.formState.isValid}
                className="h-11 justify-self-end px-2 font-bold"
              >
                {editingId ? 'Save' : 'Add'}
              </Button>
            </div>
            <BottomSheetDescription className="sr-only">
              {`Who needs to know about ${subject}?`}
            </BottomSheetDescription>
            <PlaceSheetFields place={place} noun={noun} />
          </form>
        </Form>
      </BottomSheetContent>
    </BottomSheet>
  );
}

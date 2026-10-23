'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { UsageLocationRecord } from '@myorganiser/vault-core';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type UseFormReturn, useForm } from 'react-hook-form';

import { isOrganisationType } from './labels';
import {
  normalizeOrganisationName,
  PLACE_FORM_DEFAULTS,
  placeFormSchema,
  type PlaceFormValues,
  usageLocationRecordToFormValues,
} from './placeForm';

export interface UsePlaceFormOptions {
  open: boolean;
  /** null means add; a record means edit with that record loaded. */
  location: UsageLocationRecord | null;
  /** Every place already on this address or number, for duplicate detection. */
  existingLocations: UsageLocationRecord[];
  onOpenChange: (open: boolean) => void;
  /** Resolves when saved. Rejecting keeps the form open for a retry. */
  onSubmit: (
    values: PlaceFormValues,
    editingId: string | null,
  ) => Promise<void>;
}

/** What usePlaceForm gives each surface. */
export interface UsePlaceFormResult {
  form: UseFormReturn<PlaceFormValues>;
  /** The record being edited, or null when adding. */
  editingId: string | null;
  isSaving: boolean;
  /** The current organisation name as typed. */
  orgName: string;
  /** The other place already holding this name, or null. */
  duplicateLocation: UsageLocationRecord | null;
  /** Validates, then saves through onSubmit and closes on success. */
  handleSubmit: ReturnType<UseFormReturn<PlaceFormValues>['handleSubmit']>;
  handleOpenChange: (open: boolean) => void;
  handleCancel: () => void;
  handleOrgNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleOrgTypeChange: (value: string) => void;
  handleUpdateMethodChange: (value: PlaceFormValues['updateMethod']) => void;
  handlePriorityChange: (value: PlaceFormValues['priority']) => void;
  handleLinkChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleChangedChange: (checked: boolean | 'indeterminate') => void;
}

/**
 * The add/edit place form, shared by the desktop PlaceDialog and the phone
 * PlaceSheet. It owns the React Hook Form state, the duplicate check and the
 * save; each surface owns only its layout and its submit label.
 */
export function usePlaceForm({
  open,
  location,
  existingLocations,
  onOpenChange,
  onSubmit,
}: UsePlaceFormOptions): UsePlaceFormResult {
  const [isSaving, setIsSaving] = useState(false);
  const editingId = location?.id ?? null;

  const form = useForm<PlaceFormValues>({
    resolver: zodResolver(placeFormSchema),
    defaultValues: PLACE_FORM_DEFAULTS,
    mode: 'onChange',
  });

  const orgName = form.watch('orgName');

  // Reset the form each time the dialog or sheet opens.
  useEffect(() => {
    if (!open) return;

    form.reset(
      location
        ? usageLocationRecordToFormValues(location)
        : PLACE_FORM_DEFAULTS,
    );
  }, [open, location, form]);

  // The warning shows as soon as the typed name matches another place.
  const duplicateLocation = useMemo(() => {
    const normalizedOrgName = normalizeOrganisationName(orgName);
    if (!normalizedOrgName) return null;

    return (
      existingLocations.find(
        (existingLocation) =>
          existingLocation.id !== editingId &&
          normalizeOrganisationName(existingLocation.organisationName) ===
            normalizedOrgName,
      ) ?? null
    );
  }, [orgName, existingLocations, editingId]);

  const handleValidSubmit = useCallback(
    async (values: PlaceFormValues) => {
      setIsSaving(true);
      try {
        await onSubmit(values, editingId);
        onOpenChange(false);
      } catch {
        // A rejected onSubmit keeps the form open for a retry.
      } finally {
        setIsSaving(false);
      }
    },
    [editingId, onSubmit, onOpenChange],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isSaving) {
        onOpenChange(false);
      }
    },
    [isSaving, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleOrgNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      form.setValue('orgName', event.target.value, { shouldValidate: true });
    },
    [form],
  );

  const handleOrgTypeChange = useCallback(
    (value: string) => {
      if (!isOrganisationType(value)) return;
      form.setValue('orgType', value, { shouldValidate: true });
    },
    [form],
  );

  const handleUpdateMethodChange = useCallback(
    (value: PlaceFormValues['updateMethod']) => {
      form.setValue('updateMethod', value, { shouldValidate: true });
    },
    [form],
  );

  const handlePriorityChange = useCallback(
    (value: PlaceFormValues['priority']) => {
      form.setValue('priority', value, { shouldValidate: true });
    },
    [form],
  );

  const handleLinkChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      form.setValue('link', event.target.value, { shouldValidate: true });
    },
    [form],
  );

  const handleChangedChange = useCallback(
    (checked: boolean | 'indeterminate') => {
      form.setValue('changed', checked === true, { shouldValidate: true });
    },
    [form],
  );

  return {
    form,
    editingId,
    isSaving,
    orgName,
    duplicateLocation,
    handleSubmit: form.handleSubmit(handleValidSubmit),
    handleOpenChange,
    handleCancel,
    handleOrgNameChange,
    handleOrgTypeChange,
    handleUpdateMethodChange,
    handlePriorityChange,
    handleLinkChange,
    handleChangedChange,
  };
}

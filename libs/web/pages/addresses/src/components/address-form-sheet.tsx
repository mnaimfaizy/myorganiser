'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AddressStatusEnum, type AddressRecord } from '@myorganiser/vault-core';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Form,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@myorganiser/web-ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  addAddressSchema,
  type AddAddressFormValues,
} from '../schemas/address';
import {
  countryNameToCode,
  createAddressPreview,
  findDuplicateAddress,
  getDefaultAddressCountryCode,
} from '../utils/addressForm';
import {
  formatAddressLines,
  formatAddressShortLine,
} from '../utils/address-summary';
import { AddAddressFormFields } from './AddAddressFormFields';

export interface AddressFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  /** The Address being edited. Ignored in add mode. */
  address?: AddressRecord;
  /** Every Address, for duplicate detection. The edited one excludes itself. */
  items: AddressRecord[];
  /**
   * Resolves when saved. Rejecting keeps the sheet open with its values. An add
   * that resolves with the saved record shows the success panel; any other
   * resolve closes the sheet.
   */
  onSubmit: (values: AddAddressFormValues) => Promise<AddressRecord | void>;
  variant: 'desktop' | 'phone';
}

function addressToFormValues(address: AddressRecord): AddAddressFormValues {
  return {
    label: address.label,
    propertyNumber: address.propertyNumber ?? '',
    street: address.street ?? '',
    suburb: address.suburb ?? '',
    state: address.state ?? '',
    zipCode: address.zipCode ?? '',
    countryCode:
      countryNameToCode(address.country) ?? getDefaultAddressCountryCode(),
  };
}

/** The add/edit Address sheet. It owns the form, the duplicate check and the add success panel. */
export function AddressFormSheet({
  open,
  onOpenChange,
  mode,
  address,
  items,
  onSubmit,
  variant,
}: AddressFormSheetProps) {
  const router = useRouter();
  const addDefaults = useMemo<AddAddressFormValues>(
    () => ({
      label: 'Home',
      propertyNumber: '',
      street: '',
      suburb: '',
      state: '',
      zipCode: '',
      countryCode: getDefaultAddressCountryCode(),
    }),
    [],
  );
  const initialValues = useMemo<AddAddressFormValues>(
    () =>
      mode === 'edit' && address ? addressToFormValues(address) : addDefaults,
    [address, addDefaults, mode],
  );

  const [savedAddress, setSavedAddress] = useState<AddressRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<AddAddressFormValues>({
    resolver: zodResolver(addAddressSchema),
    defaultValues: initialValues,
    mode: 'onChange',
  });

  const values = form.watch();
  const preview = createAddressPreview(values);
  const duplicateAddress = findDuplicateAddress(
    values,
    items,
    mode === 'edit' ? address?.id : undefined,
  );

  // Reset each time the sheet opens, so a previous add or edit never shows.
  useEffect(() => {
    if (!open) return;
    form.reset(initialValues);
    setSavedAddress(null);
  }, [open, initialValues, form]);

  const handleValidSubmit = useCallback(
    async (nextValues: AddAddressFormValues) => {
      setIsSaving(true);
      try {
        const saved = await onSubmit(nextValues);
        if (mode === 'add' && saved) {
          setSavedAddress(saved);
        } else {
          onOpenChange(false);
        }
      } catch {
        // The hook has already toasted the failure; the sheet stays open.
      } finally {
        setIsSaving(false);
      }
    },
    [mode, onOpenChange, onSubmit],
  );

  const handleSheetOpenChange = useCallback(
    (next: boolean) => {
      if (!next && isSaving) return;
      onOpenChange(next);
    },
    [isSaving, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleAddAnother = useCallback(() => {
    form.reset({ ...addDefaults, label: form.getValues('label') });
    setSavedAddress(null);
  }, [addDefaults, form]);

  const handleSetUpUsageLocations = useCallback(() => {
    if (!savedAddress) return;
    router.push(`/dashboard/addresses/${savedAddress.id}`);
  }, [router, savedAddress]);

  const title = mode === 'edit' ? 'Edit address' : 'Add address';
  const submitLabel = duplicateAddress
    ? 'Save anyway'
    : mode === 'edit'
      ? 'Save changes'
      : 'Save address';
  const previewLines = formatAddressLines({
    id: 'preview',
    status: AddressStatusEnum.Current,
    usageLocations: [],
    createdAt: '',
    ...preview,
  });

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-140">
        <div className="flex flex-col gap-1 border-b border-border px-6 pt-6 pr-14 pb-4">
          <SheetTitle className="font-display text-title text-foreground">
            {title}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-1.5 text-caption text-trust-text">
            <span aria-hidden="true" className="size-2 rounded-full bg-trust" />
            Encrypted on this device before it syncs
          </SheetDescription>
        </div>

        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit(handleValidSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            {savedAddress ? (
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-display text-title text-foreground">
                    Address saved
                  </h3>
                  <p className="text-body-sm text-foreground-secondary">
                    {formatAddressShortLine(savedAddress)}
                  </p>
                </div>
                <div
                  className={
                    variant === 'phone'
                      ? 'flex flex-col gap-2.5'
                      : 'flex flex-wrap gap-2.5'
                  }
                >
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleSetUpUsageLocations}
                  >
                    Set up usage locations
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddAnother}
                  >
                    Add another address
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-5">
                  <AddAddressFormFields control={form.control} />

                  {duplicateAddress ? (
                    <Alert variant="banner" tone="warning">
                      <AlertTitle>You already have this address</AlertTitle>
                      <AlertDescription>
                        {`It matches “${duplicateAddress.label}”. Save another copy only if you need both.`}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-subtle p-4">
                    <span className="text-label-caps font-semibold text-muted-foreground">
                      PREVIEW
                    </span>
                    {previewLines.map((line) => (
                      <span
                        key={line}
                        className="block text-body text-foreground"
                      >
                        {line}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  className={
                    variant === 'phone'
                      ? 'grid grid-cols-2 gap-2.5 border-t border-border px-6 pt-4 pb-6'
                      : 'flex justify-end gap-2.5 border-t border-border px-6 pt-4 pb-6'
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={isSaving}
                    disabled={mode === 'edit' && !form.formState.isValid}
                  >
                    {submitLabel}
                  </Button>
                </div>
              </>
            )}
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

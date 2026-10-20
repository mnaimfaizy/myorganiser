'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { UsageLocationRecord } from '@myorganiser/vault-core';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Illustration,
  type IllustrationKind,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
} from '@myorganiser/web-ui';
import { X } from 'lucide-react';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useForm } from 'react-hook-form';

import {
  normalizeOrganisationName,
  PLACE_FORM_DEFAULTS,
  placeFormSchema,
  type PlaceFormValues,
  usageLocationRecordToFormValues,
} from '../placeForm';
import {
  isOrganisationType,
  ORGANISATION_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  UPDATE_METHOD_OPTIONS,
} from '../labels';

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
  const [isSaving, setIsSaving] = useState(false);
  const editingId = location?.id ?? null;

  const form = useForm<PlaceFormValues>({
    resolver: zodResolver(placeFormSchema),
    defaultValues: PLACE_FORM_DEFAULTS,
    mode: 'onChange',
  });

  const orgName = form.watch('orgName');

  // Reset the form each time the dialog opens.
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
        // A rejected onSubmit keeps the dialog open for a retry.
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

  // Editing keeps "Save changes": the warning still shows, but "Add anyway"
  // would describe an add the User is not making.
  const submitLabel = editingId
    ? 'Save changes'
    : duplicateLocation
      ? 'Add anyway'
      : 'Add place';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-150 gap-0 p-0">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleValidSubmit)}
            className="flex flex-col"
          >
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
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
                <FormField
                  control={form.control}
                  name="orgName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organisation</FormLabel>
                      <FormControl>
                        <Input
                          name={field.name}
                          ref={field.ref}
                          value={field.value}
                          onChange={handleOrgNameChange}
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="orgType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={handleOrgTypeChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ORGANISATION_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              {duplicateLocation ? (
                <Alert variant="notice" tone="warning">
                  <AlertDescription>
                    <span className="font-semibold text-warning-text">
                      {`“${orgName.trim()}” is already on this ${noun}.`}
                    </span>{' '}
                    Add it again only if it&apos;s a different account.
                  </AlertDescription>
                </Alert>
              ) : null}

              <FormField
                control={form.control}
                name="updateMethod"
                render={({ field }) => (
                  <FormItem>
                    <SegmentedControl
                      name={field.name}
                      value={field.value}
                      onValueChange={handleUpdateMethodChange}
                      options={UPDATE_METHOD_OPTIONS}
                      legend="How to update"
                    />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <SegmentedControl
                      name={field.name}
                      value={field.value}
                      onValueChange={handlePriorityChange}
                      options={PRIORITY_OPTIONS}
                      legend="Priority"
                    />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="link"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Where to change it{' '}
                      <span className="font-normal text-muted-foreground">
                        · optional
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        name={field.name}
                        ref={field.ref}
                        value={field.value ?? ''}
                        onChange={handleLinkChange}
                        type="url"
                        placeholder="https://"
                      />
                    </FormControl>
                    <FormDescription>
                      A link to the page where you update your details.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="changed"
                render={({ field }) => (
                  <FormItem className="flex min-h-11 flex-row items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={handleChangedChange}
                      />
                    </FormControl>
                    <div className="flex flex-col">
                      <FormLabel className="text-body-sm font-semibold">
                        Already updated
                      </FormLabel>
                      <FormDescription className="text-caption text-muted-foreground">
                        Records today&apos;s date
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="border-t border-border px-6 pb-6 pt-4">
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

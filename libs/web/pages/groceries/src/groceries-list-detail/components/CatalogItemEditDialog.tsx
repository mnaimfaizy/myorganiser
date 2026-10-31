'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CatalogItem,
  type GroceryCategoryType,
  GROCERY_PREDEFINED_CATEGORIES,
} from '@myorganiser/vault-core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
} from '@myorganiser/web-ui';
import { Lock } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CatalogItemEditFormFields } from './CatalogItemEditFormFields';

const catalogItemEditSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(200),
  category: z.enum(GROCERY_PREDEFINED_CATEGORIES),
  price: z
    .string()
    .refine(
      (value) =>
        value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0),
      'Price must be a valid number',
    ),
  notes: z.string().max(1000),
  imageUrl: z.string().url('Must be a valid URL').or(z.literal('')),
  links: z.array(z.string().url('Each link must be a valid URL')).max(10),
});

export type CatalogItemEditFormValues = z.infer<typeof catalogItemEditSchema>;

export interface CatalogItemEditChanges {
  id: string;
  name: string;
  category: GroceryCategoryType;
  price?: number;
  notes?: string;
  imageUrl?: string;
  links?: string[];
}

interface CatalogItemEditDialogProps {
  item: CatalogItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (changes: CatalogItemEditChanges) => Promise<void>;
  isLoading?: boolean;
}

export function CatalogItemEditDialog({
  item,
  isOpen,
  onClose,
  onSave,
  isLoading = false,
}: CatalogItemEditDialogProps) {
  const form = useForm<CatalogItemEditFormValues>({
    resolver: zodResolver(catalogItemEditSchema, undefined, { mode: 'sync' }),
    mode: 'onChange',
    defaultValues: {
      name: '',
      category: 'other',
      price: '',
      notes: '',
      imageUrl: '',
      links: [],
    },
  });

  useEffect(() => {
    form.reset({
      name: item?.name ?? '',
      category: item?.category ?? 'other',
      price: item?.price === undefined ? '' : String(item.price),
      notes: item?.notes ?? '',
      imageUrl: item?.imageUrl ?? '',
      links: item?.links ?? [],
    });
  }, [form, item?.id]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!item) return;
    try {
      await onSave({
        id: item.id,
        name: values.name,
        category: values.category,
        price: values.price === '' ? undefined : Number(values.price),
        notes: values.notes || undefined,
        imageUrl: values.imageUrl || undefined,
        links: values.links.length ? values.links : undefined,
      });
    } catch {
      // The caller already reports the failure. Keep the dialog open with the
      // current values so the user can retry.
      return;
    }
    onClose();
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const selectedCategory = form.watch('category');

  return (
    <Dialog open={isOpen && item !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl gap-0 overflow-hidden p-0">
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <div className="border-b border-border px-6 py-5">
              <div className="mb-1 flex items-start gap-3">
                <DialogTitle className="text-xl font-semibold text-primary">
                  Edit Catalog Item
                </DialogTitle>
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                  <Lock className="h-3 w-3" /> Encrypted Data
                </span>
              </div>
              <DialogDescription className="text-sm text-muted-foreground">
                Changes apply to this Catalog Item and are shared by every
                Grocery List reference. Stored securely in your private vault.
              </DialogDescription>
            </div>
            <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5">
              <CatalogItemEditFormFields
                control={form.control}
                selectedCategory={selectedCategory}
                isLoading={isLoading}
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-border bg-muted px-6 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !form.formState.isValid}
              >
                Save Catalog Item
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

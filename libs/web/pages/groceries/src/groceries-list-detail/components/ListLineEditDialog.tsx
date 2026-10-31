'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CatalogItem, ListLine } from '@myorganiser/vault-core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@myorganiser/web-ui';
import { Lock } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const listLineEditSchema = z.object({
  amount: z.string().max(50, 'Amount must be 50 characters or less'),
});
type ListLineEditFormValues = z.infer<typeof listLineEditSchema>;

interface ListLineEditDialogProps {
  line: ListLine | null;
  catalogItem: CatalogItem | undefined;
  isOpen: boolean;
  onClose: () => void;
  onSave: (changes: { id: string; amount?: string }) => Promise<void>;
  isLoading?: boolean;
}

export function ListLineEditDialog({
  line,
  catalogItem,
  isOpen,
  onClose,
  onSave,
  isLoading = false,
}: ListLineEditDialogProps) {
  const form = useForm<ListLineEditFormValues>({
    resolver: zodResolver(listLineEditSchema, undefined, { mode: 'sync' }),
    defaultValues: { amount: '' },
  });

  useEffect(() => {
    form.reset({ amount: line?.amount ?? '' });
  }, [form, line?.id]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!line) return;
    try {
      await onSave({ id: line.id, amount: values.amount || undefined });
    } catch {
      // The caller has already reported the failure. Keep the dialog open
      // with the current values so the user can retry.
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

  return (
    <Dialog open={isOpen && line !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogTitle>Edit List Line</DialogTitle>
            <DialogDescription className="mt-2">
              Edit trip details for this List Line on the current Grocery List.
              This does not change the Catalog Item.
            </DialogDescription>
            <div className="space-y-4 py-5">
              <p className="text-sm font-medium text-foreground">
                {catalogItem?.name ?? 'Unknown Catalog Item'}
              </p>
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity / Amount</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={50}
                        placeholder="e.g. 2, 500g"
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Checked state</FormLabel>
                <p className="text-sm text-muted-foreground">
                  {line?.checked ? 'Checked Item' : 'Active List Line'} —
                  controlled by the row checkbox.
                </p>
              </FormItem>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Stored securely in your private
                vault.
              </span>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClose}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  Save List Line
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

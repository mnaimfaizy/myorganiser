'use client';

import { useCallback, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { UserDeletionBodyConfirmationEnum } from '@myorganiser/app-api-client';
import { clearAuthSession } from '@myorganiser/auth';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@myorganiser/web-ui';
import { isAxiosError } from 'axios';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import type { AccountVariant } from '../account-view';
import { createUsersApi } from '../lib/apiClient';
import {
  userDeletionFormSchema,
  type UserDeletionFormValues,
} from '../schemas/userDeletion';

const GENERIC_DELETE_ERROR = 'Your account was not deleted. Try again.';

// Only a 4xx answer carries a message the user can act on (e.g. the 409
// "A YouTube sync is running…"). A 5xx body is internal detail, and a network
// failure has no response at all, so both fall back to the generic copy.
function getServerMessage(error: unknown): string | undefined {
  if (!isAxiosError(error)) return undefined;
  const status = error.response?.status;
  if (status === undefined || status < 400 || status >= 500) return undefined;
  const data = error.response?.data;
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message;
  }
  return undefined;
}

interface DeleteAccountConfirmFormProps {
  variant?: AccountVariant;
  onBack: () => void;
}

export function DeleteAccountConfirmForm({
  variant = 'desktop',
  onBack,
}: DeleteAccountConfirmFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const isPhone = variant === 'phone';

  const form = useForm<UserDeletionFormValues>({
    resolver: zodResolver(userDeletionFormSchema),
    defaultValues: { password: '', confirmation: '' },
  });

  const { isSubmitting } = form.formState;

  const onSubmit = useCallback(
    async (values: UserDeletionFormValues) => {
      setFormError(null);
      try {
        await createUsersApi().deleteMe({
          userDeletionBody: {
            password: values.password,
            confirmation: UserDeletionBodyConfirmationEnum.Delete,
          },
        });
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 403) {
          form.setError('password', {
            message: getServerMessage(error) ?? 'Incorrect password.',
          });
          return;
        }
        setFormError(getServerMessage(error) ?? GENERIC_DELETE_ERROR);
        return;
      }

      // The account is gone, so logout() would only 401 and run the refresh
      // path. clearAuthSession does not emit sessionEnded, so the dashboard
      // guard will not race this navigation to /login.
      clearAuthSession();
      router.replace('/account-deleted');
    },
    [form, router],
  );

  const fieldClassName = isPhone ? 'h-13' : 'md:h-12';

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col"
        data-testid="delete-account-form"
      >
        <div
          className={
            isPhone
              ? 'flex flex-col gap-4 px-4 py-4'
              : 'flex flex-col gap-4 px-6 py-5'
          }
        >
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Account password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    className={fieldClassName}
                    data-testid="delete-account-password"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type DELETE to confirm</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    className={fieldClassName}
                    data-testid="delete-account-confirmation"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {formError && (
            <p
              role="alert"
              data-testid="delete-account-error"
              className="text-sm text-destructive"
            >
              {formError}
            </p>
          )}
        </div>
        {isPhone ? (
          <div className="flex flex-col gap-2 px-4 pt-2 pb-2">
            <Button
              type="submit"
              variant="destructive"
              className="h-13 w-full"
              data-testid="delete-account-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting…' : 'Delete my account'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-13 w-full"
              onClick={onBack}
            >
              Back
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2.5 border-t border-border px-6 pt-4 pb-6">
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button
              type="submit"
              variant="destructive"
              data-testid="delete-account-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}

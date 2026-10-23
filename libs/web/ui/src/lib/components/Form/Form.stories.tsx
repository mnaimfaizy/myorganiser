import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from '@storybook/test';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../Button/Button';
import { Input } from '../Input/Input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './Form';

// Sample copy for the stories only, not shipped product copy.
const profileSchema = z.object({
  name: z.string().min(1, 'Enter your full name.'),
  email: z.email('Enter a valid email address.'),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

function ProfileForm({
  defaultValues,
  disabledEmail = false,
  longCopy = false,
}: {
  defaultValues: ProfileFormValues;
  disabledEmail?: boolean;
  longCopy?: boolean;
}) {
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues,
  });

  return (
    <Form {...form}>
      <form
        className="w-[380px] space-y-4"
        onSubmit={form.handleSubmit(() => undefined)}
        noValidate
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {longCopy
                  ? 'Full name as it should appear on shared lists and invitations'
                  : 'Full name'}
              </FormLabel>
              <FormControl>
                <Input placeholder="Jane Doe" {...field} />
              </FormControl>
              <FormDescription>
                {longCopy
                  ? 'Your display name across the workspace. Collaborators see this name next to every list you share, in reminders, and on invitation emails.'
                  : 'Your display name across the workspace.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="jane@example.com"
                  disabled={disabledEmail}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {disabledEmail
                  ? 'This address comes from your account and cannot be changed here.'
                  : 'Used for reminders and collaborator invitations.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Save changes</Button>
      </form>
    </Form>
  );
}

const meta: Meta<typeof ProfileForm> = {
  component: ProfileForm,
  title: 'Components/Form',
  tags: ['autodocs'],
  args: {
    defaultValues: { name: '', email: '' },
  },
};

export default meta;
type Story = StoryObj<typeof ProfileForm>;

export const Empty: Story = {};

export const Filled: Story = {
  args: {
    defaultValues: { name: 'Jane Doe', email: 'jane.doe@example.com' },
  },
};

/**
 * A real React Hook Form + Zod field. Nothing is set by hand: the reader
 * submits the form, zodResolver reports the failures, and FormMessage shows
 * them with the alert icon. FormControl sets aria-invalid on the input.
 */
export const ValidationError: Story = {
  args: {
    defaultValues: { name: '', email: 'not-an-email' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(canvas.getByText('Enter a valid email address.')).toBeVisible();
    });
    await expect(canvas.getByLabelText('Email address')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const email = canvas.getByLabelText('Email address');
    await expect(email).toHaveAccessibleDescription(
      /Enter a valid email address\./,
    );
  },
};

export const Disabled: Story = {
  args: {
    defaultValues: { name: 'Jane Doe', email: 'sam@example.com' },
    disabledEmail: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('Email address')).toBeDisabled();
  },
};

export const LongContent: Story = {
  args: {
    defaultValues: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    longCopy: true,
  },
};

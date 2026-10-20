import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './Form';
import { Input } from '../Input/Input';

const schema = z.object({
  email: z.string().min(1, 'Email is required'),
});

type FormValues = z.infer<typeof schema>;

const DESCRIPTION = 'We use it to sign you in.';

function EmailForm({ onSubmit }: { onSubmit?: (values: FormValues) => void }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => onSubmit?.(values))}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>{DESCRIPTION}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Continue</button>
      </form>
    </Form>
  );
}

function PlainHelperForm() {
  const form = useForm<FormValues>({ defaultValues: { email: '' } });

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage>Helper copy</FormMessage>
          </FormItem>
        )}
      />
    </Form>
  );
}

async function submitInvalid() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Email is required');
}

describe('Form', () => {
  describe('validation error', () => {
    it('marks the input aria-invalid and does not submit the values', async () => {
      const onSubmit = jest.fn();
      render(<EmailForm onSubmit={onSubmit} />);

      await submitInvalid();

      expect(screen.getByLabelText('Email')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('shows the error text with an aria-hidden alert icon', async () => {
      render(<EmailForm />);

      await submitInvalid();
      const message = screen.getByText('Email is required');

      expect(message.querySelector('svg')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    });

    it('describes the input with both the description and the error message', async () => {
      render(<EmailForm />);

      await submitInvalid();

      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
        expect.stringContaining('Email is required'),
      );
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
        expect.stringContaining(DESCRIPTION),
      );
    });

    it('keeps the label associated with the input', async () => {
      render(<EmailForm />);

      await submitInvalid();

      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
  });

  describe('before an error', () => {
    it('renders no message and no icon, and describes the input with the description only', () => {
      const { container } = render(<EmailForm />);
      const input = screen.getByLabelText('Email');

      expect(screen.queryByText('Email is required')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(input).toHaveAccessibleDescription(DESCRIPTION);
    });
  });

  describe('plain helper children', () => {
    it('renders the children as text without an alert icon when there is no error', () => {
      const { container } = render(<PlainHelperForm />);

      expect(screen.getByText('Helper copy')).toBeInTheDocument();
      expect(container.querySelector('svg')).toBeNull();
    });
  });
});

import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useForm } from 'react-hook-form';
import {
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Input,
} from '@myorganiser/web-ui';

import { LegalDocumentDialog } from './LegalDocumentDialog';
import { LegalOperatorProvider } from './LegalOperatorProvider';

jest.mock('next/link', () => {
  return ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

interface SignUpShapedValues {
  firstName: string;
  agreeToTerms: boolean;
}

/**
 * Mirrors the Sign up form's legal row: the checkbox and both dialog triggers
 * sit inside one FormLabel, inside a react-hook-form <form>.
 */
function SignUpShapedForm({
  onSubmit = () => undefined,
}: {
  onSubmit?: (values: SignUpShapedValues) => void;
}) {
  const form = useForm<SignUpShapedValues>({
    defaultValues: { firstName: '', agreeToTerms: false },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="agreeToTerms"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="leading-none">
                <FormLabel className="text-sm font-normal">
                  I agree to all the{' '}
                  <LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>{' '}
                  and{' '}
                  <LegalDocumentDialog kind="privacy">
                    Privacy Policies
                  </LegalDocumentDialog>
                </FormLabel>
              </div>
            </FormItem>
          )}
        />
        <button type="submit">Submit form</button>
      </form>
    </Form>
  );
}

async function openDialog(triggerName: string, dialogName: string) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
  return screen.findByRole('dialog', { name: dialogName });
}

describe('LegalDocumentDialog', () => {
  // jsdom has no ResizeObserver; Radix Checkbox measures itself with one.
  const originalResizeObserver = globalThis.ResizeObserver;

  class ResizeObserverStub {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  }

  beforeEach(() => {
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  describe('trigger and dialog', () => {
    it('renders the Terms trigger as a type="button" that opens the Terms of Service dialog', async () => {
      render(<LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>);

      const trigger = screen.getByRole('button', { name: 'Terms' });
      expect(trigger).toHaveAttribute('type', 'button');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const dialog = await openDialog('Terms', 'Terms of Service');

      expect(
        within(dialog).getByRole('heading', {
          name: 'Acceptance of Terms',
          level: 3,
        }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
    });

    it('opens the Privacy Policy dialog with its section headings at level 3', async () => {
      render(<LegalDocumentDialog kind="privacy">Privacy</LegalDocumentDialog>);

      const dialog = await openDialog('Privacy', 'Privacy Policy');

      expect(
        within(dialog).getByRole('heading', {
          name: 'YouTube Integration',
          level: 3,
        }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
    });

    it('removes the dialog when its close button is activated', async () => {
      render(<LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>);

      const dialog = await openDialog('Terms', 'Terms of Service');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('removes the dialog when Escape is pressed', async () => {
      render(<LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>);

      await openDialog('Terms', 'Terms of Service');
      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('opens the YouTube Data Privacy link in a new tab with noopener inside the dialog', async () => {
      render(<LegalDocumentDialog kind="privacy">Privacy</LegalDocumentDialog>);

      const dialog = await openDialog('Privacy', 'Privacy Policy');
      const link = within(dialog).getByRole('link', {
        name: 'YouTube Data Privacy page',
      });

      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toMatch(/noopener/);
    });
  });

  describe('operator section', () => {
    it('shows the operator name and a mailto link when the provider supplies both', async () => {
      render(
        <LegalOperatorProvider name="Acme Ops" email="legal@acme.test">
          <LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>
        </LegalOperatorProvider>,
      );

      const dialog = await openDialog('Terms', 'Terms of Service');

      expect(
        within(dialog).getByRole('heading', {
          name: 'Operator & Contact',
          level: 3,
        }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/Acme Ops/)).toBeInTheDocument();
      expect(
        within(dialog).getByRole('link', { name: 'legal@acme.test' }),
      ).toHaveAttribute('href', 'mailto:legal@acme.test');
    });

    it('omits the operator section and still opens when no provider is mounted', async () => {
      render(<LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>);

      const dialog = await openDialog('Terms', 'Terms of Service');

      expect(
        within(dialog).queryByRole('heading', { name: 'Operator & Contact' }),
      ).not.toBeInTheDocument();
      expect(dialog.querySelector('a[href^="mailto:"]')).toBeNull();
      expect(
        within(dialog).getByRole('heading', {
          name: 'Acceptance of Terms',
          level: 3,
        }),
      ).toBeInTheDocument();
    });

    it('shows only the operator name when the provider has no email', async () => {
      render(
        <LegalOperatorProvider name="Acme Ops">
          <LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>
        </LegalOperatorProvider>,
      );

      const dialog = await openDialog('Terms', 'Terms of Service');

      expect(within(dialog).getByText(/Acme Ops/)).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('link', { name: /@/ }),
      ).not.toBeInTheDocument();
    });

    it('shows only the contact email when the provider has no name', async () => {
      render(
        <LegalOperatorProvider email="legal@acme.test">
          <LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>
        </LegalOperatorProvider>,
      );

      const dialog = await openDialog('Terms', 'Terms of Service');

      expect(
        within(dialog).getByRole('link', { name: 'legal@acme.test' }),
      ).toHaveAttribute('href', 'mailto:legal@acme.test');
      expect(within(dialog).queryByText(/Operator:/)).not.toBeInTheDocument();
    });
  });

  describe('inside a form', () => {
    it('keeps the typed input value and the checkbox state across open and close', async () => {
      render(<SignUpShapedForm />);

      const input = screen.getByLabelText('First name');
      fireEvent.change(input, { target: { value: 'Jane' } });
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      expect(checkbox).toHaveAttribute('aria-checked', 'true');

      const dialog = await openDialog('Terms', 'Terms of Service');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      expect(input).toHaveValue('Jane');
      expect(checkbox).toHaveAttribute('aria-checked', 'true');
    });

    it('does not submit the form or toggle the checkbox when a trigger is clicked', async () => {
      const onSubmit = jest.fn();
      const submitListener = jest.fn();
      const { container } = render(<SignUpShapedForm onSubmit={onSubmit} />);
      const form = container.querySelector('form');
      if (!form) throw new Error('Expected the test form to render');
      form.addEventListener('submit', submitListener);

      const checkbox = screen.getByRole('checkbox');

      // Control: a click on the label's plain text reaches the checkbox in
      // jsdom, so a trigger inside the label is the only thing that could
      // leave it unchanged here.
      fireEvent.click(screen.getByText(/I agree to all the/));
      expect(checkbox).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Terms' }));
      await screen.findByRole('dialog', { name: 'Terms of Service' });

      expect(submitListener).not.toHaveBeenCalled();
      expect(checkbox).toHaveAttribute('aria-checked', 'true');

      // Control: the form's own submit button does reach the submit listener,
      // so the assertion above is not vacuous. Close the dialog first, since
      // Radix hides the page behind an open dialog from the accessibility tree.
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Submit form' }));
      await waitFor(() => {
        expect(submitListener).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('dialog variant', () => {
    it('renders each Terms section as an h3 inside a section, with no numbered badge, and shows the Last updated line', async () => {
      render(<LegalDocumentDialog kind="terms">Terms</LegalDocumentDialog>);

      const dialog = await openDialog('Terms', 'Terms of Service');

      expect(
        within(dialog).getByText('Last updated: 16 October 2026'),
      ).toBeInTheDocument();
      expect(dialog.querySelectorAll('section h3')).toHaveLength(7);
      expect(dialog.querySelector('section h2')).toBeNull();
      expect(within(dialog).queryByText(/^0[1-9]$/)).toBeNull();
    });

    it('renders each Privacy Policy section as an h3 with no numbered badge, and keeps the Last updated line', async () => {
      render(<LegalDocumentDialog kind="privacy">Privacy</LegalDocumentDialog>);

      const dialog = await openDialog('Privacy', 'Privacy Policy');

      expect(
        within(dialog).getByText('Last updated: 15 October 2026'),
      ).toBeInTheDocument();
      expect(dialog.querySelectorAll('section h3')).toHaveLength(8);
      expect(dialog.querySelector('section h2')).toBeNull();
      expect(within(dialog).queryByText(/^0[1-9]$/)).toBeNull();
    });
  });
});

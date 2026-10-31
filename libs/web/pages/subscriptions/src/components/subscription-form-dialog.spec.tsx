import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  SubscriptionBillingCycleEnum,
  SubscriptionPaymentMethodEnum,
  SubscriptionRenewalTypeEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  type SubscriptionRecord,
} from '@myorganiser/vault-core';

import type { SubscriptionFormSurfaceProps } from '../hooks/use-subscription-form';
import {
  emptySubscriptionFormValues,
  subscriptionToFormValues,
} from '../utils/subscription-form-values';
import { SubscriptionFormDialog } from './subscription-form-dialog';

const DESCRIPTION_TEXT = 'Encrypted on this device before it syncs';

const RECORD: SubscriptionRecord = {
  id: 'sub-1',
  name: 'Gym',
  startDate: '2026-03-01T00:00:00.000Z',
  status: SubscriptionStatusEnum.Active,
  billingCycle: SubscriptionBillingCycleEnum.Monthly,
  amount: 29.5,
  currency: 'AUD',
  paymentMethod: SubscriptionPaymentMethodEnum.CreditCard,
  renewalType: SubscriptionRenewalTypeEnum.AutoRenew,
  tier: SubscriptionTierEnum.Pro,
  link: 'https://gym.example.com',
};

function renderDialog(overrides: Partial<SubscriptionFormSurfaceProps> = {}) {
  const props: SubscriptionFormSurfaceProps = {
    open: true,
    onOpenChange: jest.fn(),
    mode: 'add',
    initialValues: emptySubscriptionFormValues('AUD'),
    onSubmit: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<SubscriptionFormDialog {...props} />);
  return { ...view, props };
}

function typeInto(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('SubscriptionFormDialog', () => {
  it('shows the add-mode copy and every labelled field in its section', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Add subscription' });
    expect(dialog).toHaveAccessibleDescription(DESCRIPTION_TEXT);
    expect(
      screen.getByRole('button', { name: 'Add subscription' }),
    ).toBeEnabled();

    const basics = screen.getByRole('group', { name: 'Basics' });
    expect(within(basics).getByLabelText('Name')).toBeInTheDocument();
    expect(within(basics).getByLabelText(/^Website/)).toBeInTheDocument();

    const billing = screen.getByRole('group', { name: 'Billing' });
    expect(within(billing).getByLabelText('Amount')).toBeInTheDocument();
    expect(within(billing).getByLabelText('Currency')).toBeInTheDocument();
    expect(within(billing).getByLabelText('Billed')).toBeInTheDocument();

    const dates = screen.getByRole('group', { name: 'Dates' });
    expect(within(dates).getByLabelText(/^Started/)).toBeInTheDocument();
    expect(within(dates).getByLabelText(/^Next billing/)).toBeInTheDocument();
    expect(within(dates).getByLabelText(/^Ends/)).toBeInTheDocument();

    const plan = screen.getByRole('group', { name: 'Plan' });
    const status = within(plan).getByRole('group', { name: 'Status' });
    expect(within(status).getAllByRole('radio')).toHaveLength(5);
    expect(within(plan).getByLabelText('Pays with')).toBeInTheDocument();
    expect(within(plan).getByLabelText('Renewal')).toBeInTheDocument();
    expect(within(plan).getByLabelText('Tier')).toBeInTheDocument();
  });

  it('prefills every field from the record in edit mode', () => {
    renderDialog({
      mode: 'edit',
      initialValues: subscriptionToFormValues(RECORD),
    });

    expect(
      screen.getByRole('dialog', { name: 'Edit subscription' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Gym');
    expect(screen.getByLabelText(/^Website/)).toHaveValue(
      'https://gym.example.com',
    );
    expect(screen.getByLabelText('Amount')).toHaveValue(29.5);
    expect(screen.getByLabelText('Currency')).toHaveTextContent('AUD');
    expect(screen.getByLabelText(/^Started/)).toHaveTextContent(
      'March 1st, 2026',
    );
    expect(screen.getByRole('radio', { name: 'Active' })).toBeChecked();
    expect(screen.getByLabelText('Billed')).toHaveTextContent('Monthly');
    expect(screen.getByLabelText('Pays with')).toHaveTextContent('Credit card');
    expect(screen.getByLabelText('Renewal')).toHaveTextContent('Auto renew');
    expect(screen.getByLabelText('Tier')).toHaveTextContent('Pro');
    expect(screen.getByLabelText(/^Next billing/)).toHaveTextContent(
      'Pick a date',
    );
    expect(screen.getByLabelText(/^Ends/)).toHaveTextContent('No end date');
  });

  it('shows the name error and does not submit when the name is empty', async () => {
    const { props } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the amount and website errors on one submit and does not submit', async () => {
    const { props } = renderDialog();

    typeInto('Name', 'Gym');
    typeInto('Amount', '-1');
    typeInto(/^Website/, 'not a website');
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    expect(await screen.findByText('Use 0 or more.')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a full web address, starting with https://'),
    ).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('submits the chosen status and closes after onSubmit resolves', async () => {
    const { props } = renderDialog();

    typeInto('Name', 'Gym');
    fireEvent.click(screen.getByRole('radio', { name: 'Pending' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gym', status: 'pending' }),
    );
  });

  it('stays open with the values intact and buttons enabled when onSubmit rejects', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Save failed'));
    const { props } = renderDialog({ onSubmit });

    typeInto('Name', 'Gym');
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Add subscription' }),
      ).toBeEnabled(),
    );
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Add subscription' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Gym');
  });

  it('closes without submitting when Cancel is pressed', () => {
    const { props } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('blocks dismissal while a save is pending, then closes once it resolves', async () => {
    let resolveSave: () => void = () => undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { props } = renderDialog({ onSubmit });

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    typeInto('Name', 'Gym');
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(),
    );
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole('dialog', { name: 'Add subscription' }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveSave();
    });
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('resets to the new initial values when reopened', () => {
    const { props, rerender } = renderDialog();

    typeInto('Name', 'Half typed');
    rerender(<SubscriptionFormDialog {...props} open={false} />);
    rerender(
      <SubscriptionFormDialog
        {...props}
        open
        initialValues={{
          ...emptySubscriptionFormValues('AUD'),
          name: 'Spotify',
        }}
      />,
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Spotify');
  });

  it('links the Started date error to its trigger and does not submit', async () => {
    const { props } = renderDialog({
      initialValues: { ...emptySubscriptionFormValues('AUD'), startDate: '' },
    });

    typeInto('Name', 'Gym');
    fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

    const message = await screen.findByText('Start date is required');
    const trigger = screen.getByLabelText(/^Started/);
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain(
      message.id,
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

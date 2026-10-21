import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { SubscriptionFormSheet } from './subscription-form-sheet';

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

const WEBSITE_ERROR = 'Enter a full web address, starting with https://';

function renderSheet(overrides: Partial<SubscriptionFormSurfaceProps> = {}) {
  const props: SubscriptionFormSurfaceProps = {
    open: true,
    onOpenChange: jest.fn(),
    mode: 'add',
    initialValues: emptySubscriptionFormValues('AUD'),
    onSubmit: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<SubscriptionFormSheet {...props} />);
  return { ...view, props };
}

function typeInto(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function chip(name: string) {
  return screen.getByRole('button', { name });
}

function moreDetails() {
  return screen.getByRole('button', { name: /More details/ });
}

describe('SubscriptionFormSheet', () => {
  it('titles the sheet for add and edit, with Cancel and Save in the header', () => {
    const { props, rerender } = renderSheet();

    expect(
      screen.getByRole('dialog', { name: 'New subscription' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    rerender(<SubscriptionFormSheet {...props} mode="edit" />);

    expect(
      screen.getByRole('dialog', { name: 'Edit subscription' }),
    ).toBeInTheDocument();
  });

  it('presses Monthly by default and reveals the long cycles behind More…', () => {
    renderSheet();

    expect(chip('Monthly')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Yearly')).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.queryByRole('button', { name: 'Quarterly' }),
    ).not.toBeInTheDocument();

    fireEvent.click(chip('More…'));

    expect(chip('More…')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Quarterly')).toBeInTheDocument();
    expect(chip('Every 2 years')).toBeInTheDocument();
    expect(chip('Every 3 years')).toBeInTheDocument();
  });

  it('submits the chosen Yearly cycle and closes after onSubmit resolves', async () => {
    const { props } = renderSheet();

    typeInto('Name', 'Gym');
    fireEvent.click(chip('Yearly'));

    expect(chip('Yearly')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Monthly')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gym', billingCycle: 'yearly' }),
    );
  });

  it('starts with the More… group revealed when the current cycle is a long one', () => {
    renderSheet({
      mode: 'edit',
      initialValues: subscriptionToFormValues({
        ...RECORD,
        billingCycle: SubscriptionBillingCycleEnum.TwoYears,
      }),
    });

    expect(chip('More…')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Every 2 years')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Every 3 years')).toBeInTheDocument();
  });

  it('keeps More details collapsed by default and toggles it open and closed', () => {
    renderSheet();

    expect(moreDetails()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/^Website/)).not.toBeInTheDocument();

    fireEvent.click(moreDetails());

    expect(moreDetails()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Website/)).toBeInTheDocument();

    fireEvent.click(moreDetails());

    expect(moreDetails()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens More details and shows the website error when submit fails on it', async () => {
    const { props } = renderSheet({
      initialValues: {
        ...emptySubscriptionFormValues('AUD'),
        name: 'Gym',
        link: 'not a website',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(WEBSITE_ERROR)).toBeInTheDocument();
    expect(moreDetails()).toHaveAttribute('aria-expanded', 'true');
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('disables Cancel and blocks dismissal while a save is pending, then closes once it resolves', async () => {
    let resolveSave: () => void = () => undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { props } = renderSheet({ onSubmit });

    typeInto('Name', 'Gym');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(),
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole('dialog', { name: 'New subscription' }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveSave();
    });
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it('stays open with the values intact when onSubmit rejects', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Save failed'));
    const { props } = renderSheet({ onSubmit });

    typeInto('Name', 'Gym');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'New subscription' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Gym');
  });
});

import '@testing-library/jest-dom';
import type { UsageLocationRecord } from '@myorganiser/vault-core';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { PlaceFormValues } from '../placeForm';
import { PlaceDialog, type PlaceDialogProps } from './PlaceDialog';

const SUBJECT = 'Home';

const EXISTING_BANK: UsageLocationRecord = {
  id: 'loc-bank',
  organisationName: 'Commonwealth Bank',
  organisationType: 'bank',
  updateMethod: 'online',
  priority: 'normal',
  changed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EDITED_WESTPAC: UsageLocationRecord = {
  id: 'loc-westpac',
  organisationName: 'Westpac',
  organisationType: 'bank',
  updateMethod: 'phone',
  priority: 'high',
  changed: true,
  link: 'https://westpac.example/update',
  createdAt: '2026-01-02T00:00:00.000Z',
};

async function renderDialog(overrides: Partial<PlaceDialogProps> = {}) {
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn<Promise<void>, [PlaceFormValues, string | null]>(
    () => Promise.resolve(),
  );
  const props: PlaceDialogProps = {
    open: true,
    location: null,
    existingLocations: [],
    subject: SUBJECT,
    noun: 'address',
    onOpenChange,
    onSubmit,
    ...overrides,
  };
  await act(async () => {
    render(<PlaceDialog {...props} />);
  });
  return { onOpenChange, onSubmit };
}

async function typeOrganisation(value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Organisation'), {
      target: { value },
    });
  });
}

async function typeLink(value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Where to change it/), {
      target: { value },
    });
  });
}

describe('PlaceDialog', () => {
  // jsdom has no ResizeObserver; Radix Select measures itself with one.
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

  it('in add mode, names the dialog "Add place", describes it by subject, and labels submit "Add place"', async () => {
    await renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Add place' });
    expect(dialog).toHaveAccessibleDescription('Who needs to know about Home?');
    expect(
      screen.getByRole('button', { name: 'Add place' }),
    ).toBeInTheDocument();
  });

  it('warns when the typed name normalises equal to another place and relabels submit "Add anyway"', async () => {
    await renderDialog({ existingLocations: [EXISTING_BANK] });

    await typeOrganisation('commonwealth-bank');

    expect(
      await screen.findByText(
        '“commonwealth-bank” is already on this address.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add anyway' }),
    ).toBeInTheDocument();
  });

  it('says "number" in the duplicate warning when noun is number', async () => {
    await renderDialog({
      existingLocations: [EXISTING_BANK],
      noun: 'number',
      subject: 'Personal (+61 412 345 678)',
    });

    await typeOrganisation('Commonwealth Bank');

    expect(
      await screen.findByText('“Commonwealth Bank” is already on this number.'),
    ).toBeInTheDocument();
  });

  it('submits once on "Add anyway" with the values and a null editing id', async () => {
    const { onSubmit } = await renderDialog({
      existingLocations: [EXISTING_BANK],
    });
    await typeOrganisation('commonwealth-bank');
    const submit = await screen.findByRole('button', { name: 'Add anyway' });
    await waitFor(() => expect(submit).toBeEnabled());

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgName: 'commonwealth-bank',
        orgType: 'government',
        updateMethod: 'online',
        priority: 'normal',
        changed: false,
      }),
      null,
    );
  });

  it('in edit mode, names the dialog "Edit place" and prefills the fields from the record', async () => {
    await renderDialog({
      location: EDITED_WESTPAC,
      existingLocations: [EDITED_WESTPAC],
    });

    expect(
      screen.getByRole('dialog', { name: 'Edit place' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Organisation')).toHaveValue('Westpac');
    expect(screen.getByLabelText(/Where to change it/)).toHaveValue(
      'https://westpac.example/update',
    );
  });

  it('does not warn about the record being edited, and keeps "Save changes"', async () => {
    await renderDialog({
      location: EDITED_WESTPAC,
      existingLocations: [EDITED_WESTPAC],
    });

    expect(screen.queryByText(/is already on this/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument();
  });

  it('warns about another place in edit mode but keeps "Save changes" rather than "Add anyway"', async () => {
    await renderDialog({
      location: EDITED_WESTPAC,
      existingLocations: [EDITED_WESTPAC, EXISTING_BANK],
    });

    await typeOrganisation('Commonwealth Bank');

    expect(
      await screen.findByText(
        '“Commonwealth Bank” is already on this address.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add anyway' }),
    ).not.toBeInTheDocument();
  });

  it('disables submit until the form is valid', async () => {
    await renderDialog();
    const submit = screen.getByRole('button', { name: 'Add place' });

    expect(submit).toBeDisabled();

    await typeOrganisation('Commonwealth Bank');

    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('shows the URL message and disables submit for a link without http or https', async () => {
    await renderDialog();
    await typeOrganisation('Commonwealth Bank');
    await typeLink('bank.example/update');

    expect(
      await screen.findByText(
        'Enter a valid URL, including http:// or https://',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add place' })).toBeDisabled();
  });

  it('while onSubmit is pending, marks submit aria-busy and disables Cancel', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    await renderDialog({ onSubmit });
    await typeOrganisation('Commonwealth Bank');
    const submit = await screen.findByRole('button', { name: 'Add place' });
    await waitFor(() => expect(submit).toBeEnabled());

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => {
      resolveSubmit();
    });
  });

  it('does not close on Escape while saving', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { onOpenChange } = await renderDialog({ onSubmit });
    await typeOrganisation('Commonwealth Bank');
    const submit = await screen.findByRole('button', { name: 'Add place' });
    await waitFor(() => expect(submit).toBeEnabled());
    await act(async () => {
      fireEvent.click(submit);
    });

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await act(async () => {
      resolveSubmit();
    });
  });

  it('closes on Escape when idle, so the saving guard is tested against a reachable path', async () => {
    const { onOpenChange } = await renderDialog();

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) once onSubmit resolves', async () => {
    const { onOpenChange } = await renderDialog();
    await typeOrganisation('Commonwealth Bank');
    const submit = await screen.findByRole('button', { name: 'Add place' });
    await waitFor(() => expect(submit).toBeEnabled());

    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog open and re-enables submit when onSubmit rejects', async () => {
    const onSubmit = jest.fn(() => Promise.reject(new Error('Save failed')));
    const { onOpenChange } = await renderDialog({ onSubmit });
    await typeOrganisation('Commonwealth Bank');
    const submit = await screen.findByRole('button', { name: 'Add place' });
    await waitFor(() => expect(submit).toBeEnabled());

    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() =>
      expect(submit).not.toHaveAttribute('aria-busy', 'true'),
    );
    expect(submit).toBeEnabled();
    expect(
      screen.getByRole('dialog', { name: 'Add place' }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('Cancel calls onOpenChange(false) without submitting', async () => {
    const { onOpenChange, onSubmit } = await renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

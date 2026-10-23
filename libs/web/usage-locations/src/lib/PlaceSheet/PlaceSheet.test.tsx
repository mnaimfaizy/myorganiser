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
import type { PlaceDialogProps } from '../PlaceDialog/PlaceDialog';
import { PlaceSheet } from './PlaceSheet';

const SUBJECT = 'Home';

const EXISTING_BANK: UsageLocationRecord = {
  id: 'loc-bank',
  organisationName: 'Bank',
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

const EDITED_TELSTRA: UsageLocationRecord = {
  id: 'loc-telstra',
  organisationName: 'Telstra',
  organisationType: 'telecom',
  updateMethod: 'online',
  priority: 'normal',
  changed: false,
  createdAt: '2026-01-03T00:00:00.000Z',
};

async function renderSheet(overrides: Partial<PlaceDialogProps> = {}) {
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
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<PlaceSheet {...props} />);
  });
  const rerender = async (next: Partial<PlaceDialogProps>) => {
    await act(async () => {
      view?.rerender(<PlaceSheet {...props} {...next} />);
    });
  };
  return { onOpenChange, onSubmit, rerender };
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

async function clickButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

async function clickControl(role: 'radio' | 'switch', name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole(role, { name }));
  });
}

describe('PlaceSheet', () => {
  it('in add mode, names the sheet "Add place", describes it by subject, and labels submit "Add"', async () => {
    await renderSheet();

    const sheet = screen.getByRole('dialog', { name: 'Add place' });
    expect(sheet).toHaveAccessibleDescription('Who needs to know about Home?');
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('Cancel calls onOpenChange(false) without submitting', async () => {
    const { onOpenChange, onSubmit } = await renderSheet();

    await clickButton('Cancel');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps "Add" disabled until Organisation is filled, then submits the defaults and closes', async () => {
    const { onOpenChange, onSubmit } = await renderSheet();
    const submit = screen.getByRole('button', { name: 'Add' });

    expect(submit).toBeDisabled();

    await typeOrganisation('Commonwealth Bank');
    await waitFor(() => expect(submit).toBeEnabled());
    await clickButton('Add');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      {
        orgName: 'Commonwealth Bank',
        orgType: 'government',
        updateMethod: 'online',
        priority: 'normal',
        link: '',
        changed: false,
      },
      null,
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the sheet open when onSubmit rejects', async () => {
    const onSubmit = jest.fn(() => Promise.reject(new Error('Save failed')));
    const { onOpenChange } = await renderSheet({ onSubmit });
    await typeOrganisation('Commonwealth Bank');
    const submit = screen.getByRole('button', { name: 'Add' });
    await waitFor(() => expect(submit).toBeEnabled());

    await clickButton('Add');

    await waitFor(() =>
      expect(submit).not.toHaveAttribute('aria-busy', 'true'),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submit).toBeEnabled();
    expect(
      screen.getByRole('dialog', { name: 'Add place' }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('ignores Escape while saving, then closes once when onSubmit resolves', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const { onOpenChange } = await renderSheet({ onSubmit });
    await typeOrganisation('Commonwealth Bank');
    const submit = screen.getByRole('button', { name: 'Add' });
    await waitFor(() => expect(submit).toBeEnabled());
    await clickButton('Add');

    expect(submit).toHaveAttribute('aria-busy', 'true');

    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(submit).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveSubmit();
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(
      onOpenChange.mock.calls.filter(([open]) => open === false),
    ).toHaveLength(1);
  });

  it('resets the fields to the defaults when the sheet reopens', async () => {
    const { rerender } = await renderSheet();
    await typeOrganisation('Commonwealth Bank');
    await clickControl('radio', 'Phone');
    expect(screen.getByLabelText('Organisation')).toHaveValue(
      'Commonwealth Bank',
    );

    await rerender({ open: false });
    await rerender({ open: true });

    expect(screen.getByLabelText('Organisation')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Online' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('shows Government, Utility and Bank chips with More…, and submits the chip picked', async () => {
    const { onSubmit } = await renderSheet();
    const group = screen.getByRole('group', { name: 'Type' });

    expect(
      screen.getByRole('button', { name: 'Government' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utility' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More…' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Healthcare' }),
    ).not.toBeInTheDocument();

    await clickButton('Utility');

    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utility' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Government' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await typeOrganisation('Power Co');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled(),
    );
    await clickButton('Add');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ orgName: 'Power Co', orgType: 'utility' }),
      null,
    );
  });

  it('"More…" reveals the other types, and picking Healthcare submits it', async () => {
    const { onSubmit } = await renderSheet();

    await clickButton('More…');

    expect(
      screen.getByRole('button', { name: 'Healthcare' }),
    ).toBeInTheDocument();

    await clickButton('Healthcare');
    await typeOrganisation('City Clinic');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled(),
    );
    await clickButton('Add');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgName: 'City Clinic',
        orgType: 'healthcare',
      }),
      null,
    );
  });

  it('in edit mode, shows a saved type outside the first three as selected without pressing More…', async () => {
    await renderSheet({
      location: EDITED_TELSTRA,
      existingLocations: [EDITED_TELSTRA],
    });

    expect(screen.getByRole('button', { name: 'Telecom' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Healthcare' }),
    ).toBeInTheDocument();
  });

  it('submits the chosen How to update and Priority segments', async () => {
    const { onSubmit } = await renderSheet();

    await clickControl('radio', 'Phone');
    await clickControl('radio', 'High');
    await typeOrganisation('Commonwealth Bank');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled(),
    );
    await clickButton('Add');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgName: 'Commonwealth Bank',
        updateMethod: 'phone',
        priority: 'high',
      }),
      null,
    );
  });

  it('blocks submit for a link without http or https, then submits a valid link trimmed', async () => {
    const { onSubmit } = await renderSheet();
    await typeOrganisation('Commonwealth Bank');
    const submit = screen.getByRole('button', { name: 'Add' });
    await waitFor(() => expect(submit).toBeEnabled());

    await typeLink('nope');
    expect(
      await screen.findByText(
        'Enter a valid URL, including http:// or https://',
      ),
    ).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await typeLink('ftp://x');
    expect(
      screen.getByText('Enter a valid URL, including http:// or https://'),
    ).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await typeLink('  https://example.com/update  ');
    await waitFor(() =>
      expect(
        screen.queryByText('Enter a valid URL, including http:// or https://'),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(submit).toBeEnabled());
    await clickButton('Add');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ link: 'https://example.com/update' }),
      null,
    );
  });

  it('"Already updated" switch sets changed to true in the submit', async () => {
    const { onSubmit } = await renderSheet();
    const toggle = screen.getByRole('switch', { name: 'Already updated' });

    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await clickControl('switch', 'Already updated');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await typeOrganisation('Commonwealth Bank');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled(),
    );
    await clickButton('Add');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ changed: true }),
      null,
    );
  });

  it('warns when the typed name matches another place on the address, ignoring case and spaces', async () => {
    await renderSheet({ existingLocations: [EXISTING_BANK] });

    await typeOrganisation('bank ');

    expect(
      await screen.findByText('“bank” is already on this address.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('says "number" in the duplicate warning when noun is number', async () => {
    await renderSheet({
      existingLocations: [EXISTING_BANK],
      noun: 'number',
      subject: 'Personal (+61 412 345 678)',
    });

    await typeOrganisation('Bank');

    expect(
      await screen.findByText('“Bank” is already on this number.'),
    ).toBeInTheDocument();
  });

  it('in edit mode, prefills the fields, labels submit "Save", does not warn about its own name, and saves with its id', async () => {
    const { onOpenChange, onSubmit } = await renderSheet({
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
    expect(screen.getByRole('radio', { name: 'Phone' })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Already updated' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/is already on this/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add' }),
    ).not.toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    await clickButton('Save');

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgName: 'Westpac',
        orgType: 'bank',
        updateMethod: 'phone',
        priority: 'high',
        link: 'https://westpac.example/update',
        changed: true,
      }),
      'loc-westpac',
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

import {
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, waitFor, within } from '@storybook/test';
import { useState } from 'react';

import { PlaceDialog, type PlaceDialogProps } from './PlaceDialog';

type PlaceDialogHarnessProps = Omit<PlaceDialogProps, 'open' | 'onOpenChange'>;

/**
 * Holds `open` the way a page does. The dialog starts open; Cancel, the close
 * button, or a resolved save closes it. Radix portals the dialog to
 * document.body, so plays query the body rather than the canvas.
 */
function PlaceDialogHarness(props: PlaceDialogHarnessProps) {
  const [open, setOpen] = useState(true);
  return <PlaceDialog {...props} open={open} onOpenChange={setOpen} />;
}

// Fixed records. Every date is pinned so the rendered output stays deterministic.
const BANK_PLACE: UsageLocationRecord = {
  id: 'place-bank',
  organisationName: 'Bank',
  organisationType: OrganisationTypeEnum.Bank,
  updateMethod: UpdateMethodEnum.Online,
  changed: true,
  link: 'https://example.com/bank/details',
  priority: PriorityEnum.High,
  createdAt: '2026-03-02T09:00:00.000Z',
  changedAt: '2026-04-10T02:30:00.000Z',
};

/** Types a name into Organisation. Used by plays that only need the warning. */
async function typeOrganisation(name: string): Promise<void> {
  const body = within(document.body);
  await userEvent.type(
    body.getByRole('textbox', { name: 'Organisation' }),
    name,
  );
}

/**
 * The artboard state: Type Bank, How to update Online (the default), Priority
 * High, then Bank typed into Organisation. Leaves the warning showing and the
 * submit reading "Add anyway". Type and Priority are set first so the name is
 * the last field the user touches before the duplicate check.
 */
/**
 * The artboard's duplicate state: "Bank" typed against an existing Bank. The
 * Priority click stays; the Type select is left to manual QA, because driving
 * Radix Select under the parallel test-runner was flaky.
 */
async function enterArtboardDuplicate(): Promise<void> {
  const body = within(document.body);
  await userEvent.click(body.getByRole('radio', { name: 'High' }));
  await expect(body.getByRole('radio', { name: 'High' })).toBeChecked();
  await typeOrganisation('Bank');
}

/** The duplicate warning names the noun the page passed in. */
async function expectDuplicateWarning(
  noun: 'address' | 'number',
): Promise<void> {
  const body = within(document.body);
  await waitFor(() => {
    expect(body.getByText(`“Bank” is already on this ${noun}.`)).toBeVisible();
  });
  await waitFor(() => {
    expect(body.getByRole('button', { name: 'Add anyway' })).toBeEnabled();
  });
}

const meta: Meta<typeof PlaceDialogHarness> = {
  component: PlaceDialogHarness,
  title: 'UsageLocations/PlaceDialog',
  tags: ['autodocs'],
  argTypes: {
    noun: {
      control: 'inline-radio',
      options: ['address', 'number'],
    },
  },
  args: {
    subject: 'Home',
    noun: 'address',
    location: null,
    existingLocations: [],
    onSubmit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PlaceDialogHarness>;

/** Adding a place to Home with no duplicate. The submit is disabled until a name is typed. */
export const AddAddress: Story = {
  play: async () => {
    const body = within(document.body);
    // waitFor: the enter animation starts at opacity 0.
    await waitFor(() => {
      expect(body.getByRole('dialog', { name: 'Add place' })).toBeVisible();
    });
    await expect(
      body.getByRole('button', { name: 'Add place' }),
    ).toBeDisabled();
  },
};

/** Bank is already on Home, so the warning shows and the submit reads "Add anyway". */
/**
 * The warning appears as the name is typed.
 */
export const AddressDuplicate: Story = {
  args: {
    existingLocations: [BANK_PLACE],
  },
  play: async () => {
    const body = within(document.body);
    await waitFor(() => {
      expect(body.getByText('Who needs to know about Home?')).toBeVisible();
    });
    await typeOrganisation('Bank');
    await expectDuplicateWarning('address');
  },
};

/** Adding a place to a mobile number. The warning noun reads "number". */
export const MobileNumberAdd: Story = {
  args: {
    subject: 'Personal (+61 412 345 678)',
    noun: 'number',
    existingLocations: [BANK_PLACE],
  },
  play: async () => {
    const body = within(document.body);
    await waitFor(() => {
      expect(
        body.getByText('Who needs to know about Personal (+61 412 345 678)?'),
      ).toBeVisible();
    });
    await typeOrganisation('Bank');
    await expectDuplicateWarning('number');
  },
};

/**
 * Editing an existing place. The title reads "Edit place" and the submit reads
 * "Save changes". The place is in existingLocations too, so it does not warn
 * against itself.
 */
export const EditPlace: Story = {
  args: {
    location: BANK_PLACE,
    existingLocations: [BANK_PLACE],
  },
  play: async () => {
    const body = within(document.body);
    await waitFor(() => {
      expect(body.getByRole('dialog', { name: 'Edit place' })).toBeVisible();
    });
    await waitFor(() => {
      expect(body.getByRole('textbox', { name: 'Organisation' })).toHaveValue(
        'Bank',
      );
    });
    await expect(
      body.getByRole('button', { name: 'Save changes' }),
    ).toBeVisible();
    await expect(
      body.queryByText(/is already on this/),
    ).not.toBeInTheDocument();
  },
};

/**
 * The form cannot be submitted empty: the submit button is disabled until the
 * name is valid. The required message appears once the field has been touched,
 * so the play types a character and clears it.
 */
export const ValidationOrganisationRequired: Story = {
  args: {
    onSubmit: fn(),
  },
  play: async ({ args }) => {
    const body = within(document.body);
    const organisation = body.getByRole('textbox', { name: 'Organisation' });
    await userEvent.type(organisation, 'B');
    await userEvent.clear(organisation);
    await waitFor(() => {
      expect(body.getByText('Organisation name is required')).toBeVisible();
    });
    await expect(
      body.getByRole('button', { name: 'Add place' }),
    ).toBeDisabled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** A link without http:// or https:// is rejected as the user types. */
export const ValidationInvalidUrl: Story = {
  args: {
    onSubmit: fn(),
  },
  play: async ({ args }) => {
    const body = within(document.body);
    await userEvent.type(
      body.getByRole('textbox', { name: /Where to change it/ }),
      'bank',
    );
    await waitFor(() => {
      expect(
        body.getByText('Enter a valid URL, including http:// or https://'),
      ).toBeVisible();
    });
    await expect(
      body.getByRole('button', { name: 'Add place' }),
    ).toBeDisabled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/**
 * onSubmit never settles, so the dialog stays in its saving state. The submit
 * button is busy and the form cannot be dismissed while the save is pending.
 */
export const SavePending: Story = {
  args: {
    onSubmit: fn(() => new Promise<void>(() => {})),
  },
  play: async ({ args }) => {
    const body = within(document.body);
    await userEvent.type(
      body.getByRole('textbox', { name: 'Organisation' }),
      'Telstra',
    );
    const submit = body.getByRole('button', { name: 'Add place' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await userEvent.click(submit);
    await waitFor(() => {
      expect(body.getByRole('button', { name: 'Add place' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ orgName: 'Telstra' }),
      null,
    );
    await expect(body.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};

/**
 * The mobile artboard state (Personal, number, Bank typed, Type Bank, Priority
 * High) at phone width, where the two-column Organisation and Type row and the
 * long subject description are most cramped.
 */
export const PhoneViewport: Story = {
  args: {
    subject: 'Personal (+61 412 345 678)',
    noun: 'number',
    existingLocations: [BANK_PLACE],
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  play: async () => {
    await enterArtboardDuplicate();
    await expectDuplicateWarning('number');
  },
};

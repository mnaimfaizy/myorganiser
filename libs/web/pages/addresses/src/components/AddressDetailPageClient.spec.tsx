/* eslint-disable import/first -- jest.mock must precede application imports */
// Mocks sit above every import, so the module graph sees them first.
const mockPush = jest.fn();
const mockUseAddressesPage = jest.fn();
const mockVaultHandle = { isUnlocked: true } as unknown as VaultHandle;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

// The edit sheet's country defaults from the account settings.
jest.mock('@myorganiser/core', () => ({
  ...jest.requireActual('@myorganiser/core'),
  getAccountSettings: jest.fn(() => ({
    countryCode: 'AU',
    preferredCurrency: 'AUD',
  })),
}));

// The page reads its data through the hook; the controller fixture stands in.
jest.mock('../hooks/use-addresses-page', () => ({
  useAddressesPage: (...args: unknown[]) => mockUseAddressesPage(...args),
}));

// Desktop by default; each phone test flips it to true.
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(() => false),
}));

// The locked-vault gate is owned by @myorganiser/web-vault-ui and is out of scope
// here. This mock renders the children straight away with a fake unlocked handle.
jest.mock('@myorganiser/web-vault-ui', () => ({
  VaultGate: ({
    children,
  }: {
    children: (args: { handle: unknown }) => ReactNode;
  }) => children({ handle: mockVaultHandle }),
}));

import type { ReactNode } from 'react';
import type { VaultHandle } from '@myorganiser/web-vault';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  AddressStatusEnum,
  OrganisationTypeEnum,
  PriorityEnum,
  UpdateMethodEnum,
  type UsageLocationRecord,
} from '@myorganiser/vault-core';
import { useIsMobileState } from '@myorganiser/web-ui';
import '@testing-library/jest-dom';
import { AddressDetailPageClient } from './AddressDetailPageClient';
import {
  makeAddressRecord,
  makeAddressesPageController,
  makeUsageLocationRecord,
} from '../testing/addresses-page-controller.fixture';

// Radix popper and checkbox need these browser APIs, which jsdom lacks.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
Element.prototype.scrollIntoView = jest.fn();

/** The Address updated on 3 October of this year, at local noon so the date holds in any zone. */
const UPDATED_ON = new Date(new Date().getFullYear(), 9, 3, 12).toISOString();

function place(
  overrides: Partial<UsageLocationRecord> &
    Pick<UsageLocationRecord, 'id' | 'organisationName'>,
): UsageLocationRecord {
  return { ...makeUsageLocationRecord(overrides.id, false), ...overrides };
}

// Saved in this order on purpose: the page sorts them, so Bank (High) moves above Medicare.
const medicare = place({
  id: 'loc-medicare',
  organisationName: 'Medicare',
  organisationType: OrganisationTypeEnum.Government,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.Normal,
});
const electoral = place({
  id: 'loc-electoral',
  organisationName: 'Electoral roll',
  organisationType: OrganisationTypeEnum.Government,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.High,
  link: 'https://vote.example.com',
  changed: true,
});
const bank = place({
  id: 'loc-bank',
  organisationName: 'Bank',
  organisationType: OrganisationTypeEnum.Bank,
  updateMethod: UpdateMethodEnum.Online,
  priority: PriorityEnum.High,
  link: 'https://bank.example.com/update',
});
const gym = place({
  id: 'loc-gym',
  organisationName: 'Gym',
  organisationType: OrganisationTypeEnum.Private,
  updateMethod: UpdateMethodEnum.Phone,
  priority: PriorityEnum.Normal,
  changed: true,
});
const power = place({
  id: 'loc-power',
  organisationName: 'Power',
  organisationType: OrganisationTypeEnum.Utility,
  updateMethod: UpdateMethodEnum.Mail,
  priority: PriorityEnum.Low,
  changed: true,
});

// Three of the five places are updated, two are still to update.
const home = makeAddressRecord({
  id: 'addr-home',
  label: 'Home',
  propertyNumber: '14',
  street: 'Rose Lane',
  suburb: 'Richmond',
  state: 'VIC',
  zipCode: '3121',
  country: 'Australia',
  status: AddressStatusEnum.Current,
  updatedAt: UPDATED_ON,
  usageLocations: [medicare, electoral, bank, gym, power],
});
const parents = makeAddressRecord({
  id: 'addr-parents',
  label: 'Parents',
  propertyNumber: '7',
  street: 'Harbour Road',
  suburb: 'Hobart',
  state: 'TAS',
  zipCode: '7000',
  country: 'Australia',
  status: AddressStatusEnum.Old,
});

async function renderDetail(
  id = 'addr-home',
  page = makeAddressesPageController([home, parents]),
) {
  mockUseAddressesPage.mockReturnValue(page);
  let view!: ReturnType<typeof render>;
  // Flushed inside act, so the sheet's form validation settles before the test acts.
  await act(async () => {
    view = render(<AddressDetailPageClient params={{ id }} />);
  });
  return { page, ...view };
}

function setPhone(isPhone: boolean) {
  jest.mocked(useIsMobileState).mockReturnValue(isPhone);
}

/** Opens a place's row menu. jsdom has no PointerEvent, so Enter opens it. */
function openRowMenu(organisationName: string) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: `More for ${organisationName}` }),
    { key: 'Enter' },
  );
}

function rowFor(organisationName: string): HTMLElement {
  const row = screen
    .getByRole('checkbox', { name: `Updated at ${organisationName}` })
    .closest<HTMLElement>('li');
  if (!row) throw new Error(`No row for ${organisationName}`);
  return row;
}

function checkboxNames(): Array<string | null> {
  return screen
    .getAllByRole('checkbox')
    .map((box) => box.getAttribute('aria-label'));
}

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);
let writeText: jest.Mock;

describe('AddressDetailPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPhone(false);
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    }
  });

  describe('loading and missing Address', () => {
    it('shows Loading… and no heading while the Addresses are loading', async () => {
      await renderDetail(
        'addr-home',
        makeAddressesPageController([home, parents], { loading: true }),
      );

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1 }),
      ).not.toBeInTheDocument();
    });

    it('shows Address not found and a link back to the list when the id matches no Address', async () => {
      await renderDetail('addr-missing');

      expect(screen.getByText('Address not found.')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Back to addresses' }),
      ).toHaveAttribute('href', '/dashboard/addresses');
    });
  });

  describe('desktop header', () => {
    it('shows the label, the CURRENT pill and the updated line', async () => {
      await renderDetail();

      expect(
        screen.getByRole('heading', { level: 1, name: 'Home' }),
      ).toBeInTheDocument();
      expect(screen.getByText('CURRENT')).toBeInTheDocument();
      expect(
        screen.getByText('Updated 3 Oct · encrypted on this device'),
      ).toBeInTheDocument();
    });

    it('marks a current Address as old from the header button', async () => {
      const { page } = await renderDetail('addr-home');

      fireEvent.click(screen.getByRole('button', { name: 'Mark as old' }));

      expect(page.setAddressStatus).toHaveBeenCalledWith('addr-home', 'old');
    });

    it('marks an old Address as current from the header button', async () => {
      const { page } = await renderDetail('addr-parents');

      expect(screen.getByText('OLD')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mark as current' }));

      expect(page.setAddressStatus).toHaveBeenCalledWith(
        'addr-parents',
        'current',
      );
    });
  });

  describe('desktop copy', () => {
    it('lists each filled field as a copy line, with the Maps link in a new tab', async () => {
      await renderDetail();

      const lines = [
        'Copy Property number: 14',
        'Copy Street: Rose Lane',
        'Copy Suburb: Richmond',
        'Copy State: VIC',
        'Copy Postcode: 3121',
        'Copy Country: Australia',
      ];
      lines.forEach((name) => {
        expect(screen.getByRole('button', { name })).toBeInTheDocument();
      });

      const maps = screen.getByRole('link', { name: /Open in Maps/ });
      expect(maps).toHaveAttribute('target', '_blank');
      expect(maps.getAttribute('href')).toMatch(
        /^https:\/\/www\.google\.com\/maps\/search\//,
      );
    });

    it('copies one line to the clipboard and shows its clears-in-60-s confirmation', async () => {
      await renderDetail();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Copy Postcode: 3121' }),
        );
      });

      expect(writeText).toHaveBeenCalledWith('3121');
      expect(
        await screen.findByText('Postcode copied — clears in 60 s'),
      ).toBeInTheDocument();
    });

    it('Copy all writes the two address lines to the clipboard', async () => {
      await renderDetail();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
      });

      expect(writeText).toHaveBeenCalledWith(
        '14 Rose Lane\nRichmond VIC 3121, Australia',
      );
      expect(
        await screen.findByText('Address copied — clears in 60 s'),
      ).toBeInTheDocument();
    });
  });

  describe('desktop places', () => {
    it('shows how many places are updated, with the progress bar', async () => {
      await renderDetail();

      expect(screen.getByText('3 of 5')).toBeInTheDocument();
      expect(screen.getByText('2 to go')).toBeInTheDocument();
      expect(
        screen.getByRole('progressbar', { name: 'Places updated' }),
      ).toHaveAttribute('aria-valuenow', '3');
    });

    it('lists places still to update first by priority, then the updated ones, with their meta, pills and update links', async () => {
      await renderDetail();

      expect(checkboxNames()).toEqual([
        'Updated at Bank',
        'Updated at Medicare',
        'Updated at Electoral roll',
        'Updated at Gym',
        'Updated at Power',
      ]);

      expect(
        within(rowFor('Bank')).getByText('Bank · online'),
      ).toBeInTheDocument();
      expect(within(rowFor('Bank')).getByText('HIGH')).toBeInTheDocument();
      expect(
        within(rowFor('Medicare')).getByText('Government · online'),
      ).toBeInTheDocument();
      expect(
        within(rowFor('Medicare')).getByText('NORMAL'),
      ).toBeInTheDocument();
      expect(
        within(rowFor('Electoral roll')).getByText('UPDATED'),
      ).toBeInTheDocument();

      // Only a place still to update, with a link, offers "Update online".
      expect(
        within(rowFor('Bank')).getByRole('link', { name: /Update online/ }),
      ).toHaveAttribute('href', 'https://bank.example.com/update');
      expect(
        within(rowFor('Medicare')).queryByRole('link', {
          name: /Update online/,
        }),
      ).not.toBeInTheDocument();
      expect(
        within(rowFor('Electoral roll')).queryByRole('link', {
          name: /Update online/,
        }),
      ).not.toBeInTheDocument();
    });

    it('narrows the list to the places still to update with the To do chip', async () => {
      await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'To do · 2' }));

      expect(screen.getByRole('button', { name: 'To do · 2' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(checkboxNames()).toEqual([
        'Updated at Bank',
        'Updated at Medicare',
      ]);
    });

    it('says every place is updated when the To do chip has nothing left', async () => {
      const done = makeAddressRecord({
        id: 'addr-done',
        label: 'Done',
        status: AddressStatusEnum.Current,
        usageLocations: [electoral, gym, power],
      });
      await renderDetail(
        'addr-done',
        makeAddressesPageController([done, parents]),
      );

      fireEvent.click(screen.getByRole('button', { name: 'To do · 0' }));

      expect(screen.getByText('Every place is updated.')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('keeps the Add place dialog open with its values when saveLocation rejects', async () => {
      const { page } = await renderDetail();
      jest
        .mocked(page.saveLocation)
        .mockRejectedValue(new Error('Save failed'));

      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add place' });
      fireEvent.change(within(dialog).getByLabelText('Organisation'), {
        target: { value: 'Water board' },
      });
      const submit = within(dialog).getByRole('button', { name: 'Add place' });
      await waitFor(() => expect(submit).toBeEnabled());
      await act(async () => {
        fireEvent.click(submit);
      });

      expect(page.saveLocation).toHaveBeenCalledWith(
        'addr-home',
        expect.objectContaining({ orgName: 'Water board' }),
        null,
      );
      const openDialog = screen.getByRole('dialog', { name: 'Add place' });
      expect(within(openDialog).getByLabelText('Organisation')).toHaveValue(
        'Water board',
      );
    });

    it('re-enables a place tick once its save settles without ticking it when the save is refused', async () => {
      const { page } = await renderDetail();
      // The hook reports a failed save as a resolved false, not a rejection.
      let refuse: (saved: boolean) => void = () => undefined;
      jest.mocked(page.setLocationChanged).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            refuse = resolve;
          }),
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole('checkbox', { name: 'Updated at Bank' }),
        );
      });
      expect(
        screen.getByRole('checkbox', { name: 'Updated at Bank' }),
      ).toBeDisabled();

      await act(async () => {
        refuse(false);
      });
      const tick = screen.getByRole('checkbox', { name: 'Updated at Bank' });
      expect(tick).toBeEnabled();
      expect(tick).not.toBeChecked();
    });

    it('closes the place confirm without deleting when Cancel is chosen', async () => {
      const { page } = await renderDetail();

      openRowMenu('Medicare');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete place…' }),
      );
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Medicare"?',
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(page.deleteLocation).not.toHaveBeenCalled();
    });

    it('ticks a place through setLocationChanged', async () => {
      const { page } = await renderDetail();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('checkbox', { name: 'Updated at Bank' }),
        );
      });

      expect(page.setLocationChanged).toHaveBeenCalledWith(
        'addr-home',
        'loc-bank',
        true,
      );
    });

    it('shows the empty state for an Address with no places, and its Add place opens the dialog', async () => {
      const garage = makeAddressRecord({
        id: 'addr-garage',
        label: 'Garage',
        status: AddressStatusEnum.Current,
        usageLocations: [],
      });
      await renderDetail(
        'addr-garage',
        makeAddressesPageController([garage, parents]),
      );

      expect(screen.getByText('No places yet')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Add every organisation that needs to be told about this address.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

      // The empty state's own button, not the header one beside it.
      const emptyState = screen.getByText('No places yet')
        .parentElement as HTMLElement;
      fireEvent.click(
        within(emptyState).getByRole('button', { name: 'Add place' }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'Add place' });
      expect(
        within(dialog).getByText('Who needs to know about Garage?'),
      ).toBeInTheDocument();
    });
  });

  describe('place dialog and confirm', () => {
    it('adds a place through the dialog and saves it with no location id', async () => {
      const { page } = await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add place' });
      expect(
        within(dialog).getByText('Who needs to know about Home?'),
      ).toBeInTheDocument();

      fireEvent.change(within(dialog).getByLabelText('Organisation'), {
        target: { value: 'Water board' },
      });
      const submit = within(dialog).getByRole('button', { name: 'Add place' });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);

      await waitFor(() =>
        expect(page.saveLocation).toHaveBeenCalledWith(
          'addr-home',
          expect.objectContaining({ orgName: 'Water board' }),
          null,
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add place' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('edits a place from its row menu and saves it under its own location id', async () => {
      const { page } = await renderDetail();

      openRowMenu('Bank');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Edit place' }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'Edit place' });
      expect(within(dialog).getByLabelText('Organisation')).toHaveValue('Bank');
      const save = within(dialog).getByRole('button', { name: 'Save changes' });
      await waitFor(() => expect(save).toBeEnabled());
      fireEvent.click(save);

      await waitFor(() =>
        expect(page.saveLocation).toHaveBeenCalledWith(
          'addr-home',
          expect.objectContaining({
            orgName: 'Bank',
            link: 'https://bank.example.com/update',
          }),
          'loc-bank',
        ),
      );
    });

    it('deletes a place once its confirm is accepted', async () => {
      const { page } = await renderDetail();

      openRowMenu('Medicare');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete place…' }),
      );

      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Medicare"?',
      });
      expect(
        within(dialog).getByText(
          'This action cannot be undone. This usage location will be permanently removed from this address.',
        ),
      ).toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete place' }),
      );

      await waitFor(() =>
        expect(page.deleteLocation).toHaveBeenCalledWith(
          'addr-home',
          'loc-medicare',
        ),
      );
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
    });

    it('keeps the place confirm open when deleteLocation returns false', async () => {
      const { page } = await renderDetail();
      jest.mocked(page.deleteLocation).mockResolvedValue(false);

      openRowMenu('Medicare');
      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'Delete place…' }),
      );
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Medicare"?',
      });

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete place' }),
        );
      });

      expect(page.deleteLocation).toHaveBeenCalledWith(
        'addr-home',
        'loc-medicare',
      );
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Medicare"?' }),
      ).toBeInTheDocument();
    });
  });

  describe('edit address', () => {
    it('prefills the edit sheet from the Address and saves it through updateAddress', async () => {
      const { page } = await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Edit address' }));
      const sheet = await screen.findByRole('dialog', { name: 'Edit address' });

      expect(within(sheet).getByLabelText('Label')).toHaveValue('Home');
      expect(within(sheet).getByLabelText('Number')).toHaveValue('14');
      expect(within(sheet).getByLabelText('Street')).toHaveValue('Rose Lane');
      expect(within(sheet).getByLabelText('Suburb or city')).toHaveValue(
        'Richmond',
      );
      expect(within(sheet).getByLabelText('State')).toHaveValue('VIC');
      expect(within(sheet).getByLabelText('Postcode')).toHaveValue('3121');

      fireEvent.change(within(sheet).getByLabelText('Label'), {
        target: { value: 'Main home' },
      });
      const save = within(sheet).getByRole('button', { name: 'Save changes' });
      await waitFor(() => expect(save).toBeEnabled());
      fireEvent.click(save);

      await waitFor(() =>
        expect(page.updateAddress).toHaveBeenCalledWith(
          'addr-home',
          expect.objectContaining({
            label: 'Main home',
            street: 'Rose Lane',
            zipCode: '3121',
            countryCode: 'AU',
          }),
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Edit address' }),
        ).not.toBeInTheDocument(),
      );
    });
  });

  describe('delete address', () => {
    it('shows the danger zone, then deletes and goes to the list without an Address not found flash', async () => {
      const { page, rerender } = await renderDetail();

      const danger = screen.getByRole('region', {
        name: 'Delete this address',
      });
      expect(
        within(danger).getByText('Its 5 places go with it, on every device.'),
      ).toBeInTheDocument();

      fireEvent.click(within(danger).getByRole('button', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });
      expect(
        within(dialog).getByText(
          'This action cannot be undone. The address and its 5 usage locations will be permanently removed.',
        ),
      ).toBeInTheDocument();

      let finishDelete: (deleted: boolean) => void = () => undefined;
      jest.mocked(page.deleteAddress).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishDelete = resolve;
          }),
      );
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete address' }),
      );
      await waitFor(() =>
        expect(page.deleteAddress).toHaveBeenCalledWith('addr-home'),
      );

      // The record leaves the list before the delete resolves.
      mockUseAddressesPage.mockReturnValue({ ...page, items: [parents] });
      rerender(<AddressDetailPageClient params={{ id: 'addr-home' }} />);
      expect(screen.queryByText('Address not found.')).not.toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();

      await act(async () => {
        finishDelete(true);
      });
      expect(mockPush).toHaveBeenCalledWith('/dashboard/addresses');
      expect(screen.queryByText('Address not found.')).not.toBeInTheDocument();
    });

    it('closes the address confirm without deleting or navigating when Cancel is chosen', async () => {
      const { page } = await renderDetail();

      const danger = screen.getByRole('region', {
        name: 'Delete this address',
      });
      fireEvent.click(within(danger).getByRole('button', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      );
      expect(page.deleteAddress).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Home' }),
      ).toBeInTheDocument();
    });

    it('keeps the confirm open and stays on the detail when the delete is refused', async () => {
      const { page } = await renderDetail();
      jest.mocked(page.deleteAddress).mockResolvedValue(false);

      const danger = screen.getByRole('region', {
        name: 'Delete this address',
      });
      fireEvent.click(within(danger).getByRole('button', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });

      await act(async () => {
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete address' }),
        );
      });

      expect(page.deleteAddress).toHaveBeenCalledWith('addr-home');
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Home"?' }),
      ).toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('phone', () => {
    beforeEach(() => {
      setPhone(true);
    });

    it('draws one title, the copy lines and the footer actions, and a copied line goes to the clipboard', async () => {
      await renderDetail();

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Home' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Tap a line to copy it')).toBeInTheDocument();

      expect(
        screen.getByRole('button', { name: 'Copy Street: 14 Rose Lane' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Copy Suburb: Richmond VIC 3121' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Copy Country: Australia' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Copy Property number/ }),
      ).not.toBeInTheDocument();

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'PLACES TO UPDATE · 3 OF 5',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Mark as old' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Delete…' }),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'Copy Suburb: Richmond VIC 3121',
          }),
        );
      });
      expect(writeText).toHaveBeenCalledWith('Richmond VIC 3121');
      expect(
        await screen.findByText('Suburb copied — clears in 60 s'),
      ).toBeInTheDocument();
    });

    it('opens the place sheet from Add place', async () => {
      await renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Add place' }));

      const sheet = await screen.findByRole('dialog', { name: 'Add place' });
      expect(within(sheet).getByLabelText('Organisation')).toBeInTheDocument();
    });

    it('lists the places still to update and keeps updated ones behind the Updated disclosure', async () => {
      await renderDetail();

      expect(checkboxNames()).toEqual([
        'Updated at Bank',
        'Updated at Medicare',
      ]);

      const toggle = screen.getByRole('button', { name: 'Updated · 3' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('checkbox', { name: 'Updated at Electoral roll' }),
      ).not.toBeInTheDocument();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(
        await screen.findByRole('checkbox', {
          name: 'Updated at Electoral roll',
        }),
      ).toBeInTheDocument();
    });
  });
});

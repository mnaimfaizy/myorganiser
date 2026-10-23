/* eslint-disable import/first -- jest.mock must precede application imports */
// Mocks sit above every import, so the module graph sees them first.
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

// The add sheet's country defaults from the account settings.
jest.mock('@myorganiser/core', () => ({
  ...jest.requireActual('@myorganiser/core'),
  getAccountSettings: jest.fn(() => ({
    countryCode: 'AU',
    preferredCurrency: 'AUD',
  })),
}));

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { AddressStatusEnum, type AddressRecord } from '@myorganiser/vault-core';
import { AddressesBoard } from './addresses-board';
import {
  makeAddressRecord,
  makeAddressesPageController,
  makeUsageLocationRecord,
} from '../testing/addresses-page-controller.fixture';

// Radix popper and select need these browser APIs, which jsdom lacks.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
Element.prototype.scrollIntoView = jest.fn();

const places = (count: number, changed: number) =>
  Array.from({ length: count }, (_, index) =>
    makeUsageLocationRecord(`place-${count}-${index}`, index < changed),
  );

// Two places still to update across the list: Home has 2 left, the others none.
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
  usageLocations: places(3, 1),
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
  usageLocations: [],
});
const flat = makeAddressRecord({
  id: 'addr-flat',
  label: 'Flat',
  propertyNumber: '3',
  street: 'Albert Street',
  suburb: 'Melbourne',
  state: 'VIC',
  zipCode: '3000',
  country: 'Australia',
  status: AddressStatusEnum.Old,
  usageLocations: places(6, 6),
});

const FIXTURE: AddressRecord[] = [home, parents, flat];

/** The card that holds the address's label link. */
function cardFor(label: string): HTMLElement {
  const card = screen
    .getByRole('link', { name: label })
    .closest<HTMLElement>('article');
  if (!card) throw new Error(`No card holds the link for ${label}`);
  return card;
}

/**
 * Opens the row menu for an address. jsdom has no PointerEvent, so Radix's
 * pointerdown trigger cannot fire; its Enter key handler opens the same menu.
 */
function openRowMenu(label: string) {
  fireEvent.keyDown(
    screen.getByRole('button', { name: `Actions for ${label}` }),
    { key: 'Enter' },
  );
}

/** Types into an add-sheet field found by its label. */
function typeInto(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

/** Fills every add-sheet field except Street, so a test can isolate it. */
function fillFieldsExceptStreet(dialog: HTMLElement) {
  typeInto(dialog, 'Number', '221');
  typeInto(dialog, 'Suburb or city', 'London');
  typeInto(dialog, 'State', 'Greater London');
  typeInto(dialog, 'Postcode', 'NW1 6XE');
}

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);

describe('AddressesBoard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    }
  });

  describe('desktop', () => {
    it('shows the heading and no empty state while loading', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController([], { loading: true })}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Addresses' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'No addresses yet' }),
      ).not.toBeInTheDocument();
    });

    it('shows the empty state with its tips, and its Add button opens the sheet', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController([])}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'No addresses yet' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Save the places you live or have lived. When you move, list everyone who needs your new address and tick them off as you go.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Copy any line in one click'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('A checklist of who needs your new address'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Mark old addresses without losing them'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));

      expect(
        screen.getByRole('dialog', { name: 'Add address' }),
      ).toBeInTheDocument();
    });

    it('shows the header summary, a detail link and a status pill for each card', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      expect(
        screen.getByText('3 addresses · 1 current · 2 places still to update'),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
        'href',
        '/dashboard/addresses/addr-home',
      );
      expect(screen.getByRole('link', { name: 'Parents' })).toHaveAttribute(
        'href',
        '/dashboard/addresses/addr-parents',
      );
      expect(within(cardFor('Home')).getByText('CURRENT')).toBeInTheDocument();
      expect(within(cardFor('Parents')).getByText('OLD')).toBeInTheDocument();
    });

    it('shows each address progress and its named progress bar', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      const homeCard = cardFor('Home');
      expect(
        within(homeCard).getByText('1 of 3 places updated'),
      ).toBeInTheDocument();
      expect(within(homeCard).getByText('2 to go')).toBeInTheDocument();
      expect(
        within(homeCard).getByRole('progressbar', {
          name: 'Places updated for Home',
        }),
      ).toBeInTheDocument();

      const parentsCard = cardFor('Parents');
      expect(
        within(parentsCard).getByText('No places added yet'),
      ).toBeInTheDocument();
      expect(within(parentsCard).getByText('Add places')).toBeInTheDocument();

      const flatCard = cardFor('Flat');
      expect(
        within(flatCard).getByText('6 of 6 places updated'),
      ).toBeInTheDocument();
      expect(within(flatCard).getByText('All updated')).toBeInTheDocument();
    });

    it('narrows the cards to the addresses that match the filter text', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.change(
        screen.getByRole('textbox', { name: 'Filter addresses' }),
        {
          target: { value: 'parents' },
        },
      );

      expect(screen.getByRole('link', { name: 'Parents' })).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Home' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Flat' }),
      ).not.toBeInTheDocument();
    });

    it('shows the no-match message when the filter text matches nothing', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.change(
        screen.getByRole('textbox', { name: 'Filter addresses' }),
        {
          target: { value: 'zzz' },
        },
      );

      expect(
        screen.getByText('No addresses match your search.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });

    it('filters by status from the chips and marks the chosen chip as pressed', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      const current = screen.getByRole('button', { name: 'Current · 1' });
      const old = screen.getByRole('button', { name: 'Old · 2' });
      expect(screen.getByRole('button', { name: 'All · 3' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      fireEvent.click(current);
      expect(current).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Parents' }),
      ).not.toBeInTheDocument();

      fireEvent.click(old);
      expect(old).toHaveAttribute('aria-pressed', 'true');
      expect(current).toHaveAttribute('aria-pressed', 'false');
      expect(
        screen.queryByRole('link', { name: 'Home' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Parents' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Flat' })).toBeInTheDocument();
    });

    it('copies the two-line address and announces that it clears', async () => {
      const writeText = jest.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(
        within(cardFor('Home')).getByRole('button', { name: 'Copy address' }),
      );

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Address copied — clears in 60 s',
        );
      });
      expect(writeText).toHaveBeenCalledWith(
        '14 Rose Lane\nRichmond VIC 3121, Australia',
      );
    });

    it('deletes the address when the confirm dialog is confirmed and the delete succeeds', async () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="desktop" />);

      openRowMenu('Home');
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));

      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });
      expect(
        within(dialog).getByText(
          'This action cannot be undone. The address and its 3 usage locations will be permanently removed.',
        ),
      ).toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete address' }),
      );

      await waitFor(() => {
        expect(page.deleteAddress).toHaveBeenCalledWith('addr-home');
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('alertdialog', { name: 'Delete "Home"?' }),
        ).not.toBeInTheDocument();
      });
    });

    it('keeps the confirm dialog open when the delete fails', async () => {
      const page = makeAddressesPageController(FIXTURE);
      jest.mocked(page.deleteAddress).mockResolvedValue(false);
      render(<AddressesBoard page={page} variant="desktop" />);

      openRowMenu('Home');
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete address' }),
      );

      await waitFor(() => {
        expect(page.deleteAddress).toHaveBeenCalledWith('addr-home');
      });
      // The dialog settles back to its idle confirm label, and stays mounted.
      await waitFor(() => {
        expect(
          within(dialog).getByRole('button', { name: 'Delete address' }),
        ).toBeEnabled();
      });
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Home"?' }),
      ).toBeInTheDocument();
    });

    it('closes the confirm dialog on cancel without deleting', async () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="desktop" />);

      openRowMenu('Home');
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(
          screen.queryByRole('alertdialog', { name: 'Delete "Home"?' }),
        ).not.toBeInTheDocument();
      });
      expect(page.deleteAddress).not.toHaveBeenCalled();
    });

    it('saves a new address, shows the saved panel and opens its usage locations', async () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      const dialog = screen.getByRole('dialog', { name: 'Add address' });
      typeInto(dialog, 'Label', 'Work');
      typeInto(dialog, 'Number', '221');
      typeInto(dialog, 'Street', 'Baker Street');
      typeInto(dialog, 'Suburb or city', 'London');
      typeInto(dialog, 'State', 'Greater London');
      typeInto(dialog, 'Postcode', 'NW1 6XE');

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save address' }),
      );

      await waitFor(() => {
        expect(page.addAddress).toHaveBeenCalledWith(
          expect.objectContaining({
            label: 'Work',
            propertyNumber: '221',
            street: 'Baker Street',
            suburb: 'London',
            state: 'Greater London',
            zipCode: 'NW1 6XE',
            countryCode: 'AU',
          }),
        );
      });
      expect(
        await within(dialog).findByRole('heading', { name: 'Address saved' }),
      ).toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Set up usage locations' }),
      );
      expect(mockPush).toHaveBeenCalledWith('/dashboard/addresses/addr-new');
    });

    it('resets the add form to its defaults, keeping the label, on Add another address', async () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      const dialog = screen.getByRole('dialog', { name: 'Add address' });
      typeInto(dialog, 'Label', 'Work');
      typeInto(dialog, 'Number', '221');
      typeInto(dialog, 'Street', 'Baker Street');
      typeInto(dialog, 'Suburb or city', 'London');
      typeInto(dialog, 'State', 'Greater London');
      typeInto(dialog, 'Postcode', 'NW1 6XE');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save address' }),
      );

      await within(dialog).findByRole('heading', { name: 'Address saved' });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Add another address' }),
      );

      expect(
        within(dialog).queryByRole('heading', { name: 'Address saved' }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByLabelText('Street')).toHaveValue('');
      expect(within(dialog).getByLabelText('Label')).toHaveValue('Work');
      expect(
        within(dialog).getByRole('button', { name: 'Save address' }),
      ).toBeInTheDocument();
    });

    it('shows the street error and does not save when Street is empty', async () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      const dialog = screen.getByRole('dialog', { name: 'Add address' });
      fillFieldsExceptStreet(dialog);

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save address' }),
      );

      expect(
        await within(dialog).findByText('Street is required'),
      ).toBeInTheDocument();
      expect(page.addAddress).not.toHaveBeenCalled();
    });

    it('warns about a duplicate and saves it in one click with Save anyway', async () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      const dialog = screen.getByRole('dialog', { name: 'Add address' });
      typeInto(dialog, 'Number', '14');
      typeInto(dialog, 'Street', 'Rose Lane');
      typeInto(dialog, 'Suburb or city', 'Richmond');
      typeInto(dialog, 'State', 'VIC');
      typeInto(dialog, 'Postcode', '3121');

      expect(
        await within(dialog).findByText('You already have this address'),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          /It matches “Home”\. Save another copy only if you need both\./,
        ),
      ).toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save anyway' }),
      );

      await waitFor(() => {
        expect(page.addAddress).toHaveBeenCalledTimes(1);
      });
      expect(page.addAddress).toHaveBeenCalledWith(
        expect.objectContaining({ street: 'Rose Lane', countryCode: 'AU' }),
      );
    });

    it('keeps the saved panel when the first address arrives and the list replaces the empty state', async () => {
      const saved = makeAddressRecord({
        id: 'addr-work',
        label: 'Work',
        propertyNumber: '221',
        street: 'Baker Street',
        suburb: 'London',
        state: 'Greater London',
        zipCode: 'NW1 6XE',
        country: 'Australia',
      });
      const page = makeAddressesPageController([]);
      jest.mocked(page.addAddress).mockResolvedValue(saved);
      const { rerender } = render(
        <AddressesBoard page={page} variant="desktop" />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      const dialog = screen.getByRole('dialog', { name: 'Add address' });
      typeInto(dialog, 'Label', 'Work');
      typeInto(dialog, 'Number', '221');
      typeInto(dialog, 'Street', 'Baker Street');
      typeInto(dialog, 'Suburb or city', 'London');
      typeInto(dialog, 'State', 'Greater London');
      typeInto(dialog, 'Postcode', 'NW1 6XE');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save address' }),
      );

      await within(dialog).findByRole('heading', { name: 'Address saved' });

      // The real hook now holds the saved record, so the board leaves its empty state.
      rerender(
        <AddressesBoard
          page={makeAddressesPageController([saved])}
          variant="desktop"
        />,
      );

      expect(screen.getByRole('dialog', { name: 'Add address' })).toBe(dialog);
      expect(
        within(dialog).getByRole('heading', { name: 'Address saved' }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Set up usage locations' }),
      ).toBeInTheDocument();
    });

    it('keeps the add sheet open with its values when the save is rejected', async () => {
      const page = makeAddressesPageController(FIXTURE);
      jest.mocked(page.addAddress).mockRejectedValue(new Error('Save failed'));
      render(<AddressesBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      const dialog = screen.getByRole('dialog', { name: 'Add address' });
      typeInto(dialog, 'Number', '221');
      typeInto(dialog, 'Street', 'Baker Street');
      typeInto(dialog, 'Suburb or city', 'London');
      typeInto(dialog, 'State', 'Greater London');
      typeInto(dialog, 'Postcode', 'NW1 6XE');

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save address' }),
      );

      await waitFor(() => {
        expect(page.addAddress).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(
          within(dialog).getByRole('button', { name: 'Save address' }),
        ).toBeEnabled();
      });
      expect(
        screen.getByRole('dialog', { name: 'Add address' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Street')).toHaveValue(
        'Baker Street',
      );
      expect(
        within(dialog).queryByRole('heading', { name: 'Address saved' }),
      ).not.toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('phone', () => {
    it('shows the summary and a detail row for each address, with the add button as the FAB', () => {
      const page = makeAddressesPageController(FIXTURE);
      render(<AddressesBoard page={page} variant="phone" />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Addresses' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('3 saved · 2 places to update'),
      ).toBeInTheDocument();

      const homeRow = screen.getByRole('link', { name: /^Home/ });
      expect(homeRow).toHaveAttribute('href', '/dashboard/addresses/addr-home');
      expect(
        within(homeRow).getByText('14 Rose Lane, Richmond VIC 3121'),
      ).toBeInTheDocument();
      expect(
        within(homeRow).getByText('1 of 3 places updated'),
      ).toBeInTheDocument();

      const parentsRow = screen.getByRole('link', { name: /^Parents/ });
      expect(within(parentsRow).getByText('No places yet')).toBeInTheDocument();

      const flatRow = screen.getByRole('link', { name: /^Flat/ });
      expect(
        within(flatRow).getByText('All 6 places updated'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
      expect(
        screen.getByRole('dialog', { name: 'Add address' }),
      ).toBeInTheDocument();
    });

    it('shows the no-match message when the phone filter matches nothing', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController(FIXTURE)}
          variant="phone"
        />,
      );

      fireEvent.change(
        screen.getByRole('textbox', { name: 'Filter addresses' }),
        {
          target: { value: 'zzz' },
        },
      );

      expect(
        screen.getByText('No addresses match your search.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /^Home/ }),
      ).not.toBeInTheDocument();
    });

    it('shows the empty line under a single page heading when there are no addresses', () => {
      render(
        <AddressesBoard
          page={makeAddressesPageController([])}
          variant="phone"
        />,
      );

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Addresses' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'No addresses yet' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Save the places you live or have lived, and track who needs your new address when you move.',
        ),
      ).toBeInTheDocument();
    });
  });
});

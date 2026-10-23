/* eslint-disable import/first -- jest.mock must precede application imports */
// Mocks sit above every import, so the module graph sees them first.
// The page client reads the breakpoint and the vault; the board reads neither,
// so the board tests run against the real web-ui and copy hook.
jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  VaultGate: ({ children }: { children: (args: unknown) => unknown }) =>
    children({ handle: {} }),
}));

jest.mock('../hooks/use-mobile-numbers-page', () => ({
  useMobileNumbersPage: jest.fn(),
}));

import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useIsMobileState } from '@myorganiser/web-ui';
import { useMobileNumbersPage } from '../hooks/use-mobile-numbers-page';
import { MobileNumbersBoard } from './mobile-numbers-board';
import { MobileNumbersPageClient } from './MobileNumbersPageClient';
import {
  makeMobileNumberRecord,
  makeMobileNumbersPageController,
  makeUsageLocationRecord,
} from '../testing/mobile-numbers-page-controller.fixture';

// Home has two places, one still to update. Work has none.
const home = makeMobileNumberRecord({
  id: 'mob-home',
  label: 'Home',
  countryCode: '+61',
  phoneNumber: '412345678',
  usageLocations: [
    makeUsageLocationRecord('loc-home-1', true),
    makeUsageLocationRecord('loc-home-2', false),
  ],
});
const work = makeMobileNumberRecord({
  id: 'mob-work',
  label: 'Work',
  countryCode: '+49',
  phoneNumber: '498765432',
  usageLocations: [],
});

const FIXTURE = [home, work];

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);

/** Types into an add-dialog field found by its label. */
function typeInto(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value },
  });
}

describe('MobileNumbersBoard', () => {
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
    it('shows the heading and no list or empty state while loading', () => {
      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController([], { loading: true })}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Mobile numbers' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'No mobile numbers yet' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Mobile numbers' }),
      ).not.toBeInTheDocument();
    });

    it('shows the empty state with its tips, and its Add button opens the dialog', () => {
      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController([])}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'No mobile numbers yet' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Copy or call in one click')).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Add mobile number' }),
      );

      expect(
        screen.getByRole('dialog', { name: 'Add mobile number' }),
      ).toBeInTheDocument();
    });

    it('shows the summary, a detail link, a tel link and a status pill for each number', () => {
      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      expect(
        screen.getByText('2 numbers · 1 place still to update'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('region', { name: 'Mobile numbers' }),
      ).toBeInTheDocument();

      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
        'href',
        '/dashboard/mobile-numbers/mob-home',
      );
      expect(screen.getByRole('link', { name: 'Work' })).toHaveAttribute(
        'href',
        '/dashboard/mobile-numbers/mob-work',
      );
      expect(screen.getByRole('link', { name: 'Open Home' })).toHaveAttribute(
        'href',
        '/dashboard/mobile-numbers/mob-home',
      );
      expect(screen.getByRole('link', { name: 'Call Home' })).toHaveAttribute(
        'href',
        'tel:+61412345678',
      );
      expect(screen.getByRole('link', { name: 'Call Work' })).toHaveAttribute(
        'href',
        'tel:+49498765432',
      );

      expect(screen.getByText('+61 412 345 678')).toBeInTheDocument();
      expect(screen.getByText('1 of 2 places updated')).toBeInTheDocument();
      expect(screen.getByText('No places')).toBeInTheDocument();
    });

    it('narrows the rows by label or digits, and shows the no-match line when nothing matches', () => {
      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController(FIXTURE)}
          variant="desktop"
        />,
      );
      const filter = screen.getByRole('textbox', {
        name: 'Filter mobile numbers',
      });

      fireEvent.change(filter, { target: { value: 'work' } });
      expect(screen.getByRole('link', { name: 'Work' })).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Home' }),
      ).not.toBeInTheDocument();

      fireEvent.change(filter, { target: { value: '498 765' } });
      expect(screen.getByRole('link', { name: 'Work' })).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Home' }),
      ).not.toBeInTheDocument();

      fireEvent.change(filter, { target: { value: 'zzz' } });
      expect(
        screen.getByText('No mobile numbers match your search.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Mobile numbers' }),
      ).not.toBeInTheDocument();
    });

    it('copies the formatted number and announces that it clears', async () => {
      const writeText = jest.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy Home number' }));

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Copied — clears in 60 s',
        );
      });
      expect(writeText).toHaveBeenCalledWith('+61 412 345 678');
    });

    it('says the copy failed when the browser refuses the write', async () => {
      const writeText = jest.fn(async () => {
        throw new Error('Permission denied');
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy Home number' }));

      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(
          'Could not copy. Select the text and copy it instead.',
        );
      });
    });

    it('deletes the number when the confirm dialog is confirmed and the delete succeeds', async () => {
      const page = makeMobileNumbersPageController(FIXTURE);
      render(<MobileNumbersBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));

      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });
      expect(
        within(dialog).getByText(
          'This action cannot be undone. The mobile number and its 2 usage locations will be permanently removed.',
        ),
      ).toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete mobile number' }),
      );

      await waitFor(() => {
        expect(page.deleteMobileNumber).toHaveBeenCalledWith('mob-home');
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('alertdialog', { name: 'Delete "Home"?' }),
        ).not.toBeInTheDocument();
      });
    });

    it('keeps the confirm dialog open when the delete fails', async () => {
      const page = makeMobileNumbersPageController(FIXTURE);
      jest.mocked(page.deleteMobileNumber).mockResolvedValue(false);
      render(<MobileNumbersBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete mobile number' }),
      );

      await waitFor(() => {
        expect(page.deleteMobileNumber).toHaveBeenCalledWith('mob-home');
      });
      // The dialog settles back to its idle confirm label, and stays mounted.
      await waitFor(() => {
        expect(
          within(dialog).getByRole('button', { name: 'Delete mobile number' }),
        ).toBeEnabled();
      });
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Home"?' }),
      ).toBeInTheDocument();
    });

    it('closes the confirm dialog on cancel without deleting', async () => {
      const page = makeMobileNumbersPageController(FIXTURE);
      render(<MobileNumbersBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Delete "Home"?',
      });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(
          screen.queryByRole('alertdialog', { name: 'Delete "Home"?' }),
        ).not.toBeInTheDocument();
      });
      expect(page.deleteMobileNumber).not.toHaveBeenCalled();
    });

    it('adds a number with the form values and closes the dialog when the save succeeds', async () => {
      const page = makeMobileNumbersPageController(FIXTURE);
      render(<MobileNumbersBoard page={page} variant="desktop" />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Add mobile number' }),
      );
      const dialog = screen.getByRole('dialog', { name: 'Add mobile number' });
      typeInto(dialog, 'Label', 'Office');
      typeInto(dialog, 'Phone Number', '5551234567');

      const submit = within(dialog).getByRole('button', {
        name: 'Add mobile number',
      });
      await waitFor(() => {
        expect(submit).toBeEnabled();
      });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(page.addMobileNumber).toHaveBeenCalledWith({
          label: 'Office',
          countryCode: '+1',
          phoneNumber: '5551234567',
        });
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Add mobile number' }),
        ).not.toBeInTheDocument();
      });
    });

    it('keeps the add dialog open with its values when the save is rejected', async () => {
      const page = makeMobileNumbersPageController(FIXTURE);
      jest
        .mocked(page.addMobileNumber)
        .mockRejectedValue(new Error('Save failed'));
      render(<MobileNumbersBoard page={page} variant="desktop" />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Add mobile number' }),
      );
      const dialog = screen.getByRole('dialog', { name: 'Add mobile number' });
      typeInto(dialog, 'Label', 'Office');
      typeInto(dialog, 'Phone Number', '5551234567');

      const submit = within(dialog).getByRole('button', {
        name: 'Add mobile number',
      });
      await waitFor(() => {
        expect(submit).toBeEnabled();
      });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(page.addMobileNumber).toHaveBeenCalledTimes(1);
      });
      // The rejection settles, the button is enabled again, and the dialog stays open.
      await waitFor(() => {
        expect(submit).toBeEnabled();
      });
      expect(
        screen.getByRole('dialog', { name: 'Add mobile number' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Label')).toHaveValue('Office');
    });
  });

  describe('phone', () => {
    it('shows the summary and a navigation row for each number, with the add button as the FAB', () => {
      const page = makeMobileNumbersPageController(FIXTURE);
      render(<MobileNumbersBoard page={page} variant="phone" />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Mobile numbers' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('2 saved · 1 place to update'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: 'Filter mobile numbers' }),
      ).not.toBeInTheDocument();

      const homeRow = screen.getByRole('link', { name: /^Home/ });
      expect(homeRow).toHaveAttribute(
        'href',
        '/dashboard/mobile-numbers/mob-home',
      );
      expect(screen.getByRole('link', { name: 'Call Home' })).toHaveAttribute(
        'href',
        'tel:+61412345678',
      );
      expect(
        screen.getByRole('button', { name: 'Copy Home number' }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Add mobile number' }),
      );
      expect(
        screen.getByRole('dialog', { name: 'Add mobile number' }),
      ).toBeInTheDocument();
    });

    it('shows the empty line under a single page heading when there are no numbers', () => {
      render(
        <MobileNumbersBoard
          page={makeMobileNumbersPageController([])}
          variant="phone"
        />,
      );

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { name: 'No mobile numbers yet' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Keep your numbers in one place and copy or call them in a tap.',
        ),
      ).toBeInTheDocument();
    });
  });
});

describe('MobileNumbersPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(useMobileNumbersPage)
      .mockReturnValue(makeMobileNumbersPageController(FIXTURE));
  });

  it('renders nothing until the breakpoint is decided', () => {
    jest.mocked(useIsMobileState).mockReturnValue(undefined);

    const { container } = render(<MobileNumbersPageClient />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the desktop board once the breakpoint says the viewport is not a phone', () => {
    jest.mocked(useIsMobileState).mockReturnValue(false);

    render(<MobileNumbersPageClient />);

    expect(
      screen.getByText('2 numbers · 1 place still to update'),
    ).toBeInTheDocument();
  });
});

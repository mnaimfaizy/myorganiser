/* eslint-disable import/first */
// Mocks sit above every import, so the module graph sees them first.
// The form surfaces get their own suite; here they are stubs that expose the
// props the board passes (open, mode, initialValues) and a submit button.
jest.mock('./subscription-form-dialog', () => ({
  SubscriptionFormDialog: (props: unknown) => mockFormStub(props),
}));

jest.mock('./subscription-form-sheet', () => ({
  SubscriptionFormSheet: (props: unknown) => mockFormStub(props),
}));

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { SubscriptionsBoard } from './subscriptions-board';
import {
  makeSubscriptionRecord,
  makeSubscriptionsPageController,
} from '../testing/subscriptions-page-controller.fixture';

interface FormStubProps {
  open: boolean;
  mode: 'add' | 'edit';
  initialValues: { name: string; currency: string };
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { name: string; currency: string }) => Promise<void>;
}

/** Stands in for the real form surfaces: shows what the board handed it and submits a renamed copy. */
function mockFormStub(props: unknown) {
  const { open, mode, initialValues, onOpenChange, onSubmit } =
    props as FormStubProps;
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={mode === 'edit' ? 'Edit subscription' : 'Add subscription'}
    >
      <p>{`Mode: ${mode}`}</p>
      <p>{`Name: ${initialValues.name}`}</p>
      <p>{`Currency: ${initialValues.currency}`}</p>
      <button
        type="button"
        onClick={() => {
          void onSubmit({ ...initialValues, name: 'Renamed plan' }).then(
            () => onOpenChange(false),
            () => undefined,
          );
        }}
      >
        Submit form
      </button>
    </div>
  );
}

// Polyfill ResizeObserver for Radix UI components (Select, Dialog).
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Radix Select scrolls the selected item into view, which jsdom lacks.
Element.prototype.scrollIntoView = jest.fn();

// Sun 18 Oct 2026, 10:00 local. Wed 20 Oct is two days out, so Spotify renews soon.
const NOW = new Date(2026, 9, 18, 10);

const spotify = makeSubscriptionRecord({
  id: 'sub-spotify',
  name: 'Spotify',
  amount: 11.99,
  nextBillingDate: '2026-10-20',
});
const netflix = makeSubscriptionRecord({
  id: 'sub-netflix',
  name: 'Netflix',
  amount: 15.49,
  nextBillingDate: '2026-11-02',
});
const cityGym = makeSubscriptionRecord({
  id: 'sub-gym',
  name: 'City Gym',
  status: 'cancelled',
  billingCycle: 'yearly',
  amount: 300,
});

const FIXTURE = [netflix, spotify, cityGym];

/** The names of the row buttons in a list section, in display order. */
function rowNames(section: HTMLElement): string[] {
  return within(section)
    .getAllByRole('button')
    .map((row) => row.textContent ?? '');
}

describe('SubscriptionsBoard', () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('desktop', () => {
    it('shows the heading and no empty state while loading', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([], { loading: true })}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Subscriptions' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'No subscriptions yet' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Active subscriptions' }),
      ).not.toBeInTheDocument();
    });

    it('shows the no-subscriptions state under a single page heading', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([])}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { level: 2, name: 'No subscriptions yet' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('opens the add form with the preferred currency from the empty state', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([], {
            preferredCurrency: 'EUR',
          })}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

      const dialog = screen.getByRole('dialog', { name: 'Add subscription' });
      expect(within(dialog).getByText('Mode: add')).toBeInTheDocument();
      expect(within(dialog).getByText('Currency: EUR')).toBeInTheDocument();
    });

    it('converts the monthly total on Show all and returns with Show original', () => {
      const usdPlan = makeSubscriptionRecord({
        id: 'sub-usd',
        name: 'Design tool',
        amount: 12,
        currency: 'USD',
      });
      const page = makeSubscriptionsPageController([...FIXTURE, usdPlan]);
      const { rerender } = render(
        <SubscriptionsBoard page={page} variant="desktop" />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show all in AUD' }));
      expect(page.convertToPreferred).toHaveBeenCalledTimes(1);

      const converted = {
        ...page,
        conversion: { status: 'ready', monthly: 40 } as const,
      };
      rerender(<SubscriptionsBoard page={converted} variant="desktop" />);
      fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
      expect(page.showOriginal).toHaveBeenCalledTimes(1);
    });

    it('submits a new record through addSubscription from the header Add button', async () => {
      const page = makeSubscriptionsPageController(FIXTURE);
      render(<SubscriptionsBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));
      const dialog = screen.getByRole('dialog', { name: 'Add subscription' });
      expect(within(dialog).getByText('Mode: add')).toBeInTheDocument();
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Submit form' }),
      );

      await waitFor(() => {
        expect(page.addSubscription).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Renamed plan' }),
        );
      });
      expect(page.updateSubscription).not.toHaveBeenCalled();
    });

    it('shows the summary, totals and status chip counts with Active pressed', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      expect(
        screen.getByText('2 active · 1 renews this week'),
      ).toBeInTheDocument();

      const totals = screen.getByRole('region', { name: 'Totals' });
      expect(
        within(totals).getByText('Each month (active)'),
      ).toBeInTheDocument();
      expect(within(totals).getByText('Spotify')).toBeInTheDocument();

      expect(
        screen.getByRole('button', { name: 'Active · 2' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('button', { name: 'Cancelled · 1' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('lists only active subscriptions under the default Active filter', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      const list = screen.getByRole('region', { name: 'Active subscriptions' });
      expect(rowNames(list)).toHaveLength(2);
      expect(rowNames(list)[0]).toMatch(/^Spotify/);
      expect(rowNames(list)[1]).toMatch(/^Netflix/);
      expect(
        screen.queryByRole('button', { name: /^City Gym/ }),
      ).not.toBeInTheDocument();
    });

    it('shows cancelled rows when the Cancelled chip is pressed, and a message for an empty status', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Cancelled · 1' }));

      const cancelled = screen.getByRole('region', {
        name: 'Cancelled subscriptions',
      });
      expect(rowNames(cancelled)).toEqual([expect.stringMatching(/^City Gym/)]);
      expect(
        screen.getByRole('button', { name: 'Cancelled · 1' }),
      ).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Expired · 0' }));

      expect(screen.getByText('No expired subscriptions.')).toBeInTheDocument();
    });

    it('re-sorts the active list by name when the Sort select changes to Name', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      // Default is next renewal, which puts Spotify (renews soon) first.
      expect(
        rowNames(
          screen.getByRole('region', { name: 'Active subscriptions' }),
        )[0],
      ).toMatch(/^Spotify/);

      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sort' }), {
        key: 'Enter',
      });
      fireEvent.click(screen.getByRole('option', { name: 'Name' }));

      expect(
        rowNames(
          screen.getByRole('region', { name: 'Active subscriptions' }),
        )[0],
      ).toMatch(/^Netflix/);
    });

    it('opens the detail panel on row press and closes it with Close detail', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));

      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'Spotify' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByText('Tue 20 Oct · in 2 days'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));

      expect(
        screen.queryByRole('complementary', { name: 'Subscription detail' }),
      ).not.toBeInTheDocument();
    });

    it('shows a Manage plan link in the detail panel for an https link', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([
            { ...spotify, link: 'https://example.com' },
          ])}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));

      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      expect(
        within(panel).getByRole('link', { name: /Manage plan/ }),
      ).toHaveAttribute('href', 'https://example.com');
    });

    it('omits the Website row and any link in the detail panel for a javascript: link', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([
            // eslint-disable-next-line no-script-url -- deliberate unsafe-scheme fixture for issue #1281
            { ...spotify, link: 'javascript:alert(1)' },
          ])}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));

      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      expect(within(panel).queryByText('Website')).not.toBeInTheDocument();
      expect(
        within(panel).queryByRole('link', { name: /Manage plan/ }),
      ).not.toBeInTheDocument();
      expect(panel.querySelector('a[href^="javascript:"]')).toBeNull();
    });

    it('Edit opens the edit form with the record values and submits through updateSubscription', async () => {
      const page = makeSubscriptionsPageController(FIXTURE);
      render(<SubscriptionsBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: /^Netflix/ }));
      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));

      const dialog = screen.getByRole('dialog', { name: 'Edit subscription' });
      expect(within(dialog).getByText('Mode: edit')).toBeInTheDocument();
      expect(within(dialog).getByText('Name: Netflix')).toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Submit form' }),
      );

      await waitFor(() => {
        expect(page.updateSubscription).toHaveBeenCalledWith(
          'sub-netflix',
          expect.objectContaining({ name: 'Renamed plan' }),
        );
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Edit subscription' }),
        ).not.toBeInTheDocument();
      });
    });

    it('Mark cancelled calls markCancelled for the selected record', async () => {
      const page = makeSubscriptionsPageController(FIXTURE);
      render(<SubscriptionsBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));
      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      fireEvent.click(
        within(panel).getByRole('button', { name: 'Mark cancelled' }),
      );

      await waitFor(() => {
        expect(page.markCancelled).toHaveBeenCalledWith('sub-spotify');
      });
    });

    it('closes the panel once deleteSubscription confirms the delete', async () => {
      const page = makeSubscriptionsPageController(FIXTURE);
      render(<SubscriptionsBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));
      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      fireEvent.click(within(panel).getByRole('button', { name: 'Delete…' }));

      const dialog = screen.getByRole('alertdialog', {
        name: 'Delete "Spotify"?',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete subscription' }),
      );

      await waitFor(() => {
        expect(page.deleteSubscription).toHaveBeenCalledWith('sub-spotify');
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('alertdialog', { name: 'Delete "Spotify"?' }),
        ).not.toBeInTheDocument();
      });
      expect(
        screen.queryByRole('complementary', { name: 'Subscription detail' }),
      ).not.toBeInTheDocument();
    });

    it('keeps the delete dialog and the panel open when deleteSubscription resolves false', async () => {
      const page = makeSubscriptionsPageController(FIXTURE);
      (page.deleteSubscription as jest.Mock).mockResolvedValue(false);
      render(<SubscriptionsBoard page={page} variant="desktop" />);

      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));
      fireEvent.click(
        within(
          screen.getByRole('complementary', { name: 'Subscription detail' }),
        ).getByRole('button', { name: 'Delete…' }),
      );
      const dialog = screen.getByRole('alertdialog', {
        name: 'Delete "Spotify"?',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete subscription' }),
      );

      await waitFor(() => {
        expect(page.deleteSubscription).toHaveBeenCalledWith('sub-spotify');
      });
      // The button leaves its pending label once the promise settles.
      await waitFor(() => {
        expect(
          within(dialog).getByRole('button', { name: 'Delete subscription' }),
        ).toBeEnabled();
      });
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Spotify"?' }),
      ).toBeInTheDocument();
      // The open modal dialog marks the panel aria-hidden, so it is queried as hidden.
      expect(
        screen.getByRole('complementary', {
          name: 'Subscription detail',
          hidden: true,
        }),
      ).toBeInTheDocument();
    });

    it('opens a cancelled initialSelectedId with the Cancelled filter pressed and no Mark cancelled action', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
          initialSelectedId="sub-gym"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Cancelled · 1' }),
      ).toHaveAttribute('aria-pressed', 'true');

      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'City Gym' }),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByRole('button', { name: 'Mark cancelled' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('desktop changes to the records after render', () => {
    it('keeps the default Active filter and no panel when initialSelectedId is not among the loaded records', () => {
      const { rerender } = render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([], { loading: true })}
          variant="desktop"
          initialSelectedId="sub-gym"
        />,
      );

      rerender(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([netflix, spotify])}
          variant="desktop"
          initialSelectedId="sub-gym"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Active · 2' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.queryByRole('complementary', { name: 'Subscription detail' }),
      ).not.toBeInTheDocument();
    });

    it('closes the detail panel when its record is removed from the list', () => {
      const { rerender } = render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^Spotify/ }));
      expect(
        screen.getByRole('complementary', { name: 'Subscription detail' }),
      ).toBeInTheDocument();

      rerender(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([netflix, cityGym])}
          variant="desktop"
        />,
      );

      expect(
        screen.queryByRole('complementary', { name: 'Subscription detail' }),
      ).not.toBeInTheDocument();
    });

    it('closes the edit form when its record is removed while the form is open', () => {
      const { rerender } = render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="desktop"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^Netflix/ }));
      fireEvent.click(
        within(
          screen.getByRole('complementary', { name: 'Subscription detail' }),
        ).getByRole('button', { name: 'Edit' }),
      );
      expect(
        screen.getByRole('dialog', { name: 'Edit subscription' }),
      ).toBeInTheDocument();

      rerender(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController([spotify, cityGym])}
          variant="desktop"
        />,
      );

      expect(
        screen.queryByRole('dialog', { name: 'Edit subscription' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('phone', () => {
    it('renders a visually hidden heading, Active/Others radios and rows linking to each detail', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="phone"
        />,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'Subscriptions' }),
      ).toHaveClass('sr-only');
      expect(screen.getByRole('radio', { name: 'Active · 2' })).toBeChecked();
      expect(
        screen.getByRole('radio', { name: 'Others · 1' }),
      ).not.toBeChecked();

      const list = screen.getByRole('region', { name: 'Active subscriptions' });
      expect(
        within(list).getByRole('link', { name: /^Spotify/ }),
      ).toHaveAttribute('href', '/dashboard/subscriptions/sub-spotify');
      expect(
        within(list).getByRole('link', { name: /^Netflix/ }),
      ).toHaveAttribute('href', '/dashboard/subscriptions/sub-netflix');
    });

    it('opens the sheet in add mode from the Add subscription FAB', () => {
      render(
        <SubscriptionsBoard
          page={makeSubscriptionsPageController(FIXTURE)}
          variant="phone"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Add subscription' }));

      const sheet = screen.getByRole('dialog', { name: 'Add subscription' });
      expect(within(sheet).getByText('Mode: add')).toBeInTheDocument();
    });
  });
});

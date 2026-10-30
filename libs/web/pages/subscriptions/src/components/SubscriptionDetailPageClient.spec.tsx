/* eslint-disable import/first */
// Mocks sit above every import, so the module graph sees them first.
const mockGate: { handle: unknown } = { handle: undefined };

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  VaultGate: ({
    children,
  }: {
    children: (props: { handle: unknown }) => unknown;
  }) => children({ handle: mockGate.handle }),
}));

jest.mock('../hooks/use-subscriptions-page', () => ({
  useSubscriptionsPage: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
}));

jest.mock('./subscription-form-sheet', () => ({
  SubscriptionFormSheet: (props: unknown) => mockFormStub(props),
}));

interface FormStubProps {
  open: boolean;
  mode: 'add' | 'edit';
  initialValues: { name: string; currency: string };
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { name: string; currency: string }) => Promise<void>;
}

/** Stands in for the real edit sheet: shows what the page handed it and submits a renamed copy. */
function mockFormStub(props: unknown) {
  const { open, mode, initialValues, onOpenChange, onSubmit } =
    props as FormStubProps;
  if (!open) return null;

  return (
    <div role="dialog" aria-label="Edit subscription">
      <p>{`Mode: ${mode}`}</p>
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

import { useIsMobileState } from '@myorganiser/web-ui';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';
import { useSubscriptionsPage } from '../hooks/use-subscriptions-page';
import type { SubscriptionsPageController } from '../hooks/use-subscriptions-page';
import { SubscriptionDetailPageClient } from './SubscriptionDetailPageClient';
import {
  makeSubscriptionRecord,
  makeSubscriptionsPageController,
} from '../testing/subscriptions-page-controller.fixture';

// Polyfill ResizeObserver for Radix UI components.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

const SUBSCRIPTIONS_HREF = '/dashboard/subscriptions';
const FAKE_HANDLE = { isUnlocked: true };

const netflix = makeSubscriptionRecord({
  id: 'sub-netflix',
  name: 'Netflix',
  amount: 15.49,
  nextBillingDate: '2026-11-02',
});

const mockRouter = { push: jest.fn(), replace: jest.fn() };

function setController(
  controller: SubscriptionsPageController,
): SubscriptionsPageController {
  (useSubscriptionsPage as jest.Mock).mockReturnValue(controller);
  return controller;
}

describe('SubscriptionDetailPageClient', () => {
  beforeEach(() => {
    (useRouter as jest.Mock).mockReset();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    mockRouter.push.mockReset();
    mockRouter.replace.mockReset();
    (useSubscriptionsPage as jest.Mock).mockReset();
    (useIsMobileState as jest.Mock).mockReset();
    (useIsMobileState as jest.Mock).mockReturnValue(true);
    mockGate.handle = FAKE_HANDLE;
  });

  describe('phone', () => {
    it('shows the subscription as the page heading and Mark cancelled calls markCancelled', async () => {
      const page = setController(makeSubscriptionsPageController([netflix]));

      render(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Netflix' }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Mark cancelled' }));

      await waitFor(() => {
        expect(page.markCancelled).toHaveBeenCalledWith('sub-netflix');
      });
    });

    it('shows a Manage plan on the website link for an https link', () => {
      setController(
        makeSubscriptionsPageController([
          makeSubscriptionRecord({ ...netflix, link: 'https://example.com' }),
        ]),
      );

      render(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);

      expect(
        screen.getByRole('link', { name: /Manage plan on the website/ }),
      ).toHaveAttribute('href', 'https://example.com');
    });

    it('does not render the Manage plan on the website row for a javascript: link', () => {
      setController(
        makeSubscriptionsPageController([
          makeSubscriptionRecord({
            ...netflix,
            // eslint-disable-next-line no-script-url -- deliberate unsafe-scheme fixture for issue #1281
            link: 'javascript:alert(1)',
          }),
        ]),
      );

      render(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);

      expect(
        screen.queryByText(/Manage plan on the website/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /Manage plan on the website/ }),
      ).not.toBeInTheDocument();
      expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    });

    it('redirects to the list when the subscription is not found after loading', () => {
      setController(makeSubscriptionsPageController([]));

      const { container } = render(
        <SubscriptionDetailPageClient subscriptionId="missing" />,
      );

      expect(mockRouter.replace).toHaveBeenCalledWith(SUBSCRIPTIONS_HREF);
      expect(container).toBeEmptyDOMElement();
    });

    it('navigates back to the list once deleteSubscription confirms the delete', async () => {
      const page = setController(makeSubscriptionsPageController([netflix]));
      // The delete removes the record, as the real controller does, so the
      // not-found redirect is armed: only the leaving guard keeps it quiet.
      (page.deleteSubscription as jest.Mock).mockImplementation(async () => {
        setController(makeSubscriptionsPageController([]));
        return true;
      });

      const { rerender } = render(
        <SubscriptionDetailPageClient subscriptionId="sub-netflix" />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
      const dialog = screen.getByRole('alertdialog', {
        name: 'Delete "Netflix"?',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete subscription' }),
      );

      await waitFor(() => {
        expect(page.deleteSubscription).toHaveBeenCalledWith('sub-netflix');
      });
      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith(SUBSCRIPTIONS_HREF);
      });
      rerender(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('stays on the detail with the dialog open when deleteSubscription resolves false', async () => {
      const page = setController(makeSubscriptionsPageController([netflix]));
      (page.deleteSubscription as jest.Mock).mockResolvedValue(false);

      render(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
      const dialog = screen.getByRole('alertdialog', {
        name: 'Delete "Netflix"?',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete subscription' }),
      );

      await waitFor(() => {
        expect(page.deleteSubscription).toHaveBeenCalledWith('sub-netflix');
      });
      // The confirm button leaves its pending label once the promise settles.
      await waitFor(() => {
        expect(
          within(dialog).getByRole('button', { name: 'Delete subscription' }),
        ).toBeEnabled();
      });
      expect(mockRouter.push).not.toHaveBeenCalled();
      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Netflix"?' }),
      ).toBeInTheDocument();
    });

    it('saves the edit sheet through updateSubscription with the subscription id', async () => {
      const page = setController(makeSubscriptionsPageController([netflix]));

      render(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit subscription' });
      expect(within(sheet).getByText('Mode: edit')).toBeInTheDocument();
      fireEvent.click(
        within(sheet).getByRole('button', { name: 'Submit form' }),
      );

      await waitFor(() => {
        expect(page.updateSubscription).toHaveBeenCalledWith(
          'sub-netflix',
          expect.objectContaining({ name: 'Renamed plan' }),
        );
      });
    });
  });

  describe('before the page can render', () => {
    it('renders nothing and does not build the page controller', () => {
      mockGate.handle = undefined;
      (useIsMobileState as jest.Mock).mockReturnValue(false);

      const { container } = render(
        <SubscriptionDetailPageClient subscriptionId="sub-netflix" />,
      );

      expect(container).toBeEmptyDOMElement();
      expect(useSubscriptionsPage).not.toHaveBeenCalled();
    });

    it('renders nothing until the breakpoint is decided', () => {
      setController(makeSubscriptionsPageController([netflix]));
      (useIsMobileState as jest.Mock).mockReturnValue(undefined);

      const { container } = render(
        <SubscriptionDetailPageClient subscriptionId="sub-netflix" />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('desktop', () => {
    it('renders the board with the detail panel open for the subscription', () => {
      (useIsMobileState as jest.Mock).mockReturnValue(false);
      setController(makeSubscriptionsPageController([netflix]));

      render(<SubscriptionDetailPageClient subscriptionId="sub-netflix" />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Subscriptions' }),
      ).toBeInTheDocument();
      const panel = screen.getByRole('complementary', {
        name: 'Subscription detail',
      });
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'Netflix' }),
      ).toBeInTheDocument();
    });
  });
});

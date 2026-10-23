import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { YOUTUBE_DATA_PRIVACY_BULLETS } from '../lib/dataPrivacyCopy';
import { YouTubeConnectPrompt } from './YouTubeConnectPrompt';

jest.mock('../hooks', () => ({
  useYouTubeAcknowledgement: () => mockUseYouTubeAcknowledgement(),
}));

jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');
  const { forwardRef } = jest.requireActual('react');

  return {
    ...actual,
    Button: ({ children, asChild, onClick, ...props }: any) => {
      if (asChild) return children;
      return (
        <button onClick={onClick} {...props}>
          {children}
        </button>
      );
    },
    // Radix Checkbox needs ResizeObserver, which jsdom lacks; sibling specs stub it as an input.
    Checkbox: forwardRef(
      ({ id, checked, onCheckedChange, ...props }: any, ref: any) => (
        <input
          ref={ref}
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(event) => onCheckedChange?.(event.target.checked)}
          {...props}
        />
      ),
    ),
  };
});

jest.mock('next/link', () => {
  return ({ children, href }: any) => <a href={href}>{children}</a>;
});

const mockUseYouTubeAcknowledgement = jest.fn();

interface AcknowledgementStub {
  acknowledged: boolean | null;
  loading: boolean;
  error: string | null;
  accept: jest.Mock;
}

function setAcknowledgement(overrides: Partial<AcknowledgementStub> = {}) {
  mockUseYouTubeAcknowledgement.mockReturnValue({
    acknowledged: true,
    loading: false,
    error: null,
    accept: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

/** The navy hero, named by its h1. */
function getHero() {
  return screen.getByRole('region', { name: 'Connect Your YouTube Account' });
}

/** The "How we store your YouTube data" card. */
function getStorageCard() {
  return screen.getByRole('region', {
    name: 'How we store your YouTube data',
  });
}

/** The first-connect acknowledgement form, named by its h2. */
function getAcknowledgementForm() {
  return screen.getByRole('form', { name: 'Before you connect' });
}

describe('YouTubeConnectPrompt', () => {
  beforeEach(() => {
    mockUseYouTubeAcknowledgement.mockReset();
    setAcknowledgement();
  });

  describe('static content', () => {
    it('should render the main heading as the page h1', () => {
      render(<YouTubeConnectPrompt />);
      expect(
        screen.getByRole('heading', {
          name: /Connect Your YouTube Account/i,
          level: 1,
        }),
      ).toBeInTheDocument();
    });

    it('should render read-only access sentence in the hero', () => {
      render(<YouTubeConnectPrompt />);
      expect(
        within(getHero()).getByText(
          /Link your YouTube account to view and manage videos from your Enabled Channels.*read-only access/i,
        ),
      ).toBeInTheDocument();
    });

    it('should render the six storage bullets in the storage card', () => {
      render(<YouTubeConnectPrompt />);
      const items = within(getStorageCard()).getAllByRole('listitem');

      expect(items).toHaveLength(6);
      expect(items).toHaveLength(YOUTUBE_DATA_PRIVACY_BULLETS.length);
      items.forEach((item, index) => {
        expect(item).toHaveTextContent(YOUTUBE_DATA_PRIVACY_BULLETS[index]);
      });
    });

    it('should render metadata and Watched sentence', () => {
      render(<YouTubeConnectPrompt />);
      expect(
        screen.getByText(/Metadata only — never video files/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Watched is yes\/no, not analytics/),
      ).toBeInTheDocument();
    });

    it('should render the disconnect bullet that says Disconnect deletes Watched marks', () => {
      render(<YouTubeConnectPrompt />);
      expect(
        screen.getByText(/Disconnect deletes .*Watched marks/),
      ).toBeInTheDocument();
    });

    it('should render the privacy data link inside the storage card', () => {
      render(<YouTubeConnectPrompt />);
      const privacyLink = within(getStorageCard()).getByRole('link', {
        name: /How we store your YouTube data/i,
      });
      expect(privacyLink).toHaveAttribute('href', '/youtube/data-privacy');
    });
  });

  describe('onConnect provided — Connect button rendered', () => {
    it('should render "Connect YouTube" button in the hero when onConnect is provided', () => {
      const mockOnConnect = jest.fn();
      render(<YouTubeConnectPrompt onConnect={mockOnConnect} />);
      expect(
        within(getHero()).getByRole('button', { name: /Connect YouTube/i }),
      ).toBeInTheDocument();
    });

    it('should call onConnect when button is clicked', () => {
      const mockOnConnect = jest.fn();
      render(<YouTubeConnectPrompt onConnect={mockOnConnect} />);
      fireEvent.click(screen.getByRole('button', { name: /Connect YouTube/i }));
      expect(mockOnConnect).toHaveBeenCalledTimes(1);
    });

    it('should NOT render back link when onConnect is provided', () => {
      const mockOnConnect = jest.fn();
      render(<YouTubeConnectPrompt onConnect={mockOnConnect} />);
      expect(
        screen.queryByRole('link', { name: /Back to Videos/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('onConnect NOT provided — Back link rendered', () => {
    it('should render "Back to Videos" link in the hero when onConnect is not provided', () => {
      render(<YouTubeConnectPrompt />);
      expect(
        within(getHero()).getByRole('link', { name: /Back to Videos/i }),
      ).toBeInTheDocument();
    });

    it('should render back link with default fallbackHref when not provided', () => {
      render(<YouTubeConnectPrompt />);
      const backLink = screen.getByRole('link', { name: /Back to Videos/i });
      expect(backLink).toHaveAttribute('href', '/dashboard/youtube');
    });

    it('should render back link with custom fallbackHref', () => {
      render(<YouTubeConnectPrompt fallbackHref="/custom/path" />);
      const backLink = screen.getByRole('link', { name: /Back to Videos/i });
      expect(backLink).toHaveAttribute('href', '/custom/path');
    });

    it('should NOT render Connect button when onConnect is not provided', () => {
      render(<YouTubeConnectPrompt />);
      expect(
        screen.queryByRole('button', { name: /Connect YouTube/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('statusMessage', () => {
    it('should render statusMessage as a status region when provided', () => {
      render(<YouTubeConnectPrompt statusMessage="Account revoked" />);
      expect(screen.getByRole('status')).toHaveTextContent('Account revoked');
    });

    it('should not render a status region when statusMessage is not provided', () => {
      render(<YouTubeConnectPrompt />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('should render statusMessage with onConnect present', () => {
      const mockOnConnect = jest.fn();
      render(
        <YouTubeConnectPrompt
          onConnect={mockOnConnect}
          statusMessage="Token expired"
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Token expired');
    });

    it('should render complex ReactNode as statusMessage', () => {
      const statusNode = <span data-testid="custom-status">Custom Status</span>;
      render(<YouTubeConnectPrompt statusMessage={statusNode} />);
      expect(screen.getByTestId('custom-status')).toBeInTheDocument();
    });
  });

  describe('integration: props combinations', () => {
    it('should render all elements with onConnect and statusMessage', () => {
      const mockOnConnect = jest.fn();
      render(
        <YouTubeConnectPrompt
          onConnect={mockOnConnect}
          statusMessage="Revoked"
        />,
      );
      expect(
        screen.getByRole('heading', { name: /Connect Your YouTube Account/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Connect YouTube/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Revoked');
      expect(
        screen.getByRole('link', { name: /How we store your YouTube data/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /Back to Videos/i }),
      ).not.toBeInTheDocument();
    });

    it('should render all elements with no onConnect and custom fallbackHref', () => {
      render(<YouTubeConnectPrompt fallbackHref="/custom" />);
      expect(
        screen.getByRole('heading', { name: /Connect Your YouTube Account/i }),
      ).toBeInTheDocument();
      const backLink = screen.getByRole('link', { name: /Back to Videos/i });
      expect(backLink).toHaveAttribute('href', '/custom');
      expect(
        screen.getByRole('link', { name: /How we store your YouTube data/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Connect YouTube/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('first-connect acknowledgement (ADR 0129)', () => {
    it('lists every acknowledgement point when not yet acknowledged', () => {
      setAcknowledgement({ acknowledged: false });
      render(<YouTubeConnectPrompt onConnect={jest.fn()} />);

      expect(
        screen.getByRole('heading', { name: 'Before you connect', level: 2 }),
      ).toBeInTheDocument();
      expect(
        within(getAcknowledgementForm()).getAllByRole('listitem'),
      ).toHaveLength(5);
      expect(
        screen.getByText(/MyOrganiser reads your YouTube subscriptions/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/stored outside your Vault and is not end-to-end/),
      ).toBeInTheDocument();
      expect(screen.getByText(/unverified app/)).toBeInTheDocument();
      expect(
        screen.getByText(
          /operator withdraws your YouTube access, everything is deleted/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /run personally by its operator, who can switch it off/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/never stores video files/)).toBeInTheDocument();
      expect(
        screen.getByText(/Your YouTube access tokens are encrypted at rest/),
      ).toBeInTheDocument();
      expect(screen.getByText(/If you disconnect YouTube/)).toBeInTheDocument();
      expect(
        screen.getByText(/Nothing is kept for a later reconnect/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/has not been through Google's app verification/),
      ).toBeInTheDocument();
    });

    it('links the privacy policy and YouTube terms, opening the terms in a new tab', () => {
      setAcknowledgement({ acknowledged: false });
      render(<YouTubeConnectPrompt onConnect={jest.fn()} />);

      expect(
        screen.getByRole('link', { name: 'Privacy Policy' }),
      ).toHaveAttribute('href', '/privacy');

      const termsLink = screen.getByRole('link', {
        name: /YouTube's Terms of Service/,
      });
      expect(termsLink).toHaveAttribute(
        'href',
        'https://www.youtube.com/t/terms',
      );
      expect(termsLink).toHaveAttribute('target', '_blank');
      expect(termsLink).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('disables Connect until the agreement checkbox is ticked', async () => {
      setAcknowledgement({ acknowledged: false });
      render(<YouTubeConnectPrompt onConnect={jest.fn()} />);

      const connectButton = screen.getByRole('button', {
        name: /Connect YouTube/i,
      });
      expect(connectButton).toBeDisabled();

      fireEvent.click(screen.getByRole('checkbox'));

      await waitFor(() => expect(connectButton).toBeEnabled());
    });

    it('disables Connect again and neither stores nor connects when the box is unticked', async () => {
      const accept = jest.fn().mockResolvedValue(undefined);
      const onConnect = jest.fn();
      setAcknowledgement({ acknowledged: false, accept });
      render(<YouTubeConnectPrompt onConnect={onConnect} />);

      const connectButton = screen.getByRole('button', {
        name: /Connect YouTube/i,
      });
      const checkbox = screen.getByRole('checkbox');

      fireEvent.click(checkbox);
      await waitFor(() => expect(connectButton).toBeEnabled());

      fireEvent.click(checkbox);
      await waitFor(() => expect(connectButton).toBeDisabled());

      fireEvent.click(connectButton);

      expect(accept).not.toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('shows the not-ticked error and neither stores nor connects when the form is submitted unticked', async () => {
      const accept = jest.fn().mockResolvedValue(undefined);
      const onConnect = jest.fn();
      setAcknowledgement({ acknowledged: false, accept });
      render(<YouTubeConnectPrompt onConnect={onConnect} />);

      // Connect is disabled until ticked, so the form is submitted directly.
      fireEvent.submit(getAcknowledgementForm());

      expect(
        await screen.findByText('Tick the box to agree before connecting'),
      ).toBeInTheDocument();
      expect(accept).not.toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('stores the acknowledgement before calling onConnect', async () => {
      const order: string[] = [];
      const accept = jest.fn(async () => {
        order.push('accept');
      });
      const onConnect = jest.fn(() => {
        order.push('connect');
      });
      setAcknowledgement({ acknowledged: false, accept });
      render(<YouTubeConnectPrompt onConnect={onConnect} />);

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Connect YouTube/i }));

      await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
      expect(accept).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['accept', 'connect']);
    });

    it('shows an alert and does not connect when the acknowledgement is not stored', async () => {
      const accept = jest.fn().mockRejectedValue(new Error('Server error'));
      const onConnect = jest.fn();
      setAcknowledgement({ acknowledged: false, accept });
      render(<YouTubeConnectPrompt onConnect={onConnect} />);

      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /Connect YouTube/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not save your acknowledgement. Please try again.',
      );
      expect(accept).toHaveBeenCalledTimes(1);
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('falls back to the checkbox when the acknowledgement lookup fails', async () => {
      setAcknowledgement({
        acknowledged: null,
        loading: false,
        error: 'Request failed: 500',
      });
      const onConnect = jest.fn();
      render(<YouTubeConnectPrompt onConnect={onConnect} />);

      expect(screen.getByRole('checkbox')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Connect YouTube/i }),
      ).toBeDisabled();
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('disables Connect in the hero and hides the form while the acknowledgement loads', () => {
      setAcknowledgement({ acknowledged: null, loading: true });
      render(<YouTubeConnectPrompt onConnect={jest.fn()} />);

      expect(
        within(getHero()).getByRole('button', { name: /Connect YouTube/i }),
      ).toBeDisabled();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Before you connect' }),
      ).not.toBeInTheDocument();
    });

    it('connects straight away without asking again once acknowledged', () => {
      const accept = jest.fn();
      const onConnect = jest.fn();
      setAcknowledgement({ acknowledged: true, accept });
      render(<YouTubeConnectPrompt onConnect={onConnect} />);

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Before you connect' }),
      ).not.toBeInTheDocument();
      const connectButton = within(getHero()).getByRole('button', {
        name: /Connect YouTube/i,
      });
      expect(connectButton).toBeEnabled();

      fireEvent.click(connectButton);

      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(accept).not.toHaveBeenCalled();
    });

    it('does not look up the acknowledgement when there is no connect action', () => {
      render(<YouTubeConnectPrompt fallbackHref="/custom" />);

      expect(mockUseYouTubeAcknowledgement).not.toHaveBeenCalled();
      expect(
        screen.getByRole('link', { name: /Back to Videos/i }),
      ).toHaveAttribute('href', '/custom');
    });
  });
});

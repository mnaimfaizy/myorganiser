import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { YouTubeUnavailableNotice } from './YouTubeUnavailableNotice';

jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');

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
  };
});

jest.mock('next/link', () => {
  return ({ children, href }: any) => <a href={href}>{children}</a>;
});

jest.mock('@myorganiser/web-youtube', () => ({
  requestYouTubeAvailabilityRecheck: jest.fn(),
}));

// Read the mocked export through the registry, so no @myorganiser import precedes the jest.mock above.
const requestYouTubeAvailabilityRecheck = jest.requireMock<{
  requestYouTubeAvailabilityRecheck: jest.Mock;
}>('@myorganiser/web-youtube').requestYouTubeAvailabilityRecheck;

describe('YouTubeUnavailableNotice', () => {
  beforeEach(() => {
    (requestYouTubeAvailabilityRecheck as jest.Mock).mockReset();
  });

  describe('reason: unavailable (default)', () => {
    it('renders the h1 and body copy for an unavailable YouTube', () => {
      render(<YouTubeUnavailableNotice />);

      expect(
        screen.getByRole('heading', {
          name: 'YouTube is not available right now',
          level: 1,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText('Please try again later.')).toBeInTheDocument();
    });

    it('renders no TEMPORARY label, no status region, and no Try again button', () => {
      render(<YouTubeUnavailableNotice />);

      expect(screen.queryByText('TEMPORARY')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    });

    it('renders Back to Dashboard as a link to /dashboard when onBack is omitted', () => {
      render(<YouTubeUnavailableNotice />);

      const backLink = screen.getByRole('link', { name: 'Back to Dashboard' });
      expect(backLink).toHaveAttribute('href', '/dashboard');
    });

    it('renders Back to Dashboard as a button when onBack is given', () => {
      const onBack = jest.fn();
      render(<YouTubeUnavailableNotice onBack={onBack} />);

      const backButton = screen.getByRole('button', {
        name: 'Back to Dashboard',
      });
      expect(backButton).toHaveAttribute('type', 'button');
      expect(
        screen.queryByRole('link', { name: 'Back to Dashboard' }),
      ).not.toBeInTheDocument();
    });

    it('calls onBack once when Back to Dashboard is clicked', () => {
      const onBack = jest.fn();
      render(<YouTubeUnavailableNotice onBack={onBack} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Back to Dashboard' }),
      );
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(requestYouTubeAvailabilityRecheck).not.toHaveBeenCalled();
    });
  });

  describe('reason: unreachable', () => {
    it('renders the TEMPORARY label, h1, and body copy inside the status region', () => {
      render(<YouTubeUnavailableNotice reason="unreachable" />);

      const status = screen.getByRole('status');
      expect(within(status).getByText('TEMPORARY')).toBeInTheDocument();
      expect(
        within(status).getByRole('heading', {
          name: "YouTube can't be reached right now",
          level: 1,
        }),
      ).toBeInTheDocument();
      expect(
        within(status).getByText(
          "We couldn't check your YouTube connection. Your cached uploads are safe. Try again in a few minutes.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('YouTube is not available right now'),
      ).not.toBeInTheDocument();
    });

    it('calls requestYouTubeAvailabilityRecheck once when Try again is clicked', () => {
      render(<YouTubeUnavailableNotice reason="unreachable" />);

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(requestYouTubeAvailabilityRecheck).toHaveBeenCalledTimes(1);
    });

    it('keeps Back to Dashboard as a link to /dashboard when onBack is omitted', () => {
      render(<YouTubeUnavailableNotice reason="unreachable" />);

      expect(
        screen.getByRole('link', { name: 'Back to Dashboard' }),
      ).toHaveAttribute('href', '/dashboard');
    });

    it('honours onBack for Back to Dashboard and does not recheck', () => {
      const onBack = jest.fn();
      render(<YouTubeUnavailableNotice reason="unreachable" onBack={onBack} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Back to Dashboard' }),
      );

      expect(onBack).toHaveBeenCalledTimes(1);
      expect(requestYouTubeAvailabilityRecheck).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('link', { name: 'Back to Dashboard' }),
      ).not.toBeInTheDocument();
    });
  });
});

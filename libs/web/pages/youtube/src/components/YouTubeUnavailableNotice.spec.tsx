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

  describe('reason: withdrawn', () => {
    const WITHDRAWAL_ENDING =
      'Your YouTube connection was ended and its cached data deleted. The rest of MyOrganiser is unaffected.';
    const CONTACT_LINE =
      'If you think this is a mistake, contact the person who runs your MyOrganiser.';
    // Fixed year other than the current one, so the year is appended.
    const WITHDRAWN_LAST_YEAR = '2025-10-14T12:00:00.000Z';
    // Current year, computed at test time, so the year is omitted.
    const WITHDRAWN_THIS_YEAR = new Date(
      Date.UTC(new Date().getFullYear(), 9, 14, 12),
    ).toISOString();

    it('renders the permanent alert with its caps line, h1, and dated body', () => {
      render(
        <YouTubeUnavailableNotice
          reason="withdrawn"
          withdrawnAt={WITHDRAWN_LAST_YEAR}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(
        within(alert).getByText('ACCESS WITHDRAWN · PERMANENT'),
      ).toBeInTheDocument();
      expect(
        within(alert).getByRole('heading', {
          name: 'YouTube is no longer available to you',
          level: 1,
        }),
      ).toBeInTheDocument();
      expect(
        within(alert).getByText(
          `An admin withdrew your YouTube Access on 14 Oct 2025. ${WITHDRAWAL_ENDING}`,
        ),
      ).toBeInTheDocument();
    });

    it('omits the year from the date when the withdrawal is in the current year', () => {
      render(
        <YouTubeUnavailableNotice
          reason="withdrawn"
          withdrawnAt={WITHDRAWN_THIS_YEAR}
        />,
      );

      expect(
        screen.getByText(
          `An admin withdrew your YouTube Access on 14 Oct. ${WITHDRAWAL_ENDING}`,
        ),
      ).toBeInTheDocument();
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['unparsable', 'not-a-date'],
    ])(
      'drops the date from the body when withdrawnAt is %s',
      (_label, withdrawnAt) => {
        render(
          <YouTubeUnavailableNotice
            reason="withdrawn"
            withdrawnAt={withdrawnAt}
          />,
        );

        expect(
          screen.getByText(
            `An admin withdrew your YouTube Access. ${WITHDRAWAL_ENDING}`,
          ),
        ).toBeInTheDocument();
      },
    );

    it('shows the contact line and no TEMPORARY label or Try again button', () => {
      render(
        <YouTubeUnavailableNotice
          reason="withdrawn"
          withdrawnAt={WITHDRAWN_LAST_YEAR}
        />,
      );

      expect(screen.getByText(CONTACT_LINE)).toBeInTheDocument();
      expect(screen.queryByText('TEMPORARY')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
      expect(requestYouTubeAvailabilityRecheck).not.toHaveBeenCalled();
    });

    it('renders Back to Dashboard as a link to /dashboard when onBack is omitted', () => {
      render(
        <YouTubeUnavailableNotice
          reason="withdrawn"
          withdrawnAt={WITHDRAWN_LAST_YEAR}
        />,
      );

      expect(
        screen.getByRole('link', { name: 'Back to Dashboard' }),
      ).toHaveAttribute('href', '/dashboard');
    });

    it('renders Back to Dashboard as a button that calls onBack when onBack is given', () => {
      const onBack = jest.fn();
      render(
        <YouTubeUnavailableNotice
          reason="withdrawn"
          withdrawnAt={WITHDRAWN_LAST_YEAR}
          onBack={onBack}
        />,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Back to Dashboard' }),
      );

      expect(onBack).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole('link', { name: 'Back to Dashboard' }),
      ).not.toBeInTheDocument();
    });
  });
});

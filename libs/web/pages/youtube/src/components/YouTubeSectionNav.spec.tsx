import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { YouTubeSectionNav } from './YouTubeSectionNav';

jest.mock('next/link', () => {
  // Forward aria-current, the attribute under test, as next/link does.
  return ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

function getNav() {
  return screen.getByRole('navigation', { name: 'YouTube' });
}

describe('YouTubeSectionNav', () => {
  describe('desktop', () => {
    it('renders a YouTube navigation landmark with links to the three sections', () => {
      render(<YouTubeSectionNav current="videos" variant="desktop" />);

      const nav = getNav();
      expect(within(nav).getByRole('link', { name: 'Videos' })).toHaveAttribute(
        'href',
        '/dashboard/youtube',
      );
      expect(within(nav).getByRole('link', { name: 'Shorts' })).toHaveAttribute(
        'href',
        '/dashboard/youtube/shorts',
      );
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toHaveAttribute('href', '/dashboard/youtube/channels');
    });

    it('sets aria-current="page" on the current section only', () => {
      render(<YouTubeSectionNav current="shorts" variant="desktop" />);

      const nav = getNav();
      expect(within(nav).getByRole('link', { name: 'Shorts' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(
        within(nav).getByRole('link', { name: 'Videos' }),
      ).not.toHaveAttribute('aria-current');
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).not.toHaveAttribute('aria-current');
    });

    it('shows the subscription count on Channels when channelCount is a number', () => {
      render(
        <YouTubeSectionNav
          current="videos"
          channelCount={12}
          variant="desktop"
        />,
      );

      expect(
        within(getNav()).getByRole('link', { name: 'Channels · 12' }),
      ).toHaveAttribute('href', '/dashboard/youtube/channels');
    });

    it('shows a zero count on Channels when channelCount is 0', () => {
      render(
        <YouTubeSectionNav
          current="videos"
          channelCount={0}
          variant="desktop"
        />,
      );

      expect(
        within(getNav()).getByRole('link', { name: 'Channels · 0' }),
      ).toBeInTheDocument();
    });

    it('shows a plain Channels label when channelCount is null or undefined', () => {
      const { unmount } = render(
        <YouTubeSectionNav
          current="videos"
          channelCount={null}
          variant="desktop"
        />,
      );
      expect(
        within(getNav()).getByRole('link', { name: 'Channels' }),
      ).toBeInTheDocument();
      unmount();

      render(<YouTubeSectionNav current="videos" variant="desktop" />);
      expect(
        within(getNav()).getByRole('link', { name: 'Channels' }),
      ).toBeInTheDocument();
    });
  });

  describe('phone', () => {
    it('never shows a count, even when channelCount is a number', () => {
      render(
        <YouTubeSectionNav
          current="channels"
          channelCount={12}
          variant="phone"
        />,
      );

      const nav = getNav();
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toHaveAttribute('aria-current', 'page');
      expect(
        within(nav).queryByRole('link', { name: /Channels ·/ }),
      ).not.toBeInTheDocument();
    });

    it('renders the same three section links with aria-current on the current one', () => {
      render(<YouTubeSectionNav current="videos" variant="phone" />);

      const nav = getNav();
      const videos = within(nav).getByRole('link', { name: 'Videos' });
      expect(videos).toHaveAttribute('aria-current', 'page');
      expect(videos).toHaveAttribute('href', '/dashboard/youtube');
      expect(within(nav).getByRole('link', { name: 'Shorts' })).toHaveAttribute(
        'href',
        '/dashboard/youtube/shorts',
      );
      expect(
        within(nav).getByRole('link', { name: 'Channels' }),
      ).toHaveAttribute('href', '/dashboard/youtube/channels');
      expect(
        within(nav).getAllByRole('link', { current: 'page' }),
      ).toHaveLength(1);
    });
  });
});

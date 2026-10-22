import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import YouTubeDataPage from './YouTubeDataPage';

jest.mock('next/link', () => {
  return ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

describe('YouTubeDataPage', () => {
  it('should render the heading "How we store your YouTube data"', () => {
    render(<YouTubeDataPage />);
    expect(
      screen.getByRole('heading', {
        name: /How we store your YouTube data/i,
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it('should render all seven privacy claims', () => {
    const { container } = render(<YouTubeDataPage />);
    const listItems = container.querySelectorAll('li');
    expect(listItems).toHaveLength(7);
  });

  it('should render metadata-only claim', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(/metadata only/i);
    expect(text).toMatch(/titles.*thumbnails.*video IDs/);
    expect(text).toMatch(/never store the video files/i);
  });

  it('should render Watched is yes/no claim', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(/Watched.*simple yes\/no marker/i);
    expect(text).toMatch(/not a viewing history/i);
  });

  it('should render latest 100 Cached Uploads claim', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(/latest 100.*Cached Uploads/i);
  });

  it('should render 30-day disable retention claim', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(/disable a channel/i);
    expect(text).toMatch(/30 days/);
    expect(text).toMatch(/permanently deleted/i);
  });

  it('should render disconnect claim: Watched marks deleted immediately with nothing kept for reconnect', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(
      /Disconnecting your YouTube account immediately deletes Followed Channels, Cached Uploads, Watched marks, notification and digest settings, and OAuth tokens/,
    );
    expect(text).toMatch(/Nothing is kept for a later reconnect/);
    expect(text).not.toMatch(/Watched marks are kept for/);
    expect(text).not.toMatch(/optionally delete/i);
  });

  it('should render Shorts Daily Budget browser-local claim', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(/Shorts Daily Budget/i);
    expect(text).toMatch(/tracked locally in your browser/i);
  });

  it('should render Vault/E2EE disclaimer', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    expect(text).toMatch(/YouTube metadata is not covered/i);
    expect(text).toMatch(/Vault or end-to-end encryption/i);
  });

  it('should ensure it is the only occurrence of the Vault disclaimer sentence', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';
    const matches = text.match(
      /not covered by MyOrganiser's Vault or end-to-end encryption/g,
    );
    expect(matches).toHaveLength(1);
  });

  it('should contain no Vault or encryption wording before the disclaimer', () => {
    const { container } = render(<YouTubeDataPage />);
    const text = container.textContent || '';

    // Find the disclaimer sentence position
    const disclaimerIndex = text.indexOf(
      "This YouTube metadata is not covered by MyOrganiser's Vault or end-to-end encryption",
    );
    expect(disclaimerIndex).toBeGreaterThan(-1);

    // Check text before the disclaimer
    const beforeDisclaimer = text.substring(0, disclaimerIndex);
    expect(beforeDisclaimer).not.toMatch(/Vault|encrypt/i);
  });

  it('should render a back button link to /dashboard/youtube', () => {
    render(<YouTubeDataPage />);
    const backLink = screen.getByRole('link', { name: /Back to YouTube/i });
    expect(backLink).toHaveAttribute('href', '/dashboard/youtube');
  });

  describe('Page structure', () => {
    it('should render exactly one h1', () => {
      render(<YouTubeDataPage />);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('should leave both Legal nav links without aria-current', () => {
      render(<YouTubeDataPage />);
      const legalNav = screen.getByRole('navigation', { name: 'Legal' });
      expect(
        within(legalNav).getByRole('link', { name: 'Privacy Policy' }),
      ).not.toHaveAttribute('aria-current');
      expect(
        within(legalNav).getByRole('link', { name: 'Terms of Service' }),
      ).not.toHaveAttribute('aria-current');
    });

    it('should render no On this page navigation', () => {
      render(<YouTubeDataPage />);
      expect(
        screen.queryByRole('navigation', { name: 'On this page' }),
      ).toBeNull();
    });
  });
});

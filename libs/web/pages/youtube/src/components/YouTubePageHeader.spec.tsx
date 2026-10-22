import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { YouTubePageHeader } from './YouTubePageHeader';

describe('YouTubePageHeader', () => {
  describe('desktop', () => {
    it('renders the title as a visible h1 with the subtitle and actions', () => {
      render(
        <YouTubePageHeader
          title="YouTube"
          subtitle="Your followed channels"
          actions={<button type="button">Sync uploads</button>}
          variant="desktop"
        />,
      );

      const heading = screen.getByRole('heading', {
        name: 'YouTube',
        level: 1,
      });
      expect(heading).not.toHaveClass('sr-only');
      expect(screen.getByText('Your followed channels')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Sync uploads' }),
      ).toBeInTheDocument();
    });

    it('renders no subtitle paragraph or actions when they are omitted', () => {
      const { container } = render(
        <YouTubePageHeader title="Shorts" variant="desktop" />,
      );

      expect(
        screen.getByRole('heading', { name: 'Shorts', level: 1 }),
      ).toBeInTheDocument();
      expect(container.querySelector('p')).toBeNull();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('phone', () => {
    it('renders the title as an sr-only h1, a subtitle that is not sr-only, and the actions', () => {
      render(
        <YouTubePageHeader
          title="Channels"
          subtitle="12 subscriptions"
          actions={<button type="button">Sync uploads</button>}
          variant="phone"
        />,
      );

      const heading = screen.getByRole('heading', {
        name: 'Channels',
        level: 1,
      });
      expect(heading).toHaveClass('sr-only');
      expect(screen.getByText('12 subscriptions')).not.toHaveClass('sr-only');
      expect(
        screen.getByRole('button', { name: 'Sync uploads' }),
      ).toBeInTheDocument();
    });

    it('renders no subtitle paragraph or actions when they are omitted', () => {
      const { container } = render(
        <YouTubePageHeader title="YouTube" variant="phone" />,
      );

      expect(
        screen.getByRole('heading', { name: 'YouTube', level: 1 }),
      ).toHaveClass('sr-only');
      expect(container.querySelector('p')).toBeNull();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});

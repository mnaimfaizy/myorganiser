import '@testing-library/jest-dom';

import { fireEvent, render, screen } from '@testing-library/react';

import { YouTubeDigestSection } from './YouTubeDigestSection';

// jsdom has no pointer capture or scrollIntoView, which Radix Select calls.
Element.prototype.scrollIntoView = jest.fn();
Element.prototype.hasPointerCapture = jest.fn(() => false);
Element.prototype.releasePointerCapture = jest.fn();

const TIME_ZONE = 'Australia/Sydney';
const DIGEST_HELP_TEXT =
  'Digest lists only Cached Uploads that are still New — Watched uploads are left out. Weeks with nothing new are skipped entirely.';

const mockOnEnabledChange = jest.fn();
const mockOnWeekdayChange = jest.fn();
const mockOnSave = jest.fn();

interface RenderOptions {
  enabled?: boolean;
  weekday?: number;
  saving?: boolean;
}

function renderSection(
  variant: 'desktop' | 'phone',
  { enabled = true, weekday = 1, saving = false }: RenderOptions = {},
) {
  return render(
    <YouTubeDigestSection
      variant={variant}
      enabled={enabled}
      onEnabledChange={mockOnEnabledChange}
      weekday={weekday}
      onWeekdayChange={mockOnWeekdayChange}
      saving={saving}
      onSave={mockOnSave}
      timeZone={TIME_ZONE}
    />,
  );
}

describe('YouTubeDigestSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('desktop', () => {
    it('shows the heading, the digest help, and the time zone in the day help text', () => {
      renderSection('desktop');

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Weekly YouTube digest',
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(DIGEST_HELP_TEXT)).toBeInTheDocument();
      expect(
        screen.getByText(
          'Sent on your chosen day, in your time zone (Australia/Sydney).',
        ),
      ).toBeInTheDocument();
    });

    it('reflects enabled on the switch and reports the opposite value when clicked', () => {
      renderSection('desktop', { enabled: false });

      const toggle = screen.getByRole('switch', {
        name: 'Email me a weekly digest',
      });
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(toggle);

      expect(mockOnEnabledChange).toHaveBeenCalledTimes(1);
      expect(mockOnEnabledChange).toHaveBeenCalledWith(true);
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('labels the Send on select with the weekday name and disables it while the digest is off', () => {
      renderSection('desktop', { enabled: false, weekday: 1 });

      const day = screen.getByRole('combobox', { name: 'Send on' });
      expect(day).toHaveTextContent('Monday');
      expect(day).toBeDisabled();
    });

    it('reports the chosen weekday as a number when another day is picked', () => {
      renderSection('desktop', { enabled: true, weekday: 1 });

      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Send on' }), {
        key: 'Enter',
      });
      fireEvent.click(screen.getByRole('option', { name: 'Friday' }));

      expect(mockOnWeekdayChange).toHaveBeenCalledWith(5);
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('calls onSave from the save button, and shows the busy label while saving', () => {
      const { unmount } = renderSection('desktop');

      fireEvent.click(
        screen.getByRole('button', { name: 'Save digest settings' }),
      );
      expect(mockOnSave).toHaveBeenCalledTimes(1);
      unmount();

      renderSection('desktop', { saving: true });
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    });
  });

  describe('phone', () => {
    it('shows the switch and a Send on select labelled with the current weekday', () => {
      renderSection('phone', { enabled: true, weekday: 5 });

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Weekly YouTube digest',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('switch', { name: 'Email me a weekly digest' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(
        screen.getByRole('combobox', { name: 'Send on' }),
      ).toHaveTextContent('Friday');
    });

    it('shows the combined help paragraph with the time zone and calls onSave from Save', () => {
      renderSection('phone');

      expect(
        screen.getByText(
          `${DIGEST_HELP_TEXT} Sent on your chosen day, in your time zone (Australia/Sydney).`,
        ),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Save digest settings' }),
      );

      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    it('reports the opposite switch value when the digest is toggled off', () => {
      renderSection('phone', { enabled: true });

      fireEvent.click(
        screen.getByRole('switch', { name: 'Email me a weekly digest' }),
      );

      expect(mockOnEnabledChange).toHaveBeenCalledTimes(1);
      expect(mockOnEnabledChange).toHaveBeenCalledWith(false);
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('reports the chosen weekday as a number when Friday is picked from the Send on select', () => {
      renderSection('phone', { enabled: true, weekday: 1 });

      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Send on' }), {
        key: 'Enter',
      });
      fireEvent.click(screen.getByRole('option', { name: 'Friday' }));

      expect(mockOnWeekdayChange).toHaveBeenCalledWith(5);
      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });
});

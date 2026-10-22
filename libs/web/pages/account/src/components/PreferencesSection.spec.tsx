import '@testing-library/jest-dom';

import { fireEvent, render, screen } from '@testing-library/react';

import { PreferencesSection } from './PreferencesSection';

// jsdom has no pointer capture or scrollIntoView, which Radix Select calls.
Element.prototype.scrollIntoView = jest.fn();
Element.prototype.hasPointerCapture = jest.fn(() => false);
Element.prototype.releasePointerCapture = jest.fn();

const mockOnCountryCodeChange = jest.fn();
const mockOnPreferredCurrencyChange = jest.fn();
const mockOnSave = jest.fn();

function renderSection(variant: 'desktop' | 'phone') {
  return render(
    <PreferencesSection
      variant={variant}
      countryCode="AU"
      onCountryCodeChange={mockOnCountryCodeChange}
      preferredCurrency="AUD"
      onPreferredCurrencyChange={mockOnPreferredCurrencyChange}
      onSave={mockOnSave}
    />,
  );
}

describe('PreferencesSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('desktop', () => {
    it('labels the country and currency selects with their current values', () => {
      renderSection('desktop');

      expect(
        screen.getByRole('heading', { level: 2, name: 'Preferences' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('combobox', { name: 'Country' }),
      ).toHaveTextContent('Australia (AU)');
      expect(
        screen.getByRole('combobox', { name: 'Preferred currency' }),
      ).toHaveTextContent('AUD — Australian Dollar');
      expect(
        screen.getByText(
          'Used for prices in Subscriptions and for address formats.',
        ),
      ).toBeInTheDocument();
    });

    it('calls onSave once when Save is clicked', () => {
      renderSection('desktop');

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnCountryCodeChange).not.toHaveBeenCalled();
      expect(mockOnPreferredCurrencyChange).not.toHaveBeenCalled();
    });

    it('reports a changed country without saving it', () => {
      renderSection('desktop');

      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Country' }), {
        key: 'Enter',
      });
      fireEvent.click(screen.getByRole('option', { name: 'New Zealand (NZ)' }));

      expect(mockOnCountryCodeChange).toHaveBeenCalledWith('NZ');
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('reports a changed currency without saving it', () => {
      renderSection('desktop');

      fireEvent.keyDown(
        screen.getByRole('combobox', { name: 'Preferred currency' }),
        { key: 'Enter' },
      );
      fireEvent.click(
        screen.getByRole('option', { name: 'NZD — New Zealand Dollar' }),
      );

      expect(mockOnPreferredCurrencyChange).toHaveBeenCalledWith('NZD');
      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  describe('phone', () => {
    it('labels the selects and shows only the currency code in its trigger', () => {
      renderSection('phone');

      expect(
        screen.getByRole('combobox', { name: 'Country' }),
      ).toHaveTextContent('Australia (AU)');
      const currency = screen.getByRole('combobox', {
        name: 'Preferred currency',
      });
      expect(currency.textContent).toBe('AUD');
    });

    it('shows the help line and a Save button that calls onSave', () => {
      renderSection('phone');

      expect(
        screen.getByText(
          'Used for prices in Subscriptions and for address formats.',
        ),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });
  });
});

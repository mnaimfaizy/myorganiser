import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Input } from './Input';

describe('Input', () => {
  describe('when disabled', () => {
    it('is disabled and cannot take focus', () => {
      render(<Input aria-label="Locked" disabled />);
      const input = screen.getByRole('textbox', { name: 'Locked' });

      input.focus();

      expect(input).toBeDisabled();
      expect(document.activeElement).not.toBe(input);
    });
  });
});

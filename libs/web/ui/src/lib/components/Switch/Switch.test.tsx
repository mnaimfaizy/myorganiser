import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Switch } from './Switch';

describe('Switch', () => {
  describe('uncontrolled state', () => {
    it('sets the initial aria-checked from defaultChecked and flips it on click', () => {
      const onCheckedChange = jest.fn();
      render(
        <Switch
          aria-label="Dark mode"
          defaultChecked
          onCheckedChange={onCheckedChange}
        />,
      );
      const toggle = screen.getByRole('switch', { name: 'Dark mode' });

      expect(toggle).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).toHaveAttribute('data-state', 'unchecked');
      expect(onCheckedChange).toHaveBeenCalledTimes(1);
      expect(onCheckedChange).toHaveBeenCalledWith(false);
    });
  });

  describe('controlled state', () => {
    it('calls onCheckedChange with the next value but keeps aria-checked until the parent re-renders', () => {
      const onCheckedChange = jest.fn();
      const { rerender } = render(
        <Switch
          aria-label="Email alerts"
          checked={false}
          onCheckedChange={onCheckedChange}
        />,
      );
      const toggle = screen.getByRole('switch', { name: 'Email alerts' });

      fireEvent.click(toggle);

      expect(onCheckedChange).toHaveBeenCalledWith(true);
      expect(toggle).toHaveAttribute('aria-checked', 'false');

      rerender(
        <Switch
          aria-label="Email alerts"
          checked
          onCheckedChange={onCheckedChange}
        />,
      );

      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('disabled', () => {
    it('neither toggles nor calls onCheckedChange when clicked', () => {
      const onCheckedChange = jest.fn();
      render(
        <Switch aria-label="Sync" disabled onCheckedChange={onCheckedChange} />,
      );
      const toggle = screen.getByRole('switch', { name: 'Sync' });

      expect(toggle).toBeDisabled();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('caller onClick veto', () => {
    it('keeps the switch unchanged when the caller onClick calls preventDefault', () => {
      const onCheckedChange = jest.fn();
      render(
        <Switch
          aria-label="Confirm change"
          onClick={(event) => event.preventDefault()}
          onCheckedChange={onCheckedChange}
        />,
      );
      const toggle = screen.getByRole('switch', { name: 'Confirm change' });

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('label association', () => {
    it('takes its accessible name from an associated label and toggles when the label is clicked', () => {
      const onCheckedChange = jest.fn();
      render(
        <>
          <label htmlFor="weekly-digest">Weekly digest</label>
          <Switch id="weekly-digest" onCheckedChange={onCheckedChange} />
        </>,
      );
      const toggle = screen.getByRole('switch', { name: 'Weekly digest' });

      fireEvent.click(screen.getByText('Weekly digest'));

      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });
  });
});

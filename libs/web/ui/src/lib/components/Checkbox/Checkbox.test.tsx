import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('toggles aria-checked and data-state on each click', () => {
    const onCheckedChange = jest.fn();
    render(
      <Checkbox aria-label="Accept terms" onCheckedChange={onCheckedChange} />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' });

    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(checkbox);

    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    expect(checkbox).toHaveAttribute('data-state', 'checked');
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(checkbox);

    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('neither toggles nor calls onCheckedChange when disabled and clicked', () => {
    const onCheckedChange = jest.fn();
    render(
      <Checkbox
        aria-label="Locked option"
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Locked option' });

    expect(checkbox).toBeDisabled();

    fireEvent.click(checkbox);

    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('renders the indeterminate state as aria-checked="mixed"', () => {
    render(<Checkbox aria-label="Select all" checked="indeterminate" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' });

    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(checkbox).toHaveAttribute('data-state', 'indeterminate');
  });
});

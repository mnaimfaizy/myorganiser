import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import { ChoiceChip } from './ChoiceChip';

describe('ChoiceChip', () => {
  it('reflects the pressed prop in aria-pressed', () => {
    const { rerender } = render(
      <ChoiceChip pressed={false} onPressedChange={jest.fn()}>
        Work
      </ChoiceChip>,
    );
    const chip = screen.getByRole('button', { name: 'Work' });

    expect(chip).toHaveAttribute('aria-pressed', 'false');

    rerender(
      <ChoiceChip pressed onPressedChange={jest.fn()}>
        Work
      </ChoiceChip>,
    );

    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onPressedChange with the opposite of the pressed prop on click', () => {
    const onPressedChange = jest.fn();
    const { rerender } = render(
      <ChoiceChip pressed={false} onPressedChange={onPressedChange}>
        Work
      </ChoiceChip>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(onPressedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ChoiceChip pressed onPressedChange={onPressedChange}>
        Work
      </ChoiceChip>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(onPressedChange).toHaveBeenLastCalledWith(false);
    expect(onPressedChange).toHaveBeenCalledTimes(2);
  });

  it('also calls a consumer onClick when clicked', () => {
    const onClick = jest.fn();
    const onPressedChange = jest.fn();
    render(
      <ChoiceChip
        pressed={false}
        onClick={onClick}
        onPressedChange={onPressedChange}
      >
        Work
      </ChoiceChip>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPressedChange).toHaveBeenCalledTimes(1);
  });

  it('renders as a button of type "button" so it never submits a surrounding form', () => {
    render(
      <ChoiceChip pressed={false} onPressedChange={jest.fn()}>
        Work
      </ChoiceChip>,
    );

    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('neither calls onPressedChange nor onClick when disabled and clicked', () => {
    const onClick = jest.fn();
    const onPressedChange = jest.fn();
    render(
      <ChoiceChip
        pressed={false}
        disabled
        onClick={onClick}
        onPressedChange={onPressedChange}
      >
        Work
      </ChoiceChip>,
    );
    const chip = screen.getByRole('button', { name: 'Work' });

    expect(chip).toBeDisabled();

    fireEvent.click(chip);

    expect(onPressedChange).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards the ref to the underlying button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <ChoiceChip ref={ref} pressed={false} onPressedChange={jest.fn()}>
        Work
      </ChoiceChip>,
    );

    expect(ref.current).toBe(screen.getByRole('button', { name: 'Work' }));
  });
});

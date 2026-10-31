import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DatePicker } from './DatePicker';

const openAndReadMonth = async (value: string) => {
  render(<DatePicker value={value} onChange={() => undefined} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.queryByRole('grid')).not.toBeNull());
  const grid = screen.getByRole('grid');
  return grid.getAttribute('aria-label') ?? grid.textContent ?? '';
};

describe('DatePicker', () => {
  it('opens on the month of the selected value rather than the current month', async () => {
    // Without `defaultMonth`, react-day-picker ignores `selected` for the
    // displayed month: choosing a 2024 date and reopening put the User in the
    // present month with nothing selected in view, and moved the Storybook
    // snapshot every month.
    expect(await openAndReadMonth('2024-06-15')).toMatch(/June 2024/i);
  });

  it('falls back to the current month when no value is set', async () => {
    const label = new Date().toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    expect(await openAndReadMonth('')).toMatch(new RegExp(label, 'i'));
  });

  it('ignores an unparseable value and shows the placeholder', () => {
    render(
      <DatePicker
        value="not-a-date"
        onChange={() => undefined}
        placeholder="Pick a due date"
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('Pick a due date');
  });

  it('forwards aria-invalid and aria-describedby to the trigger button', () => {
    render(
      <DatePicker
        value=""
        onChange={() => undefined}
        aria-invalid={true}
        aria-describedby="err-1"
      />,
    );
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'err-1');
  });

  it('renders no aria-invalid or aria-describedby when neither prop is passed', () => {
    render(<DatePicker value="" onChange={() => undefined} />);
    const trigger = screen.getByRole('button');
    expect(trigger).not.toHaveAttribute('aria-invalid');
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });
});

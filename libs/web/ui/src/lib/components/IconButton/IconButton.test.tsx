import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('uses label as the accessible name and overrides a caller aria-label', () => {
    render(
      <IconButton label="Close dialog" aria-label="Ignored" icon={<span />} />,
    );

    expect(
      screen.getByRole('button', { name: 'Close dialog' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ignored' })).toBeNull();
  });

  it('defaults type to "button"', () => {
    render(<IconButton label="Open menu" icon={<span />} />);

    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('is disabled and does not call onClick when pressed', () => {
    const onClick = jest.fn();
    render(
      <IconButton label="Delete" icon={<span />} disabled onClick={onClick} />,
    );
    const button = screen.getByRole('button', { name: 'Delete' });

    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a spinner in place of the icon when loading and does not call onClick', () => {
    const onClick = jest.fn();
    const { container } = render(
      <IconButton
        label="Sync"
        icon={<span data-testid="glyph" />}
        loading
        onClick={onClick}
      />,
    );
    const button = screen.getByRole('button', { name: 'Sync' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('glyph')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards the ref to the underlying button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} label="Add" icon={<span />} />);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Add' }));
  });
});

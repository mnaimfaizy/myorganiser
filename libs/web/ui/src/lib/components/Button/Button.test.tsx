import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from './Button';

describe('Button', () => {
  describe('pressed', () => {
    it('calls onClick when pressed', () => {
      const onClick = jest.fn();
      render(<Button onClick={onClick}>Save</Button>);

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders a native button with no explicit type attribute', () => {
      render(<Button>Save</Button>);

      // Button does not set `type`; the browser default (submit) applies.
      expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute(
        'type',
      );
    });
  });

  describe('disabled', () => {
    it('is disabled and does not call onClick when pressed', () => {
      const onClick = jest.fn();
      render(
        <Button disabled onClick={onClick}>
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Save' });

      expect(button).toBeDisabled();
      fireEvent.click(button);

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('loading', () => {
    it('sets aria-busy and disables the button even when disabled={false}', () => {
      render(
        <Button loading disabled={false}>
          Saving…
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Saving…' });

      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toBeDisabled();
    });

    it('renders an aria-hidden spinner before the children', () => {
      render(<Button loading>Saving…</Button>);
      const button = screen.getByRole('button', { name: 'Saving…' });
      const spinner = button.querySelector('svg');

      expect(spinner).not.toBeNull();
      expect(spinner).toHaveAttribute('aria-hidden', 'true');
      expect(button.firstChild).toBe(spinner);
      expect(button).toHaveTextContent('Saving…');
    });

    it('does not call onClick when pressed', () => {
      const onClick = jest.fn();
      render(
        <Button loading onClick={onClick}>
          Saving…
        </Button>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('caller aria-busy', () => {
    it('keeps a caller aria-busy when not loading', () => {
      render(<Button aria-busy="true">Refresh</Button>);

      expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });
  });

  describe('asChild', () => {
    it('renders the single anchor child instead of a button', () => {
      render(
        <Button asChild>
          <a href="/settings">Settings</a>
        </Button>,
      );

      const link = screen.getByRole('link', { name: 'Settings' });

      expect(link.tagName).toBe('A');
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('sets aria-busy and aria-disabled on the anchor when loading, without a spinner', () => {
      const { container } = render(
        <Button asChild loading>
          <a href="/settings">Settings</a>
        </Button>,
      );
      const link = screen.getByRole('link', { name: 'Settings' });

      expect(link).toHaveAttribute('aria-busy', 'true');
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(container.querySelector('svg')).toBeNull();
    });

    it('sets aria-disabled on the anchor when disabled, without aria-busy', () => {
      render(
        <Button asChild disabled>
          <a href="/settings">Settings</a>
        </Button>,
      );
      const link = screen.getByRole('link', { name: 'Settings' });

      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(link).not.toHaveAttribute('aria-busy');
    });
  });

  describe('link variant merge', () => {
    it('link variant with default size resolves to h-8 and drops the size height', () => {
      render(
        <Button variant="link" size="default">
          Details
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Details' });

      // The link compoundVariant appends h-8 after the default size's h-12
      // and md:h-11; cn() merges them so the compound height wins.
      expect(button).toHaveClass('h-8');
      expect(button).not.toHaveClass('h-12');
      expect(button).not.toHaveClass('h-11');
      expect(button).not.toHaveClass('md:h-11');
    });
  });
});

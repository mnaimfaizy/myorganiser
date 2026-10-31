/*
  Tests for AddExistingItemDialog component.
  - Mocks @myorganiser/web-ui Dialog/DialogContent/Button/Input/Label/Checkbox/cn
  - Mocks lucide-react icons
  - Covers catalog search/filter, single-select semantics, list toggling,
    submit-button gating, submit argument shape, cancel, and re-open reset
*/

/** Mocking rule: place jest.mock calls before any imports */
jest.mock('@myorganiser/web-ui', () => {
  const React = require('react');

  function Dialog({ open, onOpenChange, children }: any) {
    if (!open) return null;
    return (
      <div data-testid="dialog-root">
        <div
          data-testid="dialog-backdrop"
          onClick={() => onOpenChange?.(false)}
        />
        {children}
      </div>
    );
  }

  const DialogContent = ({ children, className }: any) => (
    <div className={className}>{children}</div>
  );

  const DialogTitle = ({ children }: any) => <h2>{children}</h2>;

  const DialogDescription = ({ children }: any) => <p>{children}</p>;

  function Button({ children, onClick, disabled, type, variant }: any) {
    return (
      <button
        type={type}
        data-variant={variant}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    );
  }

  function Input(props: any) {
    const { className, ...rest } = props;
    return <input className={className} {...rest} />;
  }

  function Label({ children, htmlFor, className }: any) {
    return (
      <label htmlFor={htmlFor} className={className}>
        {children}
      </label>
    );
  }

  function Checkbox({ checked, onCheckedChange, disabled, ...rest }: any) {
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onCheckedChange?.(!checked)}
        disabled={disabled}
        {...rest}
      />
    );
  }

  return {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    Button,
    Input,
    Label,
    Checkbox,
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
  };
});

jest.mock('lucide-react', () => ({
  Lock: () => <div data-testid="lock-icon" />,
  Search: () => <div data-testid="search-icon" />,
}));

import type { CatalogItem, GroceryList } from '@myorganiser/vault-core';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddExistingItemDialog } from '../components/AddExistingItemDialog';

describe('AddExistingItemDialog', () => {
  function makeCatalogItem(
    id: string,
    name: string,
    overrides: Partial<CatalogItem> = {},
  ): CatalogItem {
    return {
      id,
      name,
      category: 'other',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeList(id: string, name: string): GroceryList {
    return {
      id,
      name,
      lines: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    catalog: [
      makeCatalogItem('c1', 'Milk'),
      makeCatalogItem('c2', 'Bread'),
      makeCatalogItem('c3', 'Almond Milk'),
    ],
    lists: [makeList('l1', 'Weekly'), makeList('l2', 'Party')],
    defaultListId: 'l1',
    onAdd: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an empty-state message and keeps submit disabled when catalog is empty', () => {
    render(<AddExistingItemDialog {...defaultProps} catalog={[]} />);

    expect(
      screen.getByText(/There are no Catalog Items yet/i),
    ).toBeInTheDocument();
    const submitButton = screen.getByText('Add to Lists', {
      selector: 'button',
    });
    expect(submitButton).toBeDisabled();
  });

  it('filters the catalog list by case-insensitive substring search', () => {
    render(<AddExistingItemDialog {...defaultProps} />);

    const search = screen.getByPlaceholderText('Search catalog by name...');
    fireEvent.change(search, { target: { value: 'milk' } });

    expect(screen.getByText('Milk')).toBeInTheDocument();
    expect(screen.getByText('Almond Milk')).toBeInTheDocument();
    expect(screen.queryByText('Bread')).not.toBeInTheDocument();
  });

  it('supports single-select semantics: selecting a second item deselects the first', () => {
    render(<AddExistingItemDialog {...defaultProps} />);

    const milkRadio = screen.getByText('Milk').closest('button') as HTMLElement;
    const breadRadio = screen
      .getByText('Bread')
      .closest('button') as HTMLElement;

    fireEvent.click(milkRadio);
    expect(milkRadio).toHaveAttribute('aria-checked', 'true');
    expect(breadRadio).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(breadRadio);
    expect(milkRadio).toHaveAttribute('aria-checked', 'false');
    expect(breadRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('pre-selects the defaultListId checkbox and allows toggling additional lists', () => {
    render(<AddExistingItemDialog {...defaultProps} />);

    const weeklyCheckbox = screen.getByLabelText(
      'Add to Weekly',
    ) as HTMLInputElement;
    const partyCheckbox = screen.getByLabelText(
      'Add to Party',
    ) as HTMLInputElement;

    expect(weeklyCheckbox.checked).toBe(true);
    expect(partyCheckbox.checked).toBe(false);

    fireEvent.click(partyCheckbox);
    expect(partyCheckbox.checked).toBe(true);
  });

  it('keeps submit disabled until both a catalog item and a list are selected', () => {
    render(
      <AddExistingItemDialog {...defaultProps} defaultListId={undefined} />,
    );

    const submitButton = screen.getByText('Add to Lists', {
      selector: 'button',
    });
    expect(submitButton).toBeDisabled();

    const milkRadio = screen.getByText('Milk').closest('button') as HTMLElement;
    fireEvent.click(milkRadio);
    // Catalog item selected, but no list selected yet
    expect(submitButton).toBeDisabled();

    const weeklyCheckbox = screen.getByLabelText('Add to Weekly');
    fireEvent.click(weeklyCheckbox);
    expect(submitButton).not.toBeDisabled();
  });

  it('calls onAdd with exact arguments, converting an empty amount to undefined', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddExistingItemDialog {...defaultProps} onAdd={onAdd} />);

    const milkRadio = screen.getByText('Milk').closest('button') as HTMLElement;
    fireEvent.click(milkRadio);

    const submitButton = screen.getByText('Add to Lists', {
      selector: 'button',
    });
    fireEvent.click(submitButton);

    await Promise.resolve();

    expect(onAdd).toHaveBeenCalledWith('c1', ['l1'], undefined);
  });

  it('calls onAdd with the typed amount when provided', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddExistingItemDialog {...defaultProps} onAdd={onAdd} />);

    const milkRadio = screen.getByText('Milk').closest('button') as HTMLElement;
    fireEvent.click(milkRadio);

    const amountInput = screen.getByPlaceholderText('e.g. 2, 500g');
    fireEvent.change(amountInput, { target: { value: '2L' } });

    const submitButton = screen.getByText('Add to Lists', {
      selector: 'button',
    });
    fireEvent.click(submitButton);

    await Promise.resolve();

    expect(onAdd).toHaveBeenCalledWith('c1', ['l1'], '2L');
  });

  it('calls onClose without calling onAdd when Cancel is clicked', () => {
    const onClose = jest.fn();
    const onAdd = jest.fn();
    render(
      <AddExistingItemDialog
        {...defaultProps}
        onClose={onClose}
        onAdd={onAdd}
      />,
    );

    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('calls onClose without calling onAdd when the dialog backdrop triggers onOpenChange(false)', () => {
    const onClose = jest.fn();
    const onAdd = jest.fn();
    render(
      <AddExistingItemDialog
        {...defaultProps}
        onClose={onClose}
        onAdd={onAdd}
      />,
    );

    fireEvent.click(screen.getByTestId('dialog-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('resets search, selection, and lists back to just defaultListId when re-opened', () => {
    const { rerender } = render(<AddExistingItemDialog {...defaultProps} />);

    const search = screen.getByPlaceholderText('Search catalog by name...');
    fireEvent.change(search, { target: { value: 'bread' } });

    const breadRadio = screen
      .getByText('Bread')
      .closest('button') as HTMLElement;
    fireEvent.click(breadRadio);

    const partyCheckbox = screen.getByLabelText(
      'Add to Party',
    ) as HTMLInputElement;
    fireEvent.click(partyCheckbox);
    expect(partyCheckbox.checked).toBe(true);

    // Close then re-open
    rerender(<AddExistingItemDialog {...defaultProps} isOpen={false} />);
    rerender(<AddExistingItemDialog {...defaultProps} isOpen={true} />);

    const searchAfterReopen = screen.getByPlaceholderText(
      'Search catalog by name...',
    ) as HTMLInputElement;
    expect(searchAfterReopen.value).toBe('');

    // All items should be visible again (search cleared)
    expect(screen.getByText('Milk')).toBeInTheDocument();
    expect(screen.getByText('Bread')).toBeInTheDocument();

    const breadRadioAfterReopen = screen
      .getByText('Bread')
      .closest('button') as HTMLElement;
    expect(breadRadioAfterReopen).toHaveAttribute('aria-checked', 'false');

    const weeklyCheckboxAfterReopen = screen.getByLabelText(
      'Add to Weekly',
    ) as HTMLInputElement;
    const partyCheckboxAfterReopen = screen.getByLabelText(
      'Add to Party',
    ) as HTMLInputElement;
    expect(weeklyCheckboxAfterReopen.checked).toBe(true);
    expect(partyCheckboxAfterReopen.checked).toBe(false);
  });
});

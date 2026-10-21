import '@testing-library/jest-dom';
import type { CatalogItem } from '@myorganiser/vault-core';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import type { AddItemFormResult } from '../components/AddItemDialog';
import { AddItemDialog } from '../components/AddItemDialog';

interface HarnessProps {
  onAdd: (values: AddItemFormResult) => Promise<void>;
  onClose?: () => void;
  isLoading?: boolean;
  catalog?: CatalogItem[];
  mode?: 'list' | 'catalog';
  listName?: string;
  initialName?: string;
}

/** Opens the real dialog from a button, so Cancel and close handling run through the open state. */
function Harness({
  onAdd,
  onClose,
  isLoading = false,
  catalog = [],
  mode = 'list',
  listName,
  initialName,
}: HarnessProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button data-testid="open-dialog" onClick={() => setOpen(true)}>
        Open
      </button>
      <AddItemDialog
        isOpen={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        onAdd={onAdd}
        isLoading={isLoading}
        catalog={catalog}
        mode={mode}
        listName={listName}
        initialName={initialName}
      />
    </div>
  );
}

const MILK: CatalogItem = {
  id: 'catalog-milk',
  name: 'Organic Milk',
  category: 'dairy',
  price: 4.5,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const OAT_MILK: CatalogItem = {
  id: 'catalog-oat',
  name: 'Oat Milk',
  category: 'dairy',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Runs a user event inside act. The zod resolver settles on a microtask after
 * each change, so the validation state must flush inside the act boundary.
 */
async function interact(event: () => void) {
  await act(async () => {
    event();
  });
}

async function typeInto(element: HTMLElement, value: string) {
  await interact(() => fireEvent.change(element, { target: { value } }));
}

function openDialog() {
  fireEvent.click(screen.getByTestId('open-dialog'));
}

function nameInput() {
  return screen.getByRole('combobox', { name: 'Item' }) as HTMLInputElement;
}

function submitButton() {
  return screen.getByRole('button', { name: /^Add to (list|catalog)$/ });
}

/** Validity resolves asynchronously after a change, so wait for the button to enable. */
async function clickSubmitWhenValid() {
  await waitFor(() => expect(submitButton()).toBeEnabled());
  await interact(() => fireEvent.click(submitButton()));
}

describe('AddItemDialog integration', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('shows a list-named title only once opened, and falls back to "Add item" without a list name', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <Harness onAdd={onAdd} listName="Weekly shop" />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openDialog();
    const dialog = await screen.findByRole('dialog', {
      name: 'Add item to Weekly shop',
    });
    expect(
      within(dialog).getByText('Encrypted on this device before it syncs'),
    ).toBeInTheDocument();

    rerender(<Harness onAdd={onAdd} />);
    expect(
      await screen.findByRole('dialog', { name: 'Add item' }),
    ).toBeInTheDocument();
  });

  it('catalog mode titles the dialog as a Catalog Item, with no Amount and "Add to catalog"', async () => {
    render(
      <AddItemDialog
        isOpen={true}
        onClose={jest.fn()}
        onAdd={jest.fn().mockResolvedValue(undefined)}
        mode="catalog"
      />,
    );

    expect(
      await screen.findByRole('dialog', { name: 'New Catalog Item' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Price each')).toBeInTheDocument();
    expect(
      screen.queryByText('Updates the Catalog Item'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add to catalog' }),
    ).toBeInTheDocument();
  });

  it('lists matching Catalog items with category and price, plus an add-as-new option', async () => {
    render(
      <Harness
        onAdd={jest.fn().mockResolvedValue(undefined)}
        catalog={[MILK, OAT_MILK]}
      />,
    );
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'milk');

    const listbox = await screen.findByRole('listbox', {
      name: 'From your Catalog',
    });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent('Organic Milk · Dairy');
    expect(options[0]).toHaveTextContent('$4.50');
    expect(options[1]).toHaveTextContent('Oat Milk · Dairy');
    expect(options[2]).toHaveTextContent('Add “milk” as a new Catalog Item');
  });

  it('ArrowDown then Enter selects the highlighted Catalog item and fills name, category and price', async () => {
    render(
      <Harness
        onAdd={jest.fn().mockResolvedValue(undefined)}
        catalog={[MILK, OAT_MILK]}
      />,
    );
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'milk');
    await screen.findByRole('listbox', { name: 'From your Catalog' });

    fireEvent.keyDown(nameInput(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await interact(() => fireEvent.keyDown(nameInput(), { key: 'Enter' }));

    expect(nameInput().value).toBe('Oat Milk');
    expect(screen.getByRole('radio', { name: 'Dairy' })).toBeChecked();
    // Oat Milk has no price, so Price each stays empty.
    expect(screen.getByLabelText('Price each')).toHaveValue(null);
    expect(
      screen.getByText('Already in your Catalog — this adds it to this list.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('listbox', { name: 'From your Catalog' }),
    ).not.toBeInTheDocument();
  });

  it('clicking a Catalog item selects it and submits its catalog identity and price', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<Harness onAdd={onAdd} catalog={[MILK]} listName="Weekly shop" />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'milk');
    await interact(() =>
      fireEvent.click(
        screen.getByRole('option', { name: /Organic Milk · Dairy/ }),
      ),
    );

    expect(nameInput().value).toBe('Organic Milk');
    expect(screen.getByLabelText('Price each')).toHaveValue(4.5);
    expect(
      screen.getByText(
        'Already in your Catalog — this adds it to Weekly shop.',
      ),
    ).toBeInTheDocument();

    await clickSubmitWhenValid();

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toEqual({
      name: 'Organic Milk',
      category: 'dairy',
      catalogItemId: 'catalog-milk',
      amount: undefined,
      price: 4.5,
      notes: undefined,
      imageUrl: undefined,
      links: undefined,
    });
  });

  it('editing the name clears a pick, and Add as a new Catalog Item keeps the typed name without catalogItemId', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<Harness onAdd={onAdd} catalog={[MILK]} listName="Weekly shop" />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'milk');
    await interact(() =>
      fireEvent.click(
        screen.getByRole('option', { name: /Organic Milk · Dairy/ }),
      ),
    );
    expect(
      screen.getByText(
        'Already in your Catalog — this adds it to Weekly shop.',
      ),
    ).toBeInTheDocument();

    await typeInto(nameInput(), 'Organic Milk 2');

    expect(
      screen.queryByText(/Already in your Catalog/),
    ).not.toBeInTheDocument();

    // A pick closes the listbox and any keystroke clears it, so the add-as-new
    // option is only reachable by typing again; the branch keeps the typed name.
    await typeInto(nameInput(), 'milk');
    await interact(() =>
      fireEvent.click(
        screen.getByRole('option', {
          name: 'Add “milk” as a new Catalog Item',
        }),
      ),
    );
    expect(nameInput().value).toBe('milk');
    expect(
      screen.queryByRole('listbox', { name: 'From your Catalog' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Already in your Catalog/),
    ).not.toBeInTheDocument();

    await clickSubmitWhenValid();

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).not.toHaveProperty('catalogItemId');
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'milk' });
  });

  it('defaults the category to Other, and choosing another radio changes the submitted category', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<Harness onAdd={onAdd} />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked();

    await interact(() =>
      fireEvent.click(screen.getByRole('radio', { name: 'Produce' })),
    );
    expect(screen.getByRole('radio', { name: 'Produce' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Other' })).not.toBeChecked();

    await typeInto(nameInput(), 'Apples');
    await clickSubmitWhenValid();

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      name: 'Apples',
      category: 'produce',
    });
  });

  it('shows schema messages for an invalid amount, an out-of-range price and an empty name, and blocks submit', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<Harness onAdd={onAdd} listName="Weekly shop" />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'Milk');
    await typeInto(screen.getByLabelText('Amount'), 'abc');
    expect(
      await screen.findByText(
        'Quantity must be a valid non-negative number or a value such as 500g or 1 dozen',
      ),
    ).toBeInTheDocument();

    await typeInto(screen.getByLabelText('Amount'), '2');
    await typeInto(screen.getByLabelText('Price each'), '100000');
    expect(
      await screen.findByText('Price must be between 0 and 99,999'),
    ).toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeDisabled());

    await typeInto(screen.getByLabelText('Price each'), '');
    await typeInto(nameInput(), '   ');
    expect(
      await screen.findByText('Item name is required'),
    ).toBeInTheDocument();
    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('"Image and links" disclosure toggles aria-expanded and reveals the image URL and links', async () => {
    render(<Harness onAdd={jest.fn().mockResolvedValue(undefined)} />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    const toggle = screen.getByRole('button', { name: 'Image and links' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/^Image URL/)).not.toBeInTheDocument();

    await interact(() => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Image URL/)).toBeInTheDocument();
    expect(screen.getByText('Add another link')).toBeInTheDocument();

    await typeInto(
      screen.getByLabelText(/^Image URL/),
      'http://preview.example/img.png',
    );
    expect(await screen.findByAltText('Item preview')).toBeInTheDocument();
  });

  it('an invalid image URL or link keeps the disclosure open and its error visible', async () => {
    render(<Harness onAdd={jest.fn().mockResolvedValue(undefined)} />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    const toggle = screen.getByRole('button', { name: 'Image and links' });
    await interact(() => fireEvent.click(toggle));
    await typeInto(screen.getByLabelText(/^Image URL/), 'not-a-url');
    expect(await screen.findByText('Must be a valid URL')).toBeInTheDocument();

    // The click flips isOpen, but isExpanded = isOpen || hasErrors keeps the disclosure open.
    await interact(() => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^Image URL/)).toBeInTheDocument();
    expect(screen.getByText('Must be a valid URL')).toBeInTheDocument();

    // Clear the image URL so only errors.links can hold the disclosure open.
    await typeInto(screen.getByLabelText(/^Image URL/), '');
    await waitFor(() =>
      expect(screen.queryByText('Must be a valid URL')).not.toBeInTheDocument(),
    );

    // The previous click left isOpen false, so the cleared image URL collapsed
    // the disclosure. Reopen it, then add an invalid link.
    await interact(() => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await interact(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Add another link' })),
    );
    await typeInto(
      screen.getByPlaceholderText('https://example.com'),
      'not-a-url',
    );
    expect(
      await screen.findByText('Each link must be a valid URL'),
    ).toBeInTheDocument();

    // Collapse request with isOpen false: only errors.links keeps it expanded.
    await interact(() => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByPlaceholderText('https://example.com'),
    ).toBeInTheDocument();
  });

  it('minimal submit calls onAdd with empty optionals undefined, then closes and resets on reopen', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<Harness onAdd={onAdd} onClose={onClose} />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'Milk');
    await clickSubmitWhenValid();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0][0];
    expect(payload).toEqual({
      name: 'Milk',
      category: 'other',
      amount: undefined,
      price: undefined,
      notes: undefined,
      imageUrl: undefined,
      links: undefined,
    });
    expect(payload).not.toHaveProperty('catalogItemId');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openDialog();
    expect(await screen.findByRole('combobox', { name: 'Item' })).toHaveValue(
      '',
    );
  });

  it('full submit maps every field: amount string, price number, notes, image and links', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<Harness onAdd={onAdd} onClose={onClose} listName="Weekly shop" />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'Full Milk');
    await interact(() =>
      fireEvent.click(screen.getByRole('radio', { name: 'Produce' })),
    );
    await typeInto(screen.getByLabelText('Amount'), '2L');
    await typeInto(screen.getByLabelText('Price each'), '4.50');
    await typeInto(screen.getByLabelText('Notes'), 'Some notes');

    await interact(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Image and links' })),
    );
    await typeInto(
      screen.getByLabelText(/^Image URL/),
      'http://img.example/pic.jpg',
    );
    await interact(() => fireEvent.click(screen.getByText('Add another link')));
    await typeInto(
      screen.getByPlaceholderText('https://example.com'),
      'http://a.link',
    );

    await clickSubmitWhenValid();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: 'Full Milk',
      category: 'produce',
      amount: '2L',
      price: 4.5,
      notes: 'Some notes',
      imageUrl: 'http://img.example/pic.jpg',
      links: ['http://a.link'],
    });
  });

  it('keeps the dialog open with its values when onAdd rejects', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const onAdd = jest.fn().mockRejectedValue(new Error('save failed'));
    const onClose = jest.fn();
    render(<Harness onAdd={onAdd} onClose={onClose} />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'Milk');
    await clickSubmitWhenValid();

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to add item:',
        expect.any(Error),
      ),
    );
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Add item' }),
    ).toBeInTheDocument();
    expect(nameInput().value).toBe('Milk');
  });

  it('prefills the Item name from initialName when opened', async () => {
    render(
      <Harness
        onAdd={jest.fn().mockResolvedValue(undefined)}
        initialName="Oat drink"
      />,
    );
    openDialog();

    expect(await screen.findByRole('combobox', { name: 'Item' })).toHaveValue(
      'Oat drink',
    );
  });

  it('Cancel resets the typed values and calls onClose', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<Harness onAdd={onAdd} onClose={onClose} />);
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    await typeInto(nameInput(), 'Temp Name');
    expect(nameInput().value).toBe('Temp Name');

    await interact(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' })),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAdd).not.toHaveBeenCalled();

    openDialog();
    expect(await screen.findByRole('combobox', { name: 'Item' })).toHaveValue(
      '',
    );
  });

  it('isLoading disables the Item, Amount and Price fields and both footer buttons', async () => {
    render(
      <Harness
        onAdd={jest.fn().mockResolvedValue(undefined)}
        isLoading={true}
      />,
    );
    openDialog();
    await screen.findByRole('combobox', { name: 'Item' });

    expect(nameInput()).toBeDisabled();
    expect(screen.getByLabelText('Amount')).toBeDisabled();
    expect(screen.getByLabelText('Price each')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(submitButton()).toBeDisabled();
  });
});

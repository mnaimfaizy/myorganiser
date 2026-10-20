import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Input } from '../Input/Input';
import { Label } from '../Label/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './Dialog';

const TRIGGER = 'New list';
const TITLE = 'New list';
const DESCRIPTION = 'Name it for the shop or the occasion.';

function renderDialog({
  showCloseButton = true,
}: { showCloseButton?: boolean } = {}) {
  render(
    <Dialog>
      <DialogTrigger>{TRIGGER}</DialogTrigger>
      <DialogContent showCloseButton={showCloseButton}>
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>{DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="new-list-name">List name</Label>
          <Input id="new-list-name" defaultValue="Saturday market" />
        </div>
      </DialogContent>
    </Dialog>,
  );
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
  return screen.getByRole('dialog', { name: TITLE });
}

describe('Dialog', () => {
  it('opens from the trigger as a dialog named by the title and described by the description', () => {
    renderDialog();

    const dialog = openDialog();

    expect(dialog).toHaveAccessibleName(TITLE);
    expect(dialog).toHaveAccessibleDescription(DESCRIPTION);
  });

  it('closes when the Close button is clicked', async () => {
    renderDialog();
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('renders no Close button when showCloseButton is false', () => {
    renderDialog({ showCloseButton: false });
    const dialog = openDialog();

    expect(
      within(dialog).queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderDialog();
    const dialog = openDialog();

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('traps focus: focus moved outside the open dialog returns to an element inside it', () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    try {
      renderDialog();
      const dialog = openDialog();

      outside.focus();

      expect(dialog.contains(document.activeElement)).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it('returns focus to the trigger when the dialog closes', async () => {
    renderDialog();
    const trigger = screen.getByRole('button', { name: TRIGGER });
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('exposes the form input inside the dialog by its label', () => {
    renderDialog();
    const dialog = openDialog();

    const input = within(dialog).getByRole('textbox', { name: 'List name' });

    expect(input).toHaveValue('Saturday market');
  });
});

import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../Dialog/Dialog';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

const TITLE = 'Delete “Costco run”?';
const DESCRIPTION =
  'This removes the list and its 12 items. This cannot be undone.';
const CONFIRM_LABEL = 'Delete list';

const originalInnerWidth = window.innerWidth;

function renderDialog(overrides: Partial<ConfirmDialogProps> = {}) {
  const onOpenChange = jest.fn();
  const onConfirm = jest.fn();
  render(
    <ConfirmDialog
      open={true}
      title={TITLE}
      description={DESCRIPTION}
      confirmLabel={CONFIRM_LABEL}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onOpenChange, onConfirm };
}

// Radix attaches its outside-pointerdown listener on a setTimeout(0).
async function flushRadixListeners() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ConfirmDialog', () => {
  afterEach(() => {
    window.innerWidth = originalInnerWidth;
    jest.restoreAllMocks();
  });

  it('renders an alertdialog named by the title and described by the consequence', () => {
    renderDialog();

    const dialog = screen.getByRole('alertdialog', { name: TITLE });
    expect(dialog).toHaveAccessibleDescription(DESCRIPTION);
  });

  it('names the confirm button exactly as confirmLabel and keeps the default Cancel label', () => {
    renderDialog();

    expect(
      screen.getByRole('button', { name: CONFIRM_LABEL }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('moves initial focus to Cancel when opened', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('returns focus inside the dialog when focus moves outside it', () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    try {
      renderDialog();
      const cancel = screen.getByRole('button', { name: 'Cancel' });

      outside.focus();

      expect(cancel).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  it('calls onConfirm once and does not close the dialog itself', async () => {
    const { onConfirm, onOpenChange } = renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL }));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables the confirm button with aria-busy while onConfirm is pending, and re-enables it on resolve', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    renderDialog({ onConfirm });
    const confirm = screen.getByRole('button', { name: CONFIRM_LABEL });

    fireEvent.click(confirm);

    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveTextContent(/^Delete list…$/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    await act(async () => {
      resolveConfirm();
    });

    await waitFor(() => expect(confirm).toBeEnabled());
    expect(confirm).not.toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveTextContent(/^Delete list$/);
  });

  it('keeps the dialog open and re-enables the confirm button when onConfirm rejects', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const failure = new Error('Server unavailable');
    const onConfirm = jest.fn(() => Promise.reject(failure));
    const { onOpenChange } = renderDialog({ onConfirm });
    const confirm = screen.getByRole('button', { name: CONFIRM_LABEL });

    await act(async () => {
      fireEvent.click(confirm);
    });

    await waitFor(() => expect(confirm).toBeEnabled());
    expect(
      screen.getByRole('alertdialog', { name: TITLE }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'ConfirmDialog: onConfirm rejected:',
      failure,
    );
  });

  it('Cancel calls onOpenChange(false) and never calls onConfirm', () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape calls onOpenChange(false) and never calls onConfirm', () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.keyDown(screen.getByRole('alertdialog'), {
      key: 'Escape',
      code: 'Escape',
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not dismiss on a pointer-down outside the dialog', async () => {
    const { onOpenChange } = renderDialog();
    await flushRadixListeners();

    fireEvent.pointerDown(document.body);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('control: a plain Dialog does dismiss on the same pointer-down, so the outside path is reachable in jsdom', async () => {
    const onOpenChange = jest.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Plain dialog</DialogTitle>
          <DialogDescription>Plain description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await flushRadixListeners();

    fireEvent.pointerDown(document.body);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('gives tone="destructive" the destructive variant on the confirm button', () => {
    renderDialog({ tone: 'destructive' });

    const confirm = screen.getByRole('button', { name: CONFIRM_LABEL });
    expect(confirm).toHaveClass('bg-destructive');
    expect(confirm).not.toHaveClass('bg-primary');
  });

  it('gives the default tone the primary variant on the confirm button', () => {
    renderDialog();

    const confirm = screen.getByRole('button', { name: CONFIRM_LABEL });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-destructive');
  });

  it('phone sheet: moves initial focus to Cancel and returns focus to Cancel when focus moves outside', () => {
    window.innerWidth = 375;
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    try {
      renderDialog({ tone: 'destructive' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(cancel).toHaveFocus();

      outside.focus();

      expect(cancel).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  it('renders the same title, description and buttons as the phone sheet, with the destructive button before Cancel', () => {
    window.innerWidth = 375;
    renderDialog({ tone: 'destructive' });

    const sheet = screen.getByRole('alertdialog', { name: TITLE });
    expect(sheet).toHaveAccessibleDescription(DESCRIPTION);

    const confirm = screen.getByRole('button', { name: CONFIRM_LABEL });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(
      confirm.compareDocumentPosition(cancel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

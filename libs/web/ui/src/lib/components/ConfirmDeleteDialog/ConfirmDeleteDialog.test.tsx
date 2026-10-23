import '@testing-library/jest-dom';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

describe('ConfirmDeleteDialog', () => {
  // Helper to resolve a pending promise
  const resolvePending = (resolvers: { resolve?: () => void }) => {
    return act(async () => {
      resolvers.resolve?.();
    });
  };

  it('should render the title and description when open', () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete this item?"
        description="This action cannot be undone."
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('Delete this item?')).toBeInTheDocument();
    expect(
      screen.getByText('This action cannot be undone.'),
    ).toBeInTheDocument();
  });

  it('should invoke onConfirm when the confirm button is clicked', async () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should not invoke onConfirm when the cancel button is clicked', async () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should disable the confirm button and show pending state while onConfirm promise is pending', async () => {
    const onOpenChange = jest.fn();
    const resolvers: { resolve?: () => void } = {};
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.resolve = resolve;
        }),
    );

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    // Button should be disabled while pending
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Button should show pending state with ellipsis
    expect(confirmButton).toHaveTextContent('Delete…');

    // Resolve the promise
    await resolvePending(resolvers);

    // Button should be re-enabled after promise resolves
    await waitFor(() => {
      expect(confirmButton).not.toBeDisabled();
      expect(confirmButton).toHaveTextContent('Delete');
    });
  });

  it('should keep the cancel button enabled and allow dismissal while onConfirm promise is pending', async () => {
    const onOpenChange = jest.fn();
    const resolvers: { resolve?: () => void } = {};
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.resolve = resolve;
        }),
    );

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });

    expect(cancelButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Cancel button should remain enabled while pending
    expect(cancelButton).not.toBeDisabled();

    // Clicking cancel should still call onOpenChange even while pending
    fireEvent.click(cancelButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await resolvePending(resolvers);
  });

  it('should keep the close button visible while onConfirm promise is pending', async () => {
    const onOpenChange = jest.fn();
    const resolvers: { resolve?: () => void } = {};
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.resolve = resolve;
        }),
    );

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    // Close button should be visible initially
    let closeButton = screen.queryByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Close button should remain visible while pending
    closeButton = screen.queryByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    await resolvePending(resolvers);

    // Close button should still be visible after promise resolves
    closeButton = screen.queryByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();
  });

  it('should allow dialog dismissal via Escape while onConfirm promise is pending', async () => {
    const onOpenChange = jest.fn();
    const resolvers: { resolve?: () => void } = {};
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.resolve = resolve;
        }),
    );

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Find the dialog content element
    const dialogContent = screen.getByRole('alertdialog');
    expect(dialogContent).toBeInTheDocument();

    // Send Escape key while pending
    if (dialogContent) {
      fireEvent.keyDown(dialogContent, { key: 'Escape', code: 'Escape' });
    }

    // onOpenChange should be called (dialog should dismiss)
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // onConfirm should not be called again
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await resolvePending(resolvers);
  });

  it('should allow dialog dismissal via Escape when not pending', async () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const dialogContent = screen.getByRole('alertdialog');
    expect(dialogContent).toBeInTheDocument();

    // Send Escape key while not pending
    if (dialogContent) {
      fireEvent.keyDown(dialogContent, { key: 'Escape', code: 'Escape' });
    }

    // onOpenChange should be called with false
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('should handle async onConfirm that completes successfully', async () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn(() => Promise.resolve());

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(confirmButton).not.toBeDisabled();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should use confirmLabel for the confirm button text and pending state', async () => {
    const onOpenChange = jest.fn();
    const resolvers: { resolve?: () => void } = {};
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.resolve = resolve;
        }),
    );

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Disconnect account?"
        description="You can reconnect later."
        onConfirm={onConfirm}
        confirmLabel="Disconnect"
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /disconnect/i });
    expect(confirmButton).toHaveTextContent('Disconnect');

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
      expect(confirmButton).toHaveTextContent('Disconnect…');
    });

    await resolvePending(resolvers);

    await waitFor(() => {
      expect(confirmButton).not.toBeDisabled();
      expect(confirmButton).toHaveTextContent('Disconnect');
    });
  });

  it('should re-enable the confirm button when onConfirm rejects', async () => {
    const onOpenChange = jest.fn();
    // Delay rejection to allow pending state to be visible, then throw error
    const onConfirm = jest.fn(() =>
      Promise.resolve().then(() => {
        throw new Error('Deletion failed');
      }),
    );

    render(
      <ConfirmDeleteDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    expect(confirmButton).not.toBeDisabled();

    // Suppress console.error and console.warn for unhandled rejection warnings
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    try {
      fireEvent.click(confirmButton);

      // Button should be disabled while pending and show pending state
      await waitFor(() => {
        expect(confirmButton).toBeDisabled();
        expect(confirmButton).toHaveTextContent('Delete…');
      });

      // Button should be re-enabled after rejection settles
      await waitFor(() => {
        expect(confirmButton).not.toBeDisabled();
        expect(confirmButton).toHaveTextContent('Delete');
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});

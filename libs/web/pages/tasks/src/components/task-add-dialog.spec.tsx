import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskAddDialog } from './task-add-dialog';

const TITLE_TEXT = 'Add task';
const DESCRIPTION_TEXT = 'Encrypted on this device before it syncs';

function renderDialog(
  onSubmit: jest.Mock = jest.fn().mockResolvedValue(undefined),
) {
  const onClose = jest.fn();
  render(<TaskAddDialog isOpen onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
}

describe('TaskAddDialog', () => {
  it('shows the Add task title and the encryption description when open', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: TITLE_TEXT });
    expect(dialog).toHaveAccessibleDescription(DESCRIPTION_TEXT);
  });

  it('shows the title error and does not submit when the title is empty', async () => {
    const { onSubmit, onClose } = renderDialog();

    submit();

    expect(
      await screen.findByText('Give the task a title.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits the mapped payload once and closes after onSubmit resolves', async () => {
    const { onSubmit, onClose } = renderDialog();

    typeTitle('Book dentist');
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Work' }));
    fireEvent.change(screen.getByLabelText('Estimate'), {
      target: { value: '45 min' },
    });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-10-24' },
    });
    submit();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Book dentist',
      priority: 'high',
      context: 'work',
      status: 'pending',
      estimatedMinutes: 45,
      dueDate: '2026-10-24',
    });
  });

  it('maps Context None to no context and a blank Estimate to no estimate', async () => {
    const { onSubmit } = renderDialog();

    typeTitle('Water plants');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.context).toBeUndefined();
    expect(payload.estimatedMinutes).toBeUndefined();
    expect(payload.title).toBe('Water plants');
    expect(payload.priority).toBe('medium');
  });

  it('shows the estimate error and blocks submit for a non-numeric estimate', async () => {
    const { onSubmit, onClose } = renderDialog();

    typeTitle('Email landlord');
    fireEvent.change(screen.getByLabelText('Estimate'), {
      target: { value: 'abc' },
    });
    submit();

    expect(
      await screen.findByText('Enter minutes, for example 30.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and the typed title when onSubmit rejects', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Save failed'));
    const { onClose } = renderDialog(onSubmit);

    typeTitle('Renew passport');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add task' })).toBeEnabled(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: TITLE_TEXT }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Renew passport');
  });

  it('calls onClose without submitting when Cancel is pressed', () => {
    const { onSubmit, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

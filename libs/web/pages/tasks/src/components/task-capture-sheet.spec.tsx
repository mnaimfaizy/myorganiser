import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { TaskCaptureSheet } from './task-capture-sheet';

const TODAY = '2026-10-22';

function renderSheet(onCapture: jest.Mock = jest.fn().mockResolvedValue(true)) {
  const onOpenChange = jest.fn();
  render(
    <TaskCaptureSheet
      open
      onOpenChange={onOpenChange}
      today={TODAY}
      onCapture={onCapture}
    />,
  );
  return { onCapture, onOpenChange };
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByLabelText('New task'), {
    target: { value },
  });
}

/** Lets the form's async submit chain (validation, onCapture, reset) settle inside act. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Return in the single-line input submits the form, so the form submit event stands in for it. */
async function pressReturn() {
  const form = screen.getByLabelText('New task').closest('form');
  if (!form) throw new Error('capture form not found');
  await act(async () => {
    fireEvent.submit(form);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function chip(name: string) {
  return screen.getByRole('button', { name });
}

describe('TaskCaptureSheet', () => {
  it('captures the trimmed title with no due date or flags, then clears the input and keeps focus', async () => {
    const { onCapture } = renderSheet();
    const input = screen.getByLabelText('New task');

    typeTitle('  Renew passport  ');
    await pressReturn();

    await waitFor(() => expect(input).toHaveValue(''));
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith({
      title: 'Renew passport',
      dueDate: undefined,
      high: false,
      personal: false,
    });
    expect(input).toHaveFocus();
  });

  it('sends Today, High and Personal, then unpresses every chip after the save succeeds', async () => {
    const { onCapture } = renderSheet();

    typeTitle('Call the plumber');
    fireEvent.click(chip('Today'));
    fireEvent.click(chip('High'));
    fireEvent.click(chip('Personal'));
    await pressReturn();

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(onCapture).toHaveBeenCalledWith({
      title: 'Call the plumber',
      dueDate: TODAY,
      high: true,
      personal: true,
    });
    await waitFor(() => {
      expect(chip('Today')).toHaveAttribute('aria-pressed', 'false');
    });
    expect(chip('High')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Personal')).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not capture a blank or whitespace-only title', async () => {
    const { onCapture } = renderSheet();

    await pressReturn();
    typeTitle('   ');
    await pressReturn();

    expect(onCapture).not.toHaveBeenCalled();
  });

  it('keeps the typed title when the capture resolves false', async () => {
    const onCapture = jest.fn().mockResolvedValue(false);
    renderSheet(onCapture);

    typeTitle('Buy stamps');
    await pressReturn();

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(chip('High')).toBeEnabled());
    expect(screen.getByLabelText('New task')).toHaveValue('Buy stamps');
  });

  it('keeps the title and the pressed chips when the capture rejects', async () => {
    const onCapture = jest.fn().mockRejectedValue(new Error('Save failed'));
    renderSheet(onCapture);

    typeTitle('Pay the gas bill');
    fireEvent.click(chip('High'));
    fireEvent.click(chip('Personal'));
    await pressReturn();

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(onCapture).toHaveBeenCalledWith({
      title: 'Pay the gas bill',
      dueDate: undefined,
      high: true,
      personal: true,
    });
    await waitFor(() => expect(chip('High')).toBeEnabled());
    expect(screen.getByLabelText('New task')).toHaveValue('Pay the gas bill');
    expect(chip('High')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Personal')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a second submit while a capture is still pending', async () => {
    let resolveCapture!: (saved: boolean) => void;
    const onCapture = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCapture = resolve;
        }),
    );
    renderSheet(onCapture);
    const input = screen.getByLabelText('New task');

    typeTitle('File the receipts');
    await pressReturn();
    await waitFor(() => expect(input).toHaveAttribute('readonly'));
    await pressReturn();

    expect(onCapture).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCapture(true);
    });
    await settle();
    await waitFor(() => expect(input).toHaveValue(''));
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('captures the title when the Save task button is clicked', async () => {
    const { onCapture } = renderSheet();

    typeTitle('Water the ferns');
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    await settle();

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(onCapture).toHaveBeenCalledWith({
      title: 'Water the ferns',
      dueDate: undefined,
      high: false,
      personal: false,
    });
  });

  it('shows a picked date as a pressed chip, unpresses Today, and captures that date', async () => {
    const { onCapture } = renderSheet();

    typeTitle('Submit expenses');
    fireEvent.click(chip('Today'));
    fireEvent.change(screen.getByLabelText('Pick date'), {
      target: { value: '2026-10-24' },
    });

    expect(chip('Sat 24 Oct')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Today')).toHaveAttribute('aria-pressed', 'false');

    await pressReturn();

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(onCapture).toHaveBeenCalledWith({
      title: 'Submit expenses',
      dueDate: '2026-10-24',
      high: false,
      personal: false,
    });
  });
});

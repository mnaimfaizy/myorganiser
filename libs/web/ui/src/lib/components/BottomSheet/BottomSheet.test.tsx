import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  BottomSheet,
  BottomSheetAction,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from './BottomSheet';

const TITLE = 'List actions';
const DESCRIPTION = 'Choose what to do with this list.';

function renderSheet(actions: ReactNode) {
  render(
    <BottomSheet>
      <BottomSheetTrigger>Open actions</BottomSheetTrigger>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>{TITLE}</BottomSheetTitle>
          <BottomSheetDescription>{DESCRIPTION}</BottomSheetDescription>
        </BottomSheetHeader>
        {actions}
      </BottomSheetContent>
    </BottomSheet>,
  );
}

function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Open actions' }));
  return screen.getByRole('dialog', { name: TITLE });
}

describe('BottomSheet', () => {
  it('opens from the trigger as a dialog named by the title and described by the description', () => {
    renderSheet(null);

    const sheet = openSheet();

    expect(sheet).toHaveAccessibleName(TITLE);
    expect(sheet).toHaveAccessibleDescription(DESCRIPTION);
  });

  it('calls the action onClick and closes the sheet when the action is activated', async () => {
    const onClick = jest.fn();
    renderSheet(
      <BottomSheetAction onClick={onClick}>Rename list</BottomSheetAction>,
    );
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Rename list' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps the sheet open when the action onClick calls preventDefault', () => {
    const onClick = jest.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    renderSheet(
      <BottomSheetAction onClick={onClick}>Rename list</BottomSheetAction>,
    );
    openSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Rename list' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
  });

  it('closes the sheet on Escape', async () => {
    renderSheet(null);
    const sheet = openSheet();

    fireEvent.keyDown(sheet, { key: 'Escape', code: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('traps focus: focus moved outside the open sheet returns to an element inside it', () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.appendChild(outside);

    try {
      renderSheet(<BottomSheetAction>Rename list</BottomSheetAction>);
      const sheet = openSheet();

      outside.focus();

      expect(sheet.contains(document.activeElement)).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it('hides the decorative grab handle from assistive technology', () => {
    renderSheet(null);
    const sheet = openSheet();

    const handle = sheet.firstElementChild;

    expect(handle).toHaveAttribute('aria-hidden', 'true');
    expect(handle).toBeEmptyDOMElement();
  });

  it('renders a destructive action as a button with its name and still activates it', () => {
    const onDelete = jest.fn();
    renderSheet(
      <BottomSheetAction tone="destructive" onClick={onDelete}>
        Delete list
      </BottomSheetAction>,
    );
    openSheet();

    const deleteAction = screen.getByRole('button', { name: 'Delete list' });
    fireEvent.click(deleteAction);

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

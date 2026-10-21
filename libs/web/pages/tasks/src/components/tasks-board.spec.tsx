import type { Task } from '@myorganiser/vault-core';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { TasksBoard } from './tasks-board';
import { makeTasksPageController } from '../testing/tasks-page-controller.fixture';

// Polyfill ResizeObserver for Radix UI components (Checkbox, Collapsible, Dialog).
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Thu 22 Oct 2026, 10:00 local. Week starts Mon 19 Oct, so Wed 21 Oct is this week.
const NOW = new Date(2026, 9, 22, 10);
const DONE_THIS_WEEK = new Date(2026, 9, 21, 9).toISOString();

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    status: 'pending',
    priority: 'medium',
    archived: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

const overdueReport = makeTask({
  id: 'a',
  title: 'Overdue report',
  dueDate: '2026-10-20',
  context: 'work',
  priority: 'high',
});
const morningCall = makeTask({
  id: 'b',
  title: 'Morning call',
  dueDate: '2026-10-22',
  context: 'personal',
});
const shipDraft = makeTask({
  id: 'e',
  title: 'Ship draft',
  dueDate: '2026-10-22',
  context: 'work',
  status: 'blocked',
});
const planTrip = makeTask({
  id: 'c',
  title: 'Plan trip',
  dueDate: '2026-10-30',
  context: 'personal',
});
const draftProposal = makeTask({
  id: 'h',
  title: 'Draft proposal',
  dueDate: '2026-10-25',
  context: 'work',
  status: 'in_progress',
});
const someday = makeTask({
  id: 'd',
  title: 'Someday idea',
  context: 'personal',
});
const writeNotes = makeTask({
  id: 'f',
  title: 'Write notes',
  context: 'personal',
  status: 'done',
  closedAt: DONE_THIS_WEEK,
});
const oldReceipt = makeTask({
  id: 'g',
  title: 'Old receipt',
  context: 'personal',
  archived: true,
});
const droppedIdea = makeTask({
  id: 'i',
  title: 'Dropped idea',
  context: 'personal',
  status: 'cancelled',
});

const FIXTURE = [
  overdueReport,
  morningCall,
  shipDraft,
  planTrip,
  draftProposal,
  someday,
  writeNotes,
  oldReceipt,
  droppedIdea,
];

function headingTexts(level: number): string[] {
  return screen
    .queryAllByRole('heading', { level })
    .map((heading) => heading.textContent ?? '');
}

describe('TasksBoard', () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('desktop', () => {
    it('renders the Tasks heading and the open summary from the fixture', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      expect(headingTexts(1)).toEqual(['Tasks']);
      expect(
        screen.getByText('6 open · 2 due today · 1 overdue'),
      ).toBeInTheDocument();
    });

    it('lists the due sections in order with their counts', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      expect(headingTexts(2)).toEqual([
        'Overdue · 1',
        'Today · 2',
        'Upcoming · 2',
        'No date · 1',
      ]);
    });

    it('shows the Done this week group collapsed and expands it on demand', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      const trigger = screen.getByRole('button', {
        name: 'Done this week · 1',
      });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('button', { name: 'Write notes' }),
      ).not.toBeInTheDocument();

      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('button', { name: 'Write notes' }),
      ).toBeInTheDocument();
    });

    it('marks a task done through toggleDone when its checkbox is ticked', () => {
      const page = makeTasksPageController(FIXTURE);
      render(<TasksBoard page={page} variant="desktop" />);

      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Done: Morning call' }),
      );

      expect(page.toggleDone).toHaveBeenCalledWith(morningCall, true);
    });

    it('hides personal tasks when the Work context is chosen', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('radio', { name: 'Work' }));

      expect(
        screen.getByRole('button', { name: 'Overdue report' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Plan trip' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Done this week/ }),
      ).not.toBeInTheDocument();
    });

    it('shows only blocked tasks under the Blocked chip and drops the empty sections', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Blocked · 1' }));

      expect(headingTexts(2)).toEqual(['Today · 1']);
      expect(
        screen.getByRole('button', { name: 'Ship draft' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Overdue report' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Overdue' }),
      ).not.toBeInTheDocument();
    });

    it('shows only archived tasks under Archived, and done plus cancelled under Done', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

      expect(headingTexts(2)).toEqual(['Archived · 1']);
      expect(
        screen.getByRole('button', { name: 'Old receipt' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Overdue report' }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(headingTexts(2)).toEqual(['Done · 2']);
      expect(
        screen.getByRole('button', { name: 'Write notes' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Dropped idea' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Old receipt' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('shows the all-clear state with the done count, and Show done switches to the Done view', () => {
      render(
        <TasksBoard
          page={makeTasksPageController([writeNotes])}
          variant="desktop"
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'All clear' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Nothing open. 1 task done this week.'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show done' }));

      expect(
        screen.queryByRole('heading', { name: 'All clear' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        screen.getByRole('button', { name: 'Write notes' }),
      ).toBeInTheDocument();
    });

    it('opens the Add task dialog from the all-clear state', () => {
      render(
        <TasksBoard
          page={makeTasksPageController([writeNotes])}
          variant="desktop"
        />,
      );

      const allClear = screen.getByRole('heading', { name: 'All clear' })
        .parentElement as HTMLElement;
      fireEvent.click(
        within(allClear).getByRole('button', { name: 'Add task' }),
      );

      expect(
        screen.getByRole('dialog', { name: 'Add task' }),
      ).toBeInTheDocument();
    });

    it('renders neither sections nor the all-clear state while loading', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE, true)}
          variant="desktop"
        />,
      );

      expect(headingTexts(2)).toEqual([]);
      expect(
        screen.queryByRole('heading', { name: 'All clear' }),
      ).not.toBeInTheDocument();
      expect(headingTexts(1)).toEqual(['Tasks']);
    });

    it('opens the task detail when a title is clicked and closes it with Close detail', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Plan trip' }));

      const detail = screen.getByRole('complementary', { name: 'Task detail' });
      expect(within(detail).getByRole('textbox', { name: 'Task' })).toHaveValue(
        'Plan trip',
      );

      fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));

      expect(
        screen.queryByRole('complementary', { name: 'Task detail' }),
      ).not.toBeInTheDocument();
    });

    it('opens the detail panel for initialSelectedTaskId on first render', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
          initialSelectedTaskId="c"
        />,
      );

      const detail = screen.getByRole('complementary', { name: 'Task detail' });
      expect(within(detail).getByRole('textbox', { name: 'Task' })).toHaveValue(
        'Plan trip',
      );
    });

    it('quick adds a task from the bar and clears it once saved', async () => {
      const page = makeTasksPageController(FIXTURE);
      render(<TasksBoard page={page} variant="desktop" />);

      const input = screen.getByRole('textbox', { name: 'Quick add a task' });
      fireEvent.change(input, { target: { value: 'Call the bank' } });
      // jsdom does not turn a keydown Enter into implicit form submission,
      // so the form's submit event stands in for Enter.
      fireEvent.submit(input.closest('form') as HTMLFormElement);

      await waitFor(() => {
        expect(page.quickAdd).toHaveBeenCalledWith({
          title: 'Call the bank',
          dueToday: false,
          high: false,
        });
      });
      await waitFor(() => {
        expect(
          screen.getByRole('textbox', { name: 'Quick add a task' }),
        ).toHaveValue('');
      });
    });

    it('does not submit a blank quick add', () => {
      const page = makeTasksPageController(FIXTURE);
      render(<TasksBoard page={page} variant="desktop" />);

      const input = screen.getByRole('textbox', { name: 'Quick add a task' });
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.submit(input.closest('form') as HTMLFormElement);

      expect(page.quickAdd).not.toHaveBeenCalled();
    });

    it('keeps the typed title when quickAdd resolves false', async () => {
      const page = makeTasksPageController(FIXTURE);
      (page.quickAdd as jest.Mock).mockResolvedValue(false);
      render(<TasksBoard page={page} variant="desktop" />);

      const input = screen.getByRole('textbox', { name: 'Quick add a task' });
      fireEvent.change(input, { target: { value: 'Call the bank' } });
      fireEvent.submit(input.closest('form') as HTMLFormElement);

      await waitFor(() => {
        expect(page.quickAdd).toHaveBeenCalledTimes(1);
      });
      // Let the save continuation run, so a reset on false would show here.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(input).toHaveValue('Call the bank');
    });

    it.each([
      { resolved: true, panelOpen: false },
      { resolved: false, panelOpen: true },
    ])(
      'deletes the selected task through deleteTask; when it resolves $resolved the panel open is $panelOpen',
      async ({ resolved, panelOpen }) => {
        const page = makeTasksPageController(FIXTURE);
        (page.deleteTask as jest.Mock).mockResolvedValue(resolved);
        render(
          <TasksBoard
            page={page}
            variant="desktop"
            initialSelectedTaskId="c"
          />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
        const dialog = screen.getByRole('alertdialog', {
          name: 'Delete "Plan trip"?',
        });
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Delete task' }),
        );

        await waitFor(() => {
          expect(page.deleteTask).toHaveBeenCalledWith('c');
        });
        await waitFor(() => {
          expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        });
        expect(
          !!screen.queryByRole('complementary', { name: 'Task detail' }),
        ).toBe(panelOpen);
      },
    );

    it('moves focus to Cancel when the delete confirm opens', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
          initialSelectedTaskId="c"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));

      const dialog = screen.getByRole('alertdialog', {
        name: 'Delete "Plan trip"?',
      });
      expect(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      ).toHaveFocus();
    });

    it('does not dismiss the delete confirm on an outside click', async () => {
      const page = makeTasksPageController(FIXTURE);
      render(
        <TasksBoard page={page} variant="desktop" initialSelectedTaskId="c" />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
      // Radix attaches its outside-pointerdown listener on a setTimeout(0).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      fireEvent.pointerDown(document.body);

      expect(
        screen.getByRole('alertdialog', { name: 'Delete "Plan trip"?' }),
      ).toBeInTheDocument();
      expect(page.deleteTask).not.toHaveBeenCalled();
    });

    it('shows the pending label on the confirm button while deleteTask is in flight', async () => {
      const page = makeTasksPageController(FIXTURE);
      let resolveDelete: (deleted: boolean) => void = () => {};
      (page.deleteTask as jest.Mock).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveDelete = resolve;
          }),
      );
      render(
        <TasksBoard page={page} variant="desktop" initialSelectedTaskId="c" />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
      const dialog = screen.getByRole('alertdialog', {
        name: 'Delete "Plan trip"?',
      });
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete task' }),
      );

      await waitFor(() => {
        expect(
          within(dialog).getByRole('button', { name: /Delete task/ }),
        ).toHaveTextContent(/^Delete task…$/);
      });
      expect(
        within(dialog).getByRole('button', { name: /Delete task/ }),
      ).toBeDisabled();

      await act(async () => {
        resolveDelete(true);
      });

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
    });

    it('renders no detail panel when initialSelectedTaskId names no task', () => {
      render(
        <TasksBoard
          page={makeTasksPageController(FIXTURE)}
          variant="desktop"
          initialSelectedTaskId="missing"
        />,
      );

      expect(
        screen.queryByRole('complementary', { name: 'Task detail' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('phone', () => {
    it('hides the quick add bar, links rows to the detail route, and opens the capture sheet from the FAB', () => {
      render(
        <TasksBoard page={makeTasksPageController(FIXTURE)} variant="phone" />,
      );

      expect(headingTexts(1)).toEqual(['Tasks']);
      expect(
        screen.getByText('6 open · 2 today · 1 overdue'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: 'Quick add a task' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Overdue report/ }),
      ).toHaveAttribute('href', '/dashboard/tasks/a');

      fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

      expect(
        screen.getByRole('textbox', { name: 'New task' }),
      ).toBeInTheDocument();
    });
  });
});

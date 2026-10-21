/* eslint-disable import/first */
// Mocks sit above every import, so the module graph sees them first.
const mockGate: { handle: unknown } = { handle: undefined };

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/web-vault-ui', () => ({
  VaultGate: ({
    children,
  }: {
    children: (props: { handle: unknown }) => unknown;
  }) => children({ handle: mockGate.handle }),
}));

jest.mock('../hooks/use-tasks-page', () => ({
  useTasksPage: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobile: jest.fn(),
}));

import type { Task } from '@myorganiser/vault-core';
import { useIsMobile } from '@myorganiser/web-ui';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';
import { useTasksPage } from '../hooks/use-tasks-page';
import type { TasksPageController } from '../hooks/use-tasks-page';
import { TaskDetailPageClient } from './TaskDetailPageClient';
import { makeTasksPageController } from '../testing/tasks-page-controller.fixture';

// Polyfill ResizeObserver for Radix UI components.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

const TASKS_HREF = '/dashboard/tasks';
const FAKE_HANDLE = { isUnlocked: true };

const renewPassport: Task = {
  id: 'task-1',
  title: 'Renew passport',
  status: 'pending',
  priority: 'medium',
  archived: false,
  createdAt: '2026-10-01T09:00:00.000Z',
};

const archivedPassport: Task = {
  ...renewPassport,
  id: 'task-2',
  title: 'Old receipt',
  archived: true,
};

const mockRouter = { push: jest.fn(), replace: jest.fn() };

function setController(controller: TasksPageController): TasksPageController {
  (useTasksPage as jest.Mock).mockReturnValue(controller);
  return controller;
}

describe('TaskDetailPageClient', () => {
  beforeEach(() => {
    (useRouter as jest.Mock).mockReset();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    mockRouter.push.mockReset();
    mockRouter.replace.mockReset();
    (useTasksPage as jest.Mock).mockReset();
    (useIsMobile as jest.Mock).mockReset();
    (useIsMobile as jest.Mock).mockReturnValue(true);
    mockGate.handle = FAKE_HANDLE;
  });

  describe('phone', () => {
    it('shows the task title as the page heading', () => {
      setController(makeTasksPageController([renewPassport]));

      render(<TaskDetailPageClient taskId="task-1" />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Renew passport' }),
      ).toBeInTheDocument();
    });

    it('navigates back to the list after Mark done resolves true', async () => {
      const page = setController(makeTasksPageController([renewPassport]));

      render(<TaskDetailPageClient taskId="task-1" />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
      });

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith(TASKS_HREF);
      });
      expect(page.toggleDone).toHaveBeenCalledWith(renewPassport, true);
    });

    it('stays on the detail when Mark done resolves false', async () => {
      const page = setController(makeTasksPageController([renewPassport]));
      (page.toggleDone as jest.Mock).mockResolvedValue(false);

      render(<TaskDetailPageClient taskId="task-1" />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
      });

      await waitFor(() => {
        expect(page.toggleDone).toHaveBeenCalledWith(renewPassport, true);
      });
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('redirects to the list when the task is not found after loading', () => {
      setController(makeTasksPageController([]));

      const { container } = render(<TaskDetailPageClient taskId="missing" />);

      expect(mockRouter.replace).toHaveBeenCalledWith(TASKS_HREF);
      expect(container).toBeEmptyDOMElement();
    });

    it('does not redirect while the tasks are still loading', () => {
      setController(makeTasksPageController([], true));

      render(<TaskDetailPageClient taskId="missing" />);

      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'archive resolves true: navigates to the list',
        action: 'Archive',
        archived: false,
        method: 'archive' as const,
        resolved: true,
        navigates: true,
      },
      {
        label: 'archive resolves false: stays on the detail',
        action: 'Archive',
        archived: false,
        method: 'archive' as const,
        resolved: false,
        navigates: false,
      },
      {
        label: 'restore resolves true: navigates to the list',
        action: 'Restore from archive',
        archived: true,
        method: 'unarchive' as const,
        resolved: true,
        navigates: true,
      },
      {
        label: 'restore resolves false: stays on the detail',
        action: 'Restore from archive',
        archived: true,
        method: 'unarchive' as const,
        resolved: false,
        navigates: false,
      },
    ])('$label', async ({ action, archived, method, resolved, navigates }) => {
      const task = archived ? archivedPassport : renewPassport;
      const page = setController(makeTasksPageController([task]));
      (page[method] as jest.Mock).mockResolvedValue(resolved);

      render(<TaskDetailPageClient taskId={task.id} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: action }));
      });

      await waitFor(() => {
        expect(page[method]).toHaveBeenCalledWith(task.id);
      });
      expect(mockRouter.push.mock.calls).toEqual(
        navigates ? [[TASKS_HREF]] : [],
      );
    });

    it.each([
      { resolved: true, navigates: true },
      { resolved: false, navigates: false },
    ])(
      'delete resolves $resolved: navigates $navigates',
      async ({ resolved, navigates }) => {
        const page = setController(makeTasksPageController([renewPassport]));
        (page.deleteTask as jest.Mock).mockResolvedValue(resolved);

        render(<TaskDetailPageClient taskId="task-1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
        const dialog = screen.getByRole('dialog', {
          name: 'Delete "Renew passport"?',
        });
        await act(async () => {
          fireEvent.click(
            within(dialog).getByRole('button', { name: 'Delete' }),
          );
        });

        await waitFor(() => {
          expect(page.deleteTask).toHaveBeenCalledWith('task-1');
        });
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(mockRouter.push.mock.calls).toEqual(
          navigates ? [[TASKS_HREF]] : [],
        );
      },
    );

    it('saves a priority change through updateFields', async () => {
      const page = setController(makeTasksPageController([renewPassport]));

      render(<TaskDetailPageClient taskId="task-1" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'High' }));
      });

      await waitFor(() => {
        expect(page.updateFields).toHaveBeenCalledWith(renewPassport, {
          priority: 'high',
        });
      });
    });
  });

  describe('desktop', () => {
    it('renders the board with the task detail panel open', () => {
      (useIsMobile as jest.Mock).mockReturnValue(false);
      setController(makeTasksPageController([renewPassport]));

      render(<TaskDetailPageClient taskId="task-1" />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Tasks' }),
      ).toBeInTheDocument();
      const detail = screen.getByRole('complementary', { name: 'Task detail' });
      expect(within(detail).getByRole('textbox', { name: 'Task' })).toHaveValue(
        'Renew passport',
      );
    });
  });
});

/* eslint-disable import/first */
// Mocks sit above every import, so the module graph sees them first.
const mockGate: { handle: unknown } = { handle: undefined };

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
  useIsMobileState: jest.fn(),
}));

import type { Task } from '@myorganiser/vault-core';
import { useIsMobileState } from '@myorganiser/web-ui';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useTasksPage } from '../hooks/use-tasks-page';
import { TasksPageClient } from './TasksPageClient';
import { makeTasksPageController } from '../testing/tasks-page-controller.fixture';

// Polyfill ResizeObserver for Radix UI components.
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

const FAKE_HANDLE = { isUnlocked: true };

const morningCall: Task = {
  id: 'task-1',
  title: 'Morning call',
  status: 'pending',
  priority: 'medium',
  archived: false,
  createdAt: '2026-10-01T09:00:00.000Z',
};

describe('TasksPageClient', () => {
  beforeEach(() => {
    (useTasksPage as jest.Mock).mockReset();
    (useTasksPage as jest.Mock).mockReturnValue(
      makeTasksPageController([morningCall]),
    );
    (useIsMobileState as jest.Mock).mockReset();
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    mockGate.handle = FAKE_HANDLE;
  });

  it('renders the desktop board with the quick add bar when not on a phone', () => {
    render(<TasksPageClient />);

    expect(
      screen.getByRole('textbox', { name: 'Quick add a task' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Morning call/ }),
    ).not.toBeInTheDocument();
  });

  it('renders the phone board, with rows linking to the detail route, when on a phone', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(true);

    render(<TasksPageClient />);

    expect(
      screen.queryByRole('textbox', { name: 'Quick add a task' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Morning call/ })).toHaveAttribute(
      'href',
      '/dashboard/tasks/task-1',
    );
  });

  it('renders no board while the breakpoint is still undecided', () => {
    (useIsMobileState as jest.Mock).mockReturnValue(undefined);

    const { container } = render(<TasksPageClient />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole('textbox', { name: 'Quick add a task' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Morning call/ }),
    ).not.toBeInTheDocument();
  });

  it('opens the detail panel for initialSelectedTaskId on desktop', () => {
    render(<TasksPageClient initialSelectedTaskId="task-1" />);

    const detail = screen.getByRole('complementary', { name: 'Task detail' });
    expect(within(detail).getByRole('textbox', { name: 'Task' })).toHaveValue(
      'Morning call',
    );
  });

  it('passes the unlocked vault handle to useTasksPage', () => {
    render(<TasksPageClient />);

    expect(useTasksPage).toHaveBeenCalledWith(FAKE_HANDLE);
  });

  it('renders nothing and loads no tasks when the vault gate has no handle', () => {
    mockGate.handle = undefined;

    const { container } = render(<TasksPageClient />);

    expect(useTasksPage).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});

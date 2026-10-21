'use client';

import { useIsMobile } from '@myorganiser/web-ui';
import type { VaultHandle } from '@myorganiser/web-vault';
import { VaultGate } from '@myorganiser/web-vault-ui';

import { useTasksPage } from '../hooks/use-tasks-page';
import { TasksBoard } from './tasks-board';

export interface TasksPageClientProps {
  /** Desktop only: the task whose detail panel opens on first render. */
  initialSelectedTaskId?: string;
}

interface TasksInnerProps extends TasksPageClientProps {
  handle: VaultHandle;
}

function TasksInner({ handle, initialSelectedTaskId }: TasksInnerProps) {
  const page = useTasksPage(handle);
  const isPhone = useIsMobile();

  return (
    <TasksBoard
      page={page}
      variant={isPhone ? 'phone' : 'desktop'}
      initialSelectedTaskId={initialSelectedTaskId}
    />
  );
}

export function TasksPageClient({
  initialSelectedTaskId,
}: TasksPageClientProps) {
  return (
    <VaultGate title="Tasks">
      {({ handle }) =>
        handle ? (
          <TasksInner
            handle={handle}
            initialSelectedTaskId={initialSelectedTaskId}
          />
        ) : null
      }
    </VaultGate>
  );
}

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

import { useLatestCloudBackup } from './useLatestCloudBackup';

function HookProbe({
  apiFactory,
  refreshKey = 0,
}: {
  apiFactory: Parameters<typeof useLatestCloudBackup>[1];
  refreshKey?: number;
}) {
  const state = useLatestCloudBackup(refreshKey, apiFactory);
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="record-id">
        {state.status === 'loaded' ? state.record.id : ''}
      </span>
    </div>
  );
}

function makeApiFactory(
  impl: (req: {
    status?: string;
    source?: string;
    event?: string;
  }) => Promise<unknown>,
): Parameters<typeof useLatestCloudBackup>[1] {
  return () =>
    ({
      getLatestBackup: impl as (req: {
        status?: string;
        source?: string;
        event?: string;
      }) => Promise<{ data: never }>,
    }) as never;
}

describe('useLatestCloudBackup', () => {
  test('queries with status=success, source=google-drive, and event=export on mount', async () => {
    const calls: { status?: string; source?: string; event?: string }[] = [];
    const factory = makeApiFactory(async (req) => {
      calls.push(req);
      return {
        data: {
          id: 'cloud-1',
          event: 'export',
          source: 'google-drive',
          status: 'success',
          createdAt: '2026-04-15T00:00:00Z',
          schemaVersion: 1,
          sizeBytes: 4242,
        },
      };
    });

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(calls).toEqual([
      { status: 'success', source: 'google-drive', event: 'export' },
    ]);
    expect(screen.getByTestId('status').textContent).toBe('loaded');
    expect(screen.getByTestId('record-id').textContent).toBe('cloud-1');
  });

  test('resolves to empty when the API answers with a null body', async () => {
    const factory = makeApiFactory(async () => ({ data: null }));

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(screen.getByTestId('status').textContent).toBe('empty');
    expect(screen.getByTestId('record-id').textContent).toBe('');
  });

  test('resolves to empty on 404', async () => {
    const factory = makeApiFactory(async () => {
      const err: { response: { status: number } } = {
        response: { status: 404 },
      };
      throw err;
    });

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(screen.getByTestId('status').textContent).toBe('empty');
  });

  test('resolves to error on other failures', async () => {
    const factory = makeApiFactory(async () => {
      throw new Error('network');
    });

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  test('refetches when refreshKey changes', async () => {
    let callCount = 0;
    const factory = makeApiFactory(async () => {
      callCount++;
      return {
        data: {
          id: `cloud-${callCount}`,
          event: 'export',
          source: 'google-drive',
          status: 'success',
          createdAt: '2026-04-15T00:00:00Z',
          schemaVersion: 1,
          sizeBytes: 4242,
        },
      };
    });

    const { rerender } = render(
      <HookProbe apiFactory={factory} refreshKey={0} />,
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('record-id').textContent).toBe('cloud-1');
    });

    // Change refreshKey to trigger refetch
    await act(async () => {
      rerender(<HookProbe apiFactory={factory} refreshKey={1} />);
    });

    // Wait for the refetch to complete
    await waitFor(() => {
      expect(screen.getByTestId('record-id').textContent).toBe('cloud-2');
    });
  });
});

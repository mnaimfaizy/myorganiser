import { render, screen } from '@testing-library/react';
import { act } from 'react';

import { useLatestBackup } from './useLatestBackup';

function HookProbe({
  apiFactory,
}: {
  apiFactory: Parameters<typeof useLatestBackup>[0];
}) {
  const state = useLatestBackup(apiFactory);
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
  impl: (req: { status?: string }) => Promise<unknown>,
): Parameters<typeof useLatestBackup>[0] {
  return () =>
    ({
      getLatestBackup: impl as (req: {
        status?: string;
      }) => Promise<{ data: never }>,
    }) as never;
}

describe('useLatestBackup', () => {
  test('starts in loading and resolves to loaded on 200', async () => {
    const factory = makeApiFactory(async () => ({
      data: {
        id: 'rec-1',
        event: 'export',
        source: 'local-file',
        status: 'success',
        createdAt: '2026-04-01T00:00:00Z',
        schemaVersion: 1,
        sizeBytes: 1234,
      },
    }));

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(screen.getByTestId('status').textContent).toBe('loaded');
    expect(screen.getByTestId('record-id').textContent).toBe('rec-1');
  });

  test('resolves to empty when the API answers with a null body', async () => {
    const factory = makeApiFactory(async () => ({ data: null }));

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(screen.getByTestId('status').textContent).toBe('empty');
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
      throw new Error('boom');
    });

    await act(async () => {
      render(<HookProbe apiFactory={factory} />);
    });

    expect(screen.getByTestId('status').textContent).toBe('error');
  });
});

/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@myorganiser/auth', () => ({
  // isPlatformAdmin is pure, so the real one is used rather than a copy.
  ...jest.requireActual('@myorganiser/auth'),
  authSession: {},
  getCurrentUser: jest.fn(),
  resolveOutboundGuard: jest.fn(),
  onSessionEnded: jest.fn(),
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {
  AuthUser,
  SessionEndedEvent,
  SessionEndedListener,
} from '@myorganiser/auth';
import {
  getCurrentUser,
  onSessionEnded,
  resolveOutboundGuard,
} from '@myorganiser/auth';
import { useRouter } from 'next/navigation';

import AdminGuard from './AdminGuard';

const mockReplace = jest.fn();

const platformAdminUser: AuthUser = {
  id: 'admin-1',
  name: 'Platform Admin',
  email: 'admin@example.com',
  firstName: 'Platform',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
};

const normalUser: AuthUser = {
  id: 'user-1',
  name: 'Normal User',
  email: 'user@example.com',
  firstName: 'Normal',
  lastName: 'User',
  role: 'user',
  disabled: false,
};

describe('AdminGuard', () => {
  const mockOnSessionEnded = onSessionEnded as jest.Mock;
  const mockUnsubscribe = jest.fn();

  // Answers each successive guard call with the next outcome; the last one repeats.
  function mockOutcomes(...outcomes: Array<{ kind: string }>) {
    let call = 0;
    (resolveOutboundGuard as jest.Mock).mockImplementation(() =>
      Promise.resolve(outcomes[Math.min(call++, outcomes.length - 1)]),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (resolveOutboundGuard as jest.Mock).mockReset();
    (getCurrentUser as jest.Mock).mockReset();
    (useRouter as jest.Mock).mockReturnValue({
      replace: mockReplace,
      push: jest.fn(),
    });
    mockOnSessionEnded.mockReturnValue(mockUnsubscribe);
  });

  it('renders null while the guard is resolving', () => {
    (resolveOutboundGuard as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    expect(screen.queryByText('admin-content')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects guests to login and does not render children', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({
      kind: 'redirect_login',
    });

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    expect(screen.queryByText('admin-content')).toBeNull();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects authenticated non-admin users to dashboard', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
    (getCurrentUser as jest.Mock).mockReturnValue(normalUser);

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    expect(screen.queryByText('admin-content')).toBeNull();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('redirects to dashboard when allow succeeds but current user is null', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
    (getCurrentUser as jest.Mock).mockReturnValue(null);

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });

    expect(screen.queryByText('admin-content')).toBeNull();
  });

  it('redirects to dashboard when allow succeeds but current user is undefined', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
    (getCurrentUser as jest.Mock).mockReturnValue(undefined);

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });

    expect(screen.queryByText('admin-content')).toBeNull();
  });

  it('renders children for platform admin users without redirecting', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
    (getCurrentUser as jest.Mock).mockReturnValue(platformAdminUser);

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText('admin-content')).toBeTruthy();
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not subscribe to session end while the platform check is pending', () => {
    (resolveOutboundGuard as jest.Mock).mockImplementation(
      () => new Promise(() => {}),
    );

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    expect(screen.queryByText('admin-content')).toBeNull();
    expect(mockOnSessionEnded).not.toHaveBeenCalled();
  });

  it('does not subscribe to session end when a non-admin is redirected to dashboard', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
    (getCurrentUser as jest.Mock).mockReturnValue(normalUser);

    render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });
    expect(mockOnSessionEnded).not.toHaveBeenCalled();
  });

  it.each<SessionEndedEvent['reason']>([
    'refresh_rejected',
    'signed_out_elsewhere',
  ])(
    'removes children and redirects to /login when the session ends (%s)',
    async (reason) => {
      (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
      (getCurrentUser as jest.Mock).mockReturnValue(platformAdminUser);

      render(
        <AdminGuard>
          <div>admin-content</div>
        </AdminGuard>,
      );

      await screen.findByText('admin-content');
      expect(mockOnSessionEnded).toHaveBeenCalledTimes(1);

      const listener = mockOnSessionEnded.mock
        .calls[0][0] as SessionEndedListener;

      act(() => {
        listener({ reason });
      });

      expect(screen.queryByText('admin-content')).toBeNull();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/login');
    },
  );

  it('calls the unsubscribe function returned by onSessionEnded on unmount', async () => {
    (resolveOutboundGuard as jest.Mock).mockResolvedValue({ kind: 'allow' });
    (getCurrentUser as jest.Mock).mockReturnValue(platformAdminUser);

    const { unmount } = render(
      <AdminGuard>
        <div>admin-content</div>
      </AdminGuard>,
    );

    await screen.findByText('admin-content');
    expect(mockOnSessionEnded).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  describe('when the server cannot restore a Restorable Session', () => {
    function fireReconnectTrigger(
      trigger: 'online' | 'focus' | 'visibilitychange',
    ) {
      act(() => {
        if (trigger === 'visibilitychange') {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
          });
          document.dispatchEvent(new Event('visibilitychange'));
        } else {
          window.dispatchEvent(new Event(trigger));
        }
      });
    }

    afterEach(() => {
      Reflect.deleteProperty(document, 'visibilityState');
    });

    it.each<'online' | 'focus' | 'visibilitychange'>([
      'online',
      'focus',
      'visibilitychange',
    ])(
      'retries on %s and renders children for a platform admin when the retry resolves to allow',
      async (trigger) => {
        mockOutcomes({ kind: 'restore_unavailable' }, { kind: 'allow' });
        (getCurrentUser as jest.Mock).mockReturnValue(platformAdminUser);

        render(
          <AdminGuard>
            <div>admin-content</div>
          </AdminGuard>,
        );

        await screen.findByRole('alert');
        fireReconnectTrigger(trigger);

        expect(await screen.findByText('admin-content')).toBeInTheDocument();
        expect(resolveOutboundGuard).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(mockReplace).not.toHaveBeenCalled();
      },
    );

    it('ignores a second retry while one is in flight', async () => {
      let resolveRetry!: (outcome: { kind: string }) => void;
      (resolveOutboundGuard as jest.Mock)
        .mockImplementationOnce(() =>
          Promise.resolve({ kind: 'restore_unavailable' }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<{ kind: string }>((resolve) => {
              resolveRetry = resolve;
            }),
        );
      (getCurrentUser as jest.Mock).mockReturnValue(platformAdminUser);

      render(
        <AdminGuard>
          <div>admin-content</div>
        </AdminGuard>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

      const pendingButton = screen.getByRole('button', { name: 'Retrying…' });
      expect(pendingButton).toBeDisabled();
      expect(pendingButton).toHaveAttribute('aria-busy', 'true');

      fireReconnectTrigger('focus');
      fireEvent.click(pendingButton);

      expect(resolveOutboundGuard).toHaveBeenCalledTimes(2);

      act(() => {
        resolveRetry({ kind: 'allow' });
      });

      expect(await screen.findByText('admin-content')).toBeInTheDocument();
      expect(resolveOutboundGuard).toHaveBeenCalledTimes(2);
    });

    it('shows the unreachable notice without children and does not redirect to login', async () => {
      mockOutcomes({ kind: 'restore_unavailable' });

      render(
        <AdminGuard>
          <div>admin-content</div>
        </AdminGuard>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Can't reach the server",
      );
      expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('renders children when Try again resolves to allow for a platform admin', async () => {
      mockOutcomes({ kind: 'restore_unavailable' }, { kind: 'allow' });
      (getCurrentUser as jest.Mock).mockReturnValue(platformAdminUser);

      render(
        <AdminGuard>
          <div>admin-content</div>
        </AdminGuard>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('admin-content')).toBeInTheDocument();
      expect(getCurrentUser).toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('still applies the platform admin check after Try again resolves to allow', async () => {
      mockOutcomes({ kind: 'restore_unavailable' }, { kind: 'allow' });
      (getCurrentUser as jest.Mock).mockReturnValue(normalUser);

      render(
        <AdminGuard>
          <div>admin-content</div>
        </AdminGuard>,
      );

      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/dashboard');
      });
      expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalledWith('/login');
    });

    it('removes children and redirects to /login when the session ends while unavailable', async () => {
      mockOutcomes({ kind: 'restore_unavailable' });

      render(
        <AdminGuard>
          <div>admin-content</div>
        </AdminGuard>,
      );

      await screen.findByRole('alert');
      expect(mockOnSessionEnded).toHaveBeenCalledTimes(1);

      const listener = mockOnSessionEnded.mock
        .calls[0][0] as SessionEndedListener;

      act(() => {
        listener({ reason: 'signed_out_elsewhere' });
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('admin-content')).not.toBeInTheDocument();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });
});

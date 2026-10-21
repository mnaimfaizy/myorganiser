/** Mocking rule: place jest.mock calls before any imports */
/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('../lib/apiClient', () => ({
  createPlatformAdminApi: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => {
  const actual = jest.requireActual('@myorganiser/web-ui');

  return {
    ...actual,
    useToast: jest.fn(),
  };
});

import type { AdminUserIdentity } from '@myorganiser/app-api-client';
import { useToast } from '@myorganiser/web-ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { createPlatformAdminApi } from '../lib/apiClient';

import { UserLifecycleActions } from './UserLifecycleActions';

const mockDisableUser = jest.fn();
const mockEnableUser = jest.fn();
const mockForceLogoutUser = jest.fn();
const mockResendVerification = jest.fn();
const mockPromoteUser = jest.fn();
const mockDemoteUser = jest.fn();
const mockGrantYouTubeAccess = jest.fn();
const mockWithdrawYouTubeAccess = jest.fn();
const mockToast = jest.fn();
const mockOnUserUpdated = jest.fn();

const activeUser: AdminUserIdentity = {
  id: 'u-active',
  name: 'Active User',
  email: 'active@example.com',
  firstName: 'Active',
  lastName: 'User',
  role: 'user',
  disabled: false,
  emailVerified: false,
  youtubeAccess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const disabledUser: AdminUserIdentity = {
  ...activeUser,
  id: 'u-disabled',
  name: 'Disabled User',
  disabled: true,
};

const platformAdmin: AdminUserIdentity = {
  id: 'u-admin',
  name: 'Platform Admin',
  email: 'admin@example.com',
  firstName: 'Platform',
  lastName: 'Admin',
  role: 'platform_admin',
  disabled: false,
  emailVerified: true,
  youtubeAccess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const youtubeUser: AdminUserIdentity = {
  ...activeUser,
  id: 'u-youtube',
  name: 'YouTube User',
  youtubeAccess: true,
};

function createAxiosError(message: string, status: number) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { message } },
  });
}

function renderUserLifecycleActions(user: AdminUserIdentity) {
  return render(
    <UserLifecycleActions user={user} onUserUpdated={mockOnUserUpdated} />,
  );
}

function openAction(actionLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: actionLabel }));
}

function confirmDialog(confirmLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
}

describe('UserLifecycleActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    (createPlatformAdminApi as jest.Mock).mockReturnValue({
      disableUser: mockDisableUser,
      enableUser: mockEnableUser,
      forceLogoutUser: mockForceLogoutUser,
      resendVerification: mockResendVerification,
      promoteUser: mockPromoteUser,
      demoteUser: mockDemoteUser,
      grantYouTubeAccess: mockGrantYouTubeAccess,
      withdrawYouTubeAccess: mockWithdrawYouTubeAccess,
    });
  });

  it('shows Disable, Force logout, Resend verification, and Promote for an active user', () => {
    renderUserLifecycleActions(activeUser);

    expect(
      screen.getByRole('heading', { name: 'Actions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Force logout' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Resend verification' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enable' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Demote' }),
    ).not.toBeInTheDocument();
  });

  it('shows Enable and hides Disable for a disabled user', () => {
    renderUserLifecycleActions(disabledUser);

    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Disable' }),
    ).not.toBeInTheDocument();
  });

  it('shows Demote and hides Promote for a platform admin', () => {
    renderUserLifecycleActions(platformAdmin);

    expect(screen.getByRole('button', { name: 'Demote' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Promote' }),
    ).not.toBeInTheDocument();
  });

  it('hides Resend verification when email is verified', () => {
    renderUserLifecycleActions({ ...activeUser, emailVerified: true });

    expect(
      screen.queryByRole('button', { name: 'Resend verification' }),
    ).not.toBeInTheDocument();
  });

  it('disables the user after confirmation', async () => {
    const updatedUser = { ...activeUser, disabled: true };
    mockDisableUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Disable');
    expect(
      screen.getByRole('heading', { name: 'Disable user?' }),
    ).toBeInTheDocument();
    confirmDialog('Disable user');

    await waitFor(() => {
      expect(mockDisableUser).toHaveBeenCalledWith({ userId: activeUser.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User disabled' });
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Disable user?' }),
      ).not.toBeInTheDocument();
    });
  });

  it('enables the user after confirmation', async () => {
    const updatedUser = { ...disabledUser, disabled: false };
    mockEnableUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(disabledUser);
    openAction('Enable');
    confirmDialog('Enable user');

    await waitFor(() => {
      expect(mockEnableUser).toHaveBeenCalledWith({ userId: disabledUser.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User enabled' });
  });

  it('forces logout after confirmation', async () => {
    const updatedUser = { ...activeUser };
    mockForceLogoutUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Force logout');
    confirmDialog('Force logout');

    await waitFor(() => {
      expect(mockForceLogoutUser).toHaveBeenCalledWith({
        userId: activeUser.id,
      });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User sessions revoked' });
  });

  it('resends verification after confirmation without updating parent user state', async () => {
    mockResendVerification.mockResolvedValue({
      data: { message: 'Verification email sent successfully' },
    });

    renderUserLifecycleActions(activeUser);
    openAction('Resend verification');
    confirmDialog('Resend email');

    await waitFor(() => {
      expect(mockResendVerification).toHaveBeenCalledWith({
        userId: activeUser.id,
      });
    });
    expect(mockOnUserUpdated).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Verification email sent successfully',
    });
  });

  it('promotes the user after confirmation', async () => {
    const updatedUser = { ...activeUser, role: 'platform_admin' as const };
    mockPromoteUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Promote');
    confirmDialog('Promote user');

    await waitFor(() => {
      expect(mockPromoteUser).toHaveBeenCalledWith({ userId: activeUser.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'User promoted to Platform Admin',
    });
  });

  it('demotes the user after confirmation', async () => {
    const updatedUser = { ...platformAdmin, role: 'user' as const };
    mockDemoteUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(platformAdmin);
    openAction('Demote');
    confirmDialog('Demote user');

    await waitFor(() => {
      expect(mockDemoteUser).toHaveBeenCalledWith({ userId: platformAdmin.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User demoted' });
  });

  it('surfaces last-admin demotion errors in a destructive toast and keeps the dialog open', async () => {
    mockDemoteUser.mockRejectedValue(
      createAxiosError('Cannot demote the last Platform Admin', 409),
    );

    renderUserLifecycleActions(platformAdmin);
    openAction('Demote');
    confirmDialog('Demote user');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Action failed',
        description: 'Cannot demote the last Platform Admin',
        variant: 'destructive',
      });
    });
    expect(mockOnUserUpdated).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Demote Platform Admin?' }),
    ).toBeInTheDocument();
  });

  it('shows a generic error message when the API rejects a non-axios error', async () => {
    mockDisableUser.mockRejectedValue(new Error('Network error'));

    renderUserLifecycleActions(activeUser);
    openAction('Disable');
    confirmDialog('Disable user');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Action failed',
        description: 'Action failed. Please try again.',
        variant: 'destructive',
      });
    });
    expect(mockOnUserUpdated).not.toHaveBeenCalled();
  });

  it('closes the dialog on cancel without calling the API', () => {
    renderUserLifecycleActions(activeUser);
    openAction('Disable');
    expect(
      screen.getByRole('heading', { name: 'Disable user?' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockDisableUser).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: 'Disable user?' }),
    ).not.toBeInTheDocument();
  });

  it('shows Grant YouTube Access and hides Withdraw for a user without YouTube Access', () => {
    renderUserLifecycleActions(activeUser);

    expect(
      screen.getByRole('button', { name: 'Grant YouTube Access' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Withdraw YouTube Access' }),
    ).not.toBeInTheDocument();
  });

  it('shows Withdraw YouTube Access and hides Grant for a user with YouTube Access', () => {
    renderUserLifecycleActions(youtubeUser);

    expect(
      screen.getByRole('button', { name: 'Withdraw YouTube Access' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Grant YouTube Access' }),
    ).not.toBeInTheDocument();
  });

  it('grants YouTube Access after confirmation and passes the response identity to the parent', async () => {
    const updatedUser = { ...activeUser, youtubeAccess: true };
    mockGrantYouTubeAccess.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Grant YouTube Access');
    expect(
      screen.getByRole('heading', { name: 'Grant YouTube Access?' }),
    ).toBeInTheDocument();
    confirmDialog('Grant access');

    await waitFor(() => {
      expect(mockGrantYouTubeAccess).toHaveBeenCalledWith({
        userId: activeUser.id,
      });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'YouTube Access granted' });
  });

  it('withdraws YouTube Access after a confirmation that names the data deletion, and strips youtubeDisconnect from the identity', async () => {
    mockWithdrawYouTubeAccess.mockResolvedValue({
      data: {
        ...youtubeUser,
        youtubeAccess: false,
        youtubeDisconnect: 'completed',
      },
    });

    renderUserLifecycleActions(youtubeUser);
    openAction('Withdraw YouTube Access');
    expect(
      screen.getByRole('heading', { name: 'Withdraw YouTube Access?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Their YouTube data will be deleted/),
    ).toBeInTheDocument();
    confirmDialog('Withdraw access');

    await waitFor(() => {
      expect(mockWithdrawYouTubeAccess).toHaveBeenCalledWith({
        userId: youtubeUser.id,
      });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith({
      ...youtubeUser,
      youtubeAccess: false,
    });
    expect(mockOnUserUpdated.mock.calls[0][0]).not.toHaveProperty(
      'youtubeDisconnect',
    );
  });

  it.each([
    {
      outcome: 'completed',
      expectedToast: {
        title: 'YouTube Access withdrawn',
        description: 'Their YouTube data was deleted.',
      },
    },
    {
      outcome: 'pending',
      expectedToast: {
        title: 'YouTube Access withdrawn',
        description:
          'A YouTube sync is running. Their YouTube data will be deleted when it finishes.',
      },
    },
    {
      outcome: 'not_connected',
      expectedToast: { title: 'YouTube Access withdrawn' },
    },
  ])(
    'shows the withdrawal toast for the $outcome disconnect outcome',
    async ({ outcome, expectedToast }) => {
      mockWithdrawYouTubeAccess.mockResolvedValue({
        data: {
          ...youtubeUser,
          youtubeAccess: false,
          youtubeDisconnect: outcome,
        },
      });

      renderUserLifecycleActions(youtubeUser);
      openAction('Withdraw YouTube Access');
      confirmDialog('Withdraw access');

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(expectedToast);
      });
      expect(mockOnUserUpdated).toHaveBeenCalledTimes(1);
    },
  );

  it('shows the server ceiling message in a destructive toast and leaves the user unchanged', async () => {
    const ceilingMessage =
      'YouTube Access ceiling reached: 25 of 25 places used. Raise YOUTUBE_ACCESS_CEILING to grant more.';
    mockGrantYouTubeAccess.mockRejectedValue(
      createAxiosError(ceilingMessage, 409),
    );

    renderUserLifecycleActions(activeUser);
    openAction('Grant YouTube Access');
    confirmDialog('Grant access');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Action failed',
        description: ceilingMessage,
        variant: 'destructive',
      });
    });
    expect(mockOnUserUpdated).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Grant YouTube Access?' }),
    ).toBeInTheDocument();
  });
});

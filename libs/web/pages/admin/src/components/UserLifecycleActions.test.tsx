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

import type {
  AdminUserIdentity,
  YouTubeAccessUsageResponse,
} from '@myorganiser/app-api-client';
import { useToast } from '@myorganiser/web-ui';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';

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
const mockOnActionCompleted = jest.fn();

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

const youtubeUsage: YouTubeAccessUsageResponse = {
  everGranted: 18,
  ceiling: 25,
};

function createAxiosError(message: string, status: number) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { message } },
  });
}

// jsdom has no matchMedia, which useIsMobile subscribes to, so stub it as
// AdminSidebar.test.tsx does. useIsMobile reads innerWidth: jsdom's 1024
// default gives desktop (the Dialog, not the BottomSheet).
function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
}

function renderUserLifecycleActions(user: AdminUserIdentity) {
  return render(
    <UserLifecycleActions
      user={user}
      onUserUpdated={mockOnUserUpdated}
      isSelf={false}
      youtubeUsage={youtubeUsage}
      youtubeUsageFailed={false}
      variant="desktop"
    />,
  );
}

/** Renders with the batch 2 defaults (desktop, not self, usage loaded), overridable per test. */
function renderLifecycleActions(
  user: AdminUserIdentity,
  overrides: Partial<
    Omit<ComponentProps<typeof UserLifecycleActions>, 'user'>
  > = {},
) {
  return render(
    <UserLifecycleActions
      user={user}
      onUserUpdated={mockOnUserUpdated}
      isSelf={false}
      youtubeUsage={youtubeUsage}
      youtubeUsageFailed={false}
      variant="desktop"
      onActionCompleted={mockOnActionCompleted}
      {...overrides}
    />,
  );
}

const SELF_NOTE = "You can't disable or demote yourself.";

function openAction(actionLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: actionLabel }));
}

function confirmDialog(confirmLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
}

function dialogHeading(title: string) {
  return screen.queryByRole('heading', { name: title });
}

describe('UserLifecycleActions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    stubMatchMedia();
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

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('offers Disable, Log out everywhere, Resend verification (enabled), Promote, and Grant for an active user', () => {
    renderUserLifecycleActions(activeUser);

    expect(
      screen.getByRole('button', { name: 'Disable account' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Log out everywhere' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Resend verification' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Promote to Platform Admin' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Grant YouTube Access' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enable account' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Demote Platform Admin' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Withdraw YouTube Access' }),
    ).not.toBeInTheDocument();
  });

  it('shows Enable account and hides Disable account for a disabled user', () => {
    renderUserLifecycleActions(disabledUser);

    expect(
      screen.getByRole('button', { name: 'Enable account' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Disable account' }),
    ).not.toBeInTheDocument();
  });

  it('shows Demote Platform Admin and hides Promote for a platform admin', () => {
    renderUserLifecycleActions(platformAdmin);

    expect(
      screen.getByRole('button', { name: 'Demote Platform Admin' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Promote to Platform Admin' }),
    ).not.toBeInTheDocument();
  });

  it('shows Resend verification disabled when the email is verified', () => {
    renderUserLifecycleActions({ ...activeUser, emailVerified: true });

    expect(
      screen.getByRole('button', { name: 'Resend verification' }),
    ).toBeDisabled();
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

  it('disables the user after confirmation and closes the dialog', async () => {
    const updatedUser = { ...activeUser, disabled: true };
    mockDisableUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Disable account');
    expect(dialogHeading('Disable user?')).toBeInTheDocument();
    confirmDialog('Disable user');

    await waitFor(() => {
      expect(mockDisableUser).toHaveBeenCalledWith({ userId: activeUser.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User disabled' });
    await waitFor(() => {
      expect(dialogHeading('Disable user?')).not.toBeInTheDocument();
    });
  });

  it('enables the user after confirmation and closes the dialog', async () => {
    const updatedUser = { ...disabledUser, disabled: false };
    mockEnableUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(disabledUser);
    openAction('Enable account');
    confirmDialog('Enable user');

    await waitFor(() => {
      expect(mockEnableUser).toHaveBeenCalledWith({ userId: disabledUser.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User enabled' });
    await waitFor(() => {
      expect(dialogHeading('Enable user?')).not.toBeInTheDocument();
    });
  });

  it('logs the user out everywhere after confirmation and closes the dialog', async () => {
    const updatedUser = { ...activeUser };
    mockForceLogoutUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Log out everywhere');
    expect(dialogHeading('Force logout?')).toBeInTheDocument();
    confirmDialog('Force logout');

    await waitFor(() => {
      expect(mockForceLogoutUser).toHaveBeenCalledWith({
        userId: activeUser.id,
      });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User sessions revoked' });
    await waitFor(() => {
      expect(dialogHeading('Force logout?')).not.toBeInTheDocument();
    });
  });

  it('resends verification after confirmation without updating the parent user and closes the dialog', async () => {
    mockResendVerification.mockResolvedValue({
      data: { message: 'Verification email sent successfully' },
    });

    renderUserLifecycleActions(activeUser);
    openAction('Resend verification');
    expect(dialogHeading('Resend verification email?')).toBeInTheDocument();
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
    await waitFor(() => {
      expect(
        dialogHeading('Resend verification email?'),
      ).not.toBeInTheDocument();
    });
  });

  it('shows the default resend toast when the response carries no message', async () => {
    mockResendVerification.mockResolvedValue({ data: {} });

    renderUserLifecycleActions(activeUser);
    openAction('Resend verification');
    confirmDialog('Resend email');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Verification email sent',
      });
    });
    expect(mockOnUserUpdated).not.toHaveBeenCalled();
  });

  it('promotes the user after confirmation and closes the dialog', async () => {
    const updatedUser = { ...activeUser, role: 'platform_admin' as const };
    mockPromoteUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Promote to Platform Admin');
    confirmDialog('Promote user');

    await waitFor(() => {
      expect(mockPromoteUser).toHaveBeenCalledWith({ userId: activeUser.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'User promoted to Platform Admin',
    });
    await waitFor(() => {
      expect(
        dialogHeading('Promote to Platform Admin?'),
      ).not.toBeInTheDocument();
    });
  });

  it('demotes the user after confirmation and closes the dialog', async () => {
    const updatedUser = { ...platformAdmin, role: 'user' as const };
    mockDemoteUser.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(platformAdmin);
    openAction('Demote Platform Admin');
    confirmDialog('Demote user');

    await waitFor(() => {
      expect(mockDemoteUser).toHaveBeenCalledWith({ userId: platformAdmin.id });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'User demoted' });
    await waitFor(() => {
      expect(dialogHeading('Demote Platform Admin?')).not.toBeInTheDocument();
    });
  });

  it('grants YouTube Access after confirmation, passes the response identity to the parent, and closes the dialog', async () => {
    const updatedUser = { ...activeUser, youtubeAccess: true };
    mockGrantYouTubeAccess.mockResolvedValue({ data: updatedUser });

    renderUserLifecycleActions(activeUser);
    openAction('Grant YouTube Access');
    expect(dialogHeading('Grant YouTube Access?')).toBeInTheDocument();
    confirmDialog('Grant access');

    await waitFor(() => {
      expect(mockGrantYouTubeAccess).toHaveBeenCalledWith({
        userId: activeUser.id,
      });
    });
    expect(mockOnUserUpdated).toHaveBeenCalledWith(updatedUser);
    expect(mockToast).toHaveBeenCalledWith({ title: 'YouTube Access granted' });
    await waitFor(() => {
      expect(dialogHeading('Grant YouTube Access?')).not.toBeInTheDocument();
    });
  });

  it('names the user and the data deletion in the withdraw confirmation, then strips youtubeDisconnect from the identity and shows the completed toast', async () => {
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
      dialogHeading('Withdraw YouTube Access from YouTube User?'),
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
    expect(mockToast).toHaveBeenCalledWith({
      title: 'YouTube Access withdrawn',
      description: 'Their YouTube data was deleted.',
    });
  });

  it.each([
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

  it('shows the last-admin demotion error in a destructive toast and keeps the dialog open', async () => {
    mockDemoteUser.mockRejectedValue(
      createAxiosError('Cannot demote the last Platform Admin', 409),
    );

    renderUserLifecycleActions(platformAdmin);
    openAction('Demote Platform Admin');
    confirmDialog('Demote user');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Action failed',
        description: 'Cannot demote the last Platform Admin',
        variant: 'destructive',
      });
    });
    expect(mockOnUserUpdated).not.toHaveBeenCalled();
    expect(dialogHeading('Demote Platform Admin?')).toBeInTheDocument();
  });

  it('shows a generic error message when the API rejects a non-axios error', async () => {
    mockDisableUser.mockRejectedValue(new Error('Network error'));

    renderUserLifecycleActions(activeUser);
    openAction('Disable account');
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
    expect(dialogHeading('Grant YouTube Access?')).toBeInTheDocument();
  });

  it('closes the dialog on cancel without calling the API', async () => {
    renderUserLifecycleActions(activeUser);
    openAction('Disable account');
    expect(dialogHeading('Disable user?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockDisableUser).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dialogHeading('Disable user?')).not.toBeInTheDocument();
    });
  });

  describe('self-guard', () => {
    it('disables Disable account for the signed-in admin and describes it with the self-guard note', () => {
      renderLifecycleActions(activeUser, { isSelf: true });

      const disable = screen.getByRole('button', { name: 'Disable account' });
      expect(disable).toBeDisabled();
      expect(screen.getByText(SELF_NOTE)).toBeVisible();
      expect(disable).toHaveAccessibleDescription(SELF_NOTE);
    });

    it('disables Demote Platform Admin for the signed-in admin and describes it with the self-guard note', () => {
      renderLifecycleActions(platformAdmin, { isSelf: true });

      const demote = screen.getByRole('button', {
        name: 'Demote Platform Admin',
      });
      expect(demote).toBeDisabled();
      expect(demote).toHaveAccessibleDescription(SELF_NOTE);
    });

    it.each([
      { user: activeUser, youtubeButton: 'Grant YouTube Access' },
      { user: youtubeUser, youtubeButton: 'Withdraw YouTube Access' },
    ])(
      'keeps Log out everywhere and $youtubeButton enabled for the signed-in admin',
      ({ user, youtubeButton }) => {
        renderLifecycleActions(user, { isSelf: true });

        expect(
          screen.getByRole('button', { name: 'Log out everywhere' }),
        ).toBeEnabled();
        expect(
          screen.getByRole('button', { name: youtubeButton }),
        ).toBeEnabled();
      },
    );

    it('omits the self-guard note and leaves Disable account enabled when the admin is another user', () => {
      renderLifecycleActions(activeUser);

      expect(screen.queryByText(SELF_NOTE)).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Disable account' }),
      ).toBeEnabled();
    });

    it('keeps Enable account enabled for the signed-in admin and still shows the self-guard note', () => {
      renderLifecycleActions(disabledUser, { isSelf: true });

      expect(
        screen.getByRole('button', { name: 'Enable account' }),
      ).toBeEnabled();
      expect(screen.getByText(SELF_NOTE)).toBeVisible();
    });
  });

  describe('confirmation, completion, and busy state', () => {
    it('shows the audit-log note inside the confirmation dialog', () => {
      renderLifecycleActions(activeUser);
      openAction('Disable account');

      expect(
        within(screen.getByRole('alertdialog')).getByText(
          'The action is written to the audit log under your name.',
        ),
      ).toBeInTheDocument();
    });

    it.each([
      {
        action: 'disable',
        openLabel: 'Disable account',
        confirmLabel: 'Disable user',
        api: mockDisableUser,
        response: { ...activeUser, disabled: true },
      },
      {
        action: 'resendVerification',
        openLabel: 'Resend verification',
        confirmLabel: 'Resend email',
        api: mockResendVerification,
        response: { message: 'Verification email sent' },
      },
    ])(
      "calls onActionCompleted once with '$action' after the API succeeds",
      async ({ action, openLabel, confirmLabel, api, response }) => {
        api.mockResolvedValue({ data: response });

        renderLifecycleActions(activeUser);
        openAction(openLabel);
        confirmDialog(confirmLabel);

        await waitFor(() => {
          expect(mockOnActionCompleted).toHaveBeenCalledWith(action);
        });
        expect(mockOnActionCompleted).toHaveBeenCalledTimes(1);
      },
    );

    it('does not call onActionCompleted when the API rejects', async () => {
      mockDisableUser.mockRejectedValue(new Error('Network error'));

      renderLifecycleActions(activeUser);
      openAction('Disable account');
      confirmDialog('Disable user');

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Action failed',
          description: 'Action failed. Please try again.',
          variant: 'destructive',
        });
      });
      expect(mockOnActionCompleted).not.toHaveBeenCalled();
    });

    it('replaces the Disable account button name with Disabling… and disables the other rows while the API call is pending', async () => {
      let resolveDisable!: (value: { data: AdminUserIdentity }) => void;
      mockDisableUser.mockReturnValue(
        new Promise((resolve) => {
          resolveDisable = resolve;
        }),
      );

      renderLifecycleActions(activeUser);
      openAction('Disable account');
      confirmDialog('Disable user');

      // Radix hides the page behind the open dialog, so the rows are queried with hidden: true.
      expect(
        await screen.findByRole('button', { name: 'Disabling…', hidden: true }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Grant YouTube Access',
          hidden: true,
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', {
          name: 'Promote to Platform Admin',
          hidden: true,
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', {
          name: 'Resend verification',
          hidden: true,
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', {
          name: 'Log out everywhere',
          hidden: true,
        }),
      ).toBeDisabled();

      await act(async () => {
        resolveDisable({ data: { ...activeUser, disabled: true } });
      });
      await waitFor(() => {
        expect(dialogHeading('Disable user?')).not.toBeInTheDocument();
      });
    });
  });

  describe('YouTube Access places description', () => {
    it.each([
      {
        name: 'shows the places left out of the ceiling when usage has loaded',
        usage: youtubeUsage,
        usageFailed: false,
        expected: 'Granted · 7 of 25 places left',
      },
      {
        name: 'shows Unavailable when the usage call failed',
        usage: null,
        usageFailed: true,
        expected: 'Granted · Unavailable',
      },
      {
        name: 'shows Loading… while usage is pending',
        usage: null,
        usageFailed: false,
        expected: 'Granted · Loading…',
      },
    ])('$name', ({ usage, usageFailed, expected }) => {
      renderLifecycleActions(youtubeUser, {
        youtubeUsage: usage,
        youtubeUsageFailed: usageFailed,
      });

      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe('phone variant', () => {
    beforeEach(() => {
      // useIsMobile reads innerWidth, not matchMedia, so a phone width selects the phone layout.
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 375,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 1024,
      });
    });

    it('shows the short visible labels while keeping the full accessible names', () => {
      renderLifecycleActions(activeUser, { variant: 'phone' });

      expect(
        screen.getByRole('button', { name: 'Disable account' }),
      ).toHaveTextContent(/^Disable$/);
      expect(
        screen.getByRole('button', { name: 'Log out everywhere' }),
      ).toHaveTextContent(/^Log out$/);
      expect(
        screen.getByRole('button', { name: 'Promote to Platform Admin' }),
      ).toHaveTextContent(/^Promote$/);
      expect(
        screen.getByRole('button', { name: 'Grant YouTube Access' }),
      ).toHaveTextContent(/^Grant$/);
    });

    it('titles the phone groups Access and Sign-in', () => {
      renderLifecycleActions(activeUser, { variant: 'phone' });

      expect(
        screen.getByRole('heading', { name: 'Access' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Sign-in' }),
      ).toBeInTheDocument();
    });

    it("opens Withdraw as an alertdialog titled with the user's name", () => {
      renderLifecycleActions(youtubeUser, { variant: 'phone' });
      openAction('Withdraw YouTube Access');

      expect(
        screen.getByRole('alertdialog', {
          name: 'Withdraw YouTube Access from YouTube User?',
        }),
      ).toBeInTheDocument();
    });
  });
});

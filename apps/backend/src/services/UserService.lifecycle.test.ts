import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import jwt from 'jsonwebtoken';

import {
  EmailAlreadyVerifiedError,
  LastPlatformAdminError,
  UserNotFoundError,
  VerificationCooldownError,
  YouTubeAccessCeilingReachedError,
} from '../errors/AdminLifecycleErrors';
import userService from './UserService';

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type CountMock = jest.Mock<(...args: unknown[]) => Promise<number>>;

type MockPrismaClient = {
  user: {
    findUnique: AsyncMock;
    update: AsyncMock;
    updateMany: AsyncMock;
    count: CountMock;
  };
  adminAuditLog: {
    create: AsyncMock;
    findMany: AsyncMock;
  };
  $transaction: AsyncMock;
  $executeRaw: AsyncMock;
};

jest.mock('../prisma', () => {
  const __mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    adminAuditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: typeof __mockPrisma) => unknown) =>
      fn(__mockPrisma),
    ),
    $executeRaw: jest.fn(),
  };

  return {
    __esModule: true,
    __mockPrisma,
    createPrismaClient: jest.fn(() => __mockPrisma),
    PrismaClient: jest.fn(),
  };
});

jest.mock('./EmailService', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../helpers/ApiTokens', () => ({
  __esModule: true,
  default: {
    generateEmailVerificationToken: jest.fn(),
  },
}));

const mockPrisma = require('../prisma').__mockPrisma as MockPrismaClient;

const ACTOR_ID = 'actor-1';
const TARGET_ID = 'target-1';

type IdentityUser = {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  phone: null;
  email: string;
  role: 'user' | 'platform_admin';
  disabled: boolean;
  email_verification_timestamp: null;
};

const identityUser: IdentityUser = {
  id: TARGET_ID,
  name: 'Target User',
  first_name: 'Target',
  last_name: 'User',
  phone: null,
  email: 'target@example.com',
  role: 'user',
  disabled: false,
  email_verification_timestamp: null,
};

const fullUser = {
  id: TARGET_ID,
  email: 'target@example.com',
  name: 'Target User',
  email_verification_timestamp: null,
  email_verification_token: null,
};

function mockIdentityLookup(user: IdentityUser | null = identityUser) {
  mockPrisma.user.findUnique.mockImplementation(
    ({ select }: { select?: unknown }) => {
      if (select) {
        return Promise.resolve(user);
      }
      return Promise.resolve(user ? fullUser : null);
    },
  );
}

describe('UserService lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: MockPrismaClient) => unknown) => fn(mockPrisma),
    );
  });

  describe('disableUser', () => {
    test('sets disabled and sessions_invalidated_at and writes disable audit', async () => {
      mockIdentityLookup();
      const updated = { ...identityUser, disabled: true };
      mockPrisma.user.update.mockResolvedValue(updated);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.disableUser(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: {
          disabled: true,
          sessions_invalidated_at: expect.any(Date),
        },
        select: expect.objectContaining({ id: true, disabled: true }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'disable',
        },
      });
    });

    test('throws UserNotFoundError when target is missing', async () => {
      mockIdentityLookup(null);

      await expect(
        userService.disableUser(ACTOR_ID, TARGET_ID),
      ).rejects.toThrow(UserNotFoundError);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('enableUser', () => {
    test('clears disabled flag without touching sessions_invalidated_at', async () => {
      mockIdentityLookup({ ...identityUser, disabled: true });
      const updated = { ...identityUser, disabled: false };
      mockPrisma.user.update.mockResolvedValue(updated);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.enableUser(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { disabled: false },
        select: expect.objectContaining({ id: true, disabled: true }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'enable',
        },
      });
    });
  });

  describe('forceLogoutUser', () => {
    test('sets sessions_invalidated_at without disabling the account', async () => {
      mockIdentityLookup();
      mockPrisma.user.update.mockResolvedValue(identityUser);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.forceLogoutUser(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(identityUser);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { sessions_invalidated_at: expect.any(Date) },
        select: expect.objectContaining({ id: true, disabled: true }),
      });
      expect(
        (
          mockPrisma.user.update.mock.calls[0][0] as {
            data: Record<string, unknown>;
          }
        ).data,
      ).not.toHaveProperty('disabled');
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'force_logout',
        },
      });
    });
  });

  describe('promoteUser', () => {
    test('promotes a user to platform_admin and writes promote audit', async () => {
      mockIdentityLookup();
      const promoted = { ...identityUser, role: 'platform_admin' as const };
      mockPrisma.user.update.mockResolvedValue(promoted);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.promoteUser(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(promoted);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { role: 'platform_admin' },
        select: expect.objectContaining({ role: true }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'promote',
        },
      });
    });
  });

  describe('demoteUser', () => {
    test('demotes platform_admin when more than one admin exists', async () => {
      mockIdentityLookup({ ...identityUser, role: 'platform_admin' });
      mockPrisma.user.count.mockResolvedValue(2);
      const demoted = { ...identityUser, role: 'user' as const };
      mockPrisma.user.update.mockResolvedValue(demoted);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.demoteUser(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(demoted);
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { role: 'platform_admin' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { role: 'user' },
        select: expect.objectContaining({ role: true }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'demote',
        },
      });
    });

    test('throws LastPlatformAdminError when target is the last platform admin', async () => {
      mockIdentityLookup({ ...identityUser, role: 'platform_admin' });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(userService.demoteUser(ACTOR_ID, TARGET_ID)).rejects.toThrow(
        LastPlatformAdminError,
      );

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('YouTube Access', () => {
    const ORIGINAL_CEILING = process.env.YOUTUBE_ACCESS_CEILING;
    const FIRST_GRANTED_AT = new Date('2025-01-01T00:00:00.000Z');

    // The grant reads first-granted time inside the transaction with a
    // select of that single column; every other identity read gets the row.
    function mockGrantLookup(firstGrantedAt: Date | null) {
      mockPrisma.user.findUnique.mockImplementation(
        ({ select }: { select?: unknown }) => {
          if (
            select &&
            'youtube_access_first_granted_at' in (select as object)
          ) {
            return Promise.resolve({
              youtube_access_first_granted_at: firstGrantedAt,
            });
          }
          return Promise.resolve(identityUser);
        },
      );
    }

    beforeEach(() => {
      process.env.YOUTUBE_ACCESS_CEILING = '2';
    });

    afterEach(() => {
      if (ORIGINAL_CEILING === undefined) {
        delete process.env.YOUTUBE_ACCESS_CEILING;
      } else {
        process.env.YOUTUBE_ACCESS_CEILING = ORIGINAL_CEILING;
      }
    });

    test('grant sets access and first-granted time and writes one grant audit row', async () => {
      mockGrantLookup(null);
      mockPrisma.user.count.mockResolvedValue(0);
      const granted = { ...identityUser, youtube_access: true };
      mockPrisma.user.update.mockResolvedValue(granted);
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.grantYouTubeAccess(ACTOR_ID, TARGET_ID);

      expect(result).toEqual(granted);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: {
          youtube_access: true,
          youtube_access_first_granted_at: expect.any(Date),
        },
        select: expect.objectContaining({ youtube_access: true }),
      });
      expect(
        (mockPrisma.user.update.mock.calls[0][0] as { data: object }).data,
      ).not.toHaveProperty('youtube_acknowledged_at');
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'youtube_access_grant',
        },
      });
    });

    test('grant takes the last free place when one place is still left', async () => {
      mockGrantLookup(null);
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.update.mockResolvedValue({
        ...identityUser,
        youtube_access: true,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      await userService.grantYouTubeAccess(ACTOR_ID, TARGET_ID);

      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { youtube_access_first_granted_at: { not: null } },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    });

    test('re-grant of a previously granted User succeeds at the ceiling and keeps the original first-granted time', async () => {
      mockGrantLookup(FIRST_GRANTED_AT);
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.user.update.mockResolvedValue({
        ...identityUser,
        youtube_access: true,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      await userService.grantYouTubeAccess(ACTOR_ID, TARGET_ID);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: {
          youtube_access: true,
          youtube_access_first_granted_at: FIRST_GRANTED_AT,
        },
        select: expect.objectContaining({ youtube_access: true }),
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    });

    test('grant of a never-granted User at the ceiling throws and writes nothing', async () => {
      mockGrantLookup(null);
      mockPrisma.user.count.mockResolvedValue(2);

      await expect(
        userService.grantYouTubeAccess(ACTOR_ID, TARGET_ID),
      ).rejects.toThrow(YouTubeAccessCeilingReachedError);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    test('withdraw clears access without clearing first-granted and writes one withdraw audit row', async () => {
      mockIdentityLookup();
      mockPrisma.user.update.mockResolvedValue({
        ...identityUser,
        youtube_access: false,
      });
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      await userService.withdrawYouTubeAccessGrant(ACTOR_ID, TARGET_ID);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { youtube_access: false },
        select: expect.objectContaining({ youtube_access: true }),
      });
      expect(
        (mockPrisma.user.update.mock.calls[0][0] as { data: object }).data,
      ).not.toHaveProperty('youtube_acknowledged_at');
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'youtube_access_withdraw',
        },
      });
    });

    test('grant of a missing User throws UserNotFoundError and writes nothing', async () => {
      mockIdentityLookup(null);

      await expect(
        userService.grantYouTubeAccess(ACTOR_ID, TARGET_ID),
      ).rejects.toThrow(UserNotFoundError);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    test('withdraw of a missing User throws UserNotFoundError and writes nothing', async () => {
      mockIdentityLookup(null);

      await expect(
        userService.withdrawYouTubeAccessGrant(ACTOR_ID, TARGET_ID),
      ).rejects.toThrow(UserNotFoundError);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    test('usage returns the ever-granted count against the configured ceiling', async () => {
      process.env.YOUTUBE_ACCESS_CEILING = '7';
      mockPrisma.user.count.mockResolvedValue(3);

      const usage = await userService.getYouTubeAccessUsage();

      expect(usage).toEqual({ everGranted: 3, ceiling: 7 });
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { youtube_access_first_granted_at: { not: null } },
      });
    });
  });

  describe('YouTube acknowledgement (ADR 0129)', () => {
    const FIRST_ACKNOWLEDGED_AT = new Date('2026-10-01T09:30:00.000Z');

    test('getYouTubeAcknowledgedAt returns the stored time', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        youtube_acknowledged_at: FIRST_ACKNOWLEDGED_AT,
      });

      const acknowledgedAt =
        await userService.getYouTubeAcknowledgedAt(TARGET_ID);

      expect(acknowledgedAt).toEqual(FIRST_ACKNOWLEDGED_AT);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        select: { youtube_acknowledged_at: true },
      });
    });

    test('acknowledgeYouTube stores the time when none is stored and returns the stored value', async () => {
      // The write lands, then the stored time is read back.
      mockPrisma.user.findUnique.mockResolvedValue({
        youtube_acknowledged_at: FIRST_ACKNOWLEDGED_AT,
      });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const acknowledgedAt = await userService.acknowledgeYouTube(TARGET_ID);

      expect(acknowledgedAt).toEqual(FIRST_ACKNOWLEDGED_AT);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: TARGET_ID, youtube_acknowledged_at: null },
        data: { youtube_acknowledged_at: expect.any(Date) },
      });
    });

    test('acknowledgeYouTube guards the write with a null where clause and returns the stored time', async () => {
      // The null guard in the where clause makes the database skip the write
      // (count 0); the stored time is what comes back.
      mockPrisma.user.findUnique.mockResolvedValue({
        youtube_acknowledged_at: FIRST_ACKNOWLEDGED_AT,
      });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      const acknowledgedAt = await userService.acknowledgeYouTube(TARGET_ID);

      expect(acknowledgedAt).toEqual(FIRST_ACKNOWLEDGED_AT);
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: TARGET_ID, youtube_acknowledged_at: null },
        data: { youtube_acknowledged_at: expect.any(Date) },
      });
    });

    test('acknowledgeYouTube returns null when the User is missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        userService.acknowledgeYouTube(TARGET_ID),
      ).resolves.toBeNull();
    });
  });

  describe('adminResendVerification', () => {
    test('stores verification token and writes resend_verification audit on success', async () => {
      mockIdentityLookup();
      const sendSpy = jest
        .spyOn(userService, 'sendVerificationMail')
        .mockResolvedValue('new-verification-token');
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.adminAuditLog.create.mockResolvedValue({});

      const result = await userService.adminResendVerification(
        ACTOR_ID,
        TARGET_ID,
      );

      expect(result).toEqual(identityUser);
      expect(sendSpy).toHaveBeenCalledWith(fullUser);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: TARGET_ID },
        data: { email_verification_token: 'new-verification-token' },
      });
      expect(mockPrisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          actor_user_id: ACTOR_ID,
          target_user_id: TARGET_ID,
          action: 'resend_verification',
        },
      });

      sendSpy.mockRestore();
    });

    test('throws VerificationCooldownError and skips audit when email was sent recently', async () => {
      mockIdentityLookup();
      const sendSpy = jest
        .spyOn(userService, 'sendVerificationMail')
        .mockResolvedValue(
          new Error('Verification email already sent recently'),
        );

      await expect(
        userService.adminResendVerification(ACTOR_ID, TARGET_ID),
      ).rejects.toThrow(VerificationCooldownError);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();

      sendSpy.mockRestore();
    });

    test('throws EmailAlreadyVerifiedError and skips audit when already verified', async () => {
      mockIdentityLookup();
      const sendSpy = jest
        .spyOn(userService, 'sendVerificationMail')
        .mockResolvedValue(new Error('Email already verified'));

      await expect(
        userService.adminResendVerification(ACTOR_ID, TARGET_ID),
      ).rejects.toThrow(EmailAlreadyVerifiedError);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.adminAuditLog.create).not.toHaveBeenCalled();

      sendSpy.mockRestore();
    });
  });

  describe('refreshToken', () => {
    const refreshSecret = 'refresh-key-01';
    let previousSecret: string | undefined;
    let errorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
      previousSecret = process.env.REFRESH_JWT_SECRET;
      process.env.REFRESH_JWT_SECRET = refreshSecret;
      errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
      if (previousSecret === undefined) {
        delete process.env.REFRESH_JWT_SECRET;
      } else {
        process.env.REFRESH_JWT_SECRET = previousSecret;
      }
    });

    test('resolves the User for a valid refresh token signed with the refresh secret', async () => {
      const user = { id: 'user-1', email: 'target@example.com' };
      const refreshToken = jwt.sign({ userId: 'user-1' }, refreshSecret);
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);

      await expect(userService.refreshToken(refreshToken)).resolves.toEqual(
        user,
      );
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    test('resolves null for a correctly signed refresh token whose User row is gone', async () => {
      const refreshToken = jwt.sign(
        { userId: 'user-deleted-1' },
        refreshSecret,
      );
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-deleted-1' },
      });
    });

    test('resolves null without looking up a User for an expired refresh token', async () => {
      const refreshToken = jwt.sign({ userId: 'user-1' }, refreshSecret, {
        expiresIn: -10,
      });

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('resolves null without looking up a User for a malformed refresh token', async () => {
      await expect(userService.refreshToken('not-a-jwt')).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('resolves null without looking up a User for a token signed with a different secret', async () => {
      const refreshToken = jwt.sign({ userId: 'user-1' }, 'other-refresh-key');

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('resolves null without looking up a User for a validly signed token whose payload is a string', async () => {
      const refreshToken = jwt.sign('user-1', refreshSecret);

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('resolves null without looking up a User for a validly signed token with no userId claim', async () => {
      const refreshToken = jwt.sign({ sub: 'user-1' }, refreshSecret);

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('resolves null without looking up a User for a validly signed token whose userId is not a string', async () => {
      const refreshToken = jwt.sign({ userId: 42 }, refreshSecret);

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    test('resolves null without looking up a User for a validly signed token whose userId is an empty string', async () => {
      const refreshToken = jwt.sign({ userId: '' }, refreshSecret);

      await expect(userService.refreshToken(refreshToken)).resolves.toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});

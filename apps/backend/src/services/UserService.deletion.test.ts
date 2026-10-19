import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import bcrypt from 'bcrypt';
import userService from './UserService';

jest.mock('../prisma', () => {
  const __mockPrisma = {
    user: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    feedbackReport: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
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

jest.mock('./YouTubeSyncService', () => ({
  __esModule: true,
  default: {
    disconnect: jest.fn(),
  },
}));

type AsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

type MockPrismaClient = {
  user: {
    findUnique: AsyncMock;
    delete: AsyncMock;
  };
  feedbackReport: {
    updateMany: AsyncMock;
    deleteMany: AsyncMock;
    update: AsyncMock;
  };
};

const CORRECT_PASSWORD = 'correctpass1';
const WRONG_PASSWORD = 'wrongpasswd1';
const USER_ID = 'user-1';
const USER_EMAIL = 'user@example.com';

// Real bcrypt hash so userService's bcrypt.compare runs for real.
const PASSWORD_HASH = bcrypt.hashSync(CORRECT_PASSWORD, 4);

function makeUser() {
  return {
    id: USER_ID,
    email: USER_EMAIL,
    name: 'Test User',
    first_name: 'Test',
    last_name: 'User',
    password: PASSWORD_HASH,
  };
}

describe('deleteUser - Feedback Report survival (#1210)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const { prisma, youtube, sendEmail } = refs();
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.user.delete.mockResolvedValue({ id: USER_ID });
    youtube.disconnect.mockResolvedValue({
      ok: true,
      message: 'YouTube account disconnected.',
    });
    sendEmail.mockResolvedValue(undefined);
  });

  test('deletes User via single row delete and never touches feedbackReport', async () => {
    const { prisma, sendEmail } = refs();
    const result = await userService.deleteUser(USER_ID, CORRECT_PASSWORD);

    expect(result).toEqual({ status: 'deleted' });
    expect(prisma.user.delete).toHaveBeenCalledTimes(1);
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: USER_ID },
    });

    // Feedback Report rows survive via the Foreign Key's `onDelete: SetNull`,
    // not through application code. The reporter link clears at the database
    // level (same mechanism as AdminAuditLog.actor_user_id/target_user_id),
    // so the service must never issue any updateMany, deleteMany, or update
    // against feedbackReport.
    expect(prisma.feedbackReport.updateMany).not.toHaveBeenCalled();
    expect(prisma.feedbackReport.deleteMany).not.toHaveBeenCalled();
    expect(prisma.feedbackReport.update).not.toHaveBeenCalled();

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('returns incorrect_password and never touches feedbackReport when password is wrong', async () => {
    const { prisma } = refs();
    const result = await userService.deleteUser(USER_ID, WRONG_PASSWORD);

    expect(result).toEqual({ status: 'incorrect_password' });
    expect(prisma.user.delete).not.toHaveBeenCalled();

    // Feedback Report should remain completely untouched.
    expect(prisma.feedbackReport.updateMany).not.toHaveBeenCalled();
    expect(prisma.feedbackReport.deleteMany).not.toHaveBeenCalled();
    expect(prisma.feedbackReport.update).not.toHaveBeenCalled();
  });
});

function refs() {
  const prisma: MockPrismaClient = require('../prisma').__mockPrisma;
  const youtube = require('./YouTubeSyncService').default;
  const sendEmail = require('./EmailService').default;
  return { prisma, youtube, sendEmail };
}

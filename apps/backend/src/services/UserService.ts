import { EMAIL_BRAND_NAME, renderEmailShell } from '@myorganiser/email-shell';
import bcrypt from 'bcrypt';
import { JwtPayload, TokenExpiredError } from 'jsonwebtoken';
import winston from 'winston';
import { getYouTubeAccessCeiling } from '../config/youtube';
import {
  EmailAlreadyVerifiedError,
  LastPlatformAdminError,
  UserNotFoundError,
  VerificationCooldownError,
  VerificationSendFailedError,
  YouTubeAccessCeilingReachedError,
} from '../errors/AdminLifecycleErrors';
import apiTokens from '../helpers/ApiTokens';
import { logErrorWithStack } from '../helpers/describeError';
import { isEmailVerified } from '../helpers/isEmailVerified';
import { decodeToken } from '../helpers/jwtHelper';
import { User, UserCreationBody } from '../models/User';
import {
  AdminAuditAction,
  Prisma,
  PrismaClient,
  createPrismaClient,
} from '../prisma';
import type { AdminUserSort, AdminUserStatusFilter, UserRole } from '../types';
import sendEmail from './EmailService';
import youtubeSyncService from './YouTubeSyncService';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

/** Fields safe to return from Platform Admin directory APIs. */
const ADMIN_IDENTITY_SELECT = {
  id: true,
  name: true,
  first_name: true,
  last_name: true,
  phone: true,
  email: true,
  role: true,
  disabled: true,
  email_verification_timestamp: true,
  youtube_access: true,
  created_at: true,
} as const;

export type AdminIdentityUser = Prisma.UserGetPayload<{
  select: typeof ADMIN_IDENTITY_SELECT;
}>;

/** Where-clause fan-out for the status filter. Disabled wins over the verification buckets. */
const ADMIN_USER_STATUS_WHERE = {
  disabled: { disabled: true },
  unverified: { disabled: false, email_verification_timestamp: null },
  active: { disabled: false, email_verification_timestamp: { not: null } },
} as const satisfies Record<AdminUserStatusFilter, Prisma.UserWhereInput>;

/** Order-by fan-out for the sort option. Ties break on id so paging is stable. */
const ADMIN_USER_SORT_ORDER = {
  newest: [{ created_at: 'desc' }, { id: 'asc' }],
  name: [{ name: 'asc' }, { email: 'asc' }, { id: 'asc' }],
} as const satisfies Record<
  AdminUserSort,
  readonly Prisma.UserOrderByWithRelationInput[]
>;

/** Options for one page of the Platform Admin users list. */
export interface AdminUserListOptions {
  q?: string;
  status?: AdminUserStatusFilter;
  role?: UserRole;
  sort: AdminUserSort;
  /** 1-based page. */
  page: number;
  pageSize: number;
}

export interface AdminUserListResult {
  users: AdminIdentityUser[];
  /** Count matching q + status + role, ignoring paging. */
  total: number;
}

export type AdminAuditLogRow = {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: AdminAuditAction;
  created_at: Date;
};

/** Outcome of User Deletion once the request has been authenticated. */
export type UserDeletionOutcome =
  | { status: 'deleted' }
  | { status: 'incorrect_password' }
  | { status: 'youtube_sync_live' };

class UserService {
  Users: User[] = [];
  SaltRounds = 10;

  constructor(private prisma: PrismaClient) {}

  async getById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
    });
    return user;
  }

  async getByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
    return user;
  }

  /**
   * One page of Users for the Platform Admin directory (identity fields only).
   * `q` matches email, name, first_name, or last_name (case-insensitive).
   * `total` counts every match of q + status + role, ignoring paging.
   */
  async listIdentityUsers(
    options: AdminUserListOptions,
  ): Promise<AdminUserListResult> {
    const query = (options.q ?? '').trim();
    const queryWhere: Prisma.UserWhereInput = query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
            { first_name: { contains: query, mode: 'insensitive' } },
            { last_name: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {};
    const statusWhere: Prisma.UserWhereInput =
      options.status === undefined
        ? {}
        : { ...ADMIN_USER_STATUS_WHERE[options.status] };
    const roleWhere: Prisma.UserWhereInput =
      options.role === undefined ? {} : { role: options.role };
    const where: Prisma.UserWhereInput = {
      ...queryWhere,
      ...statusWhere,
      ...roleWhere,
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: ADMIN_IDENTITY_SELECT,
        orderBy: [...ADMIN_USER_SORT_ORDER[options.sort]],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total };
  }

  async getIdentityById(id: string): Promise<AdminIdentityUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_IDENTITY_SELECT,
    });
  }

  /**
   * Elevate an existing User to platform_admin by email.
   * Idempotent: no-op if already platform_admin. Returns null if no User matches.
   * Bootstrap path only — does not write an Admin Audit Log entry.
   */
  async elevateToPlatformAdminByEmail(
    email: string,
  ): Promise<AdminIdentityUser | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: ADMIN_IDENTITY_SELECT,
    });
    if (!existing) return null;

    if (existing.role === 'platform_admin') {
      return existing;
    }

    return this.prisma.user.update({
      where: { id: existing.id },
      data: { role: 'platform_admin' },
      select: ADMIN_IDENTITY_SELECT,
    });
  }

  private async writeAdminAuditLog(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    targetUserId: string,
    action: AdminAuditAction,
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        action,
      },
    });
  }

  private async requireIdentityUser(
    userId: string,
  ): Promise<AdminIdentityUser> {
    const user = await this.getIdentityById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }
    return user;
  }

  /**
   * Soft-block a User and invalidate active refresh/access sessions immediately.
   */
  async disableUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    await this.requireIdentityUser(targetUserId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
          disabled: true,
          sessions_invalidated_at: new Date(),
        },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(tx, actorUserId, targetUserId, 'disable');
      return updated;
    });
  }

  /**
   * Re-enable a Disabled User so authentication works again.
   * Does not restore previously invalidated sessions.
   */
  async enableUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    await this.requireIdentityUser(targetUserId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { disabled: false },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(tx, actorUserId, targetUserId, 'enable');
      return updated;
    });
  }

  /**
   * Invalidate all refresh/access sessions without disabling the account.
   */
  async forceLogoutUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    await this.requireIdentityUser(targetUserId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { sessions_invalidated_at: new Date() },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(
        tx,
        actorUserId,
        targetUserId,
        'force_logout',
      );
      return updated;
    });
  }

  /**
   * Promote a User to Platform Admin. Idempotent if already platform_admin.
   */
  async promoteUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    const existing = await this.requireIdentityUser(targetUserId);

    if (existing.role === 'platform_admin') {
      await this.prisma.$transaction(async (tx) => {
        await this.writeAdminAuditLog(tx, actorUserId, targetUserId, 'promote');
      });
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { role: 'platform_admin' },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(tx, actorUserId, targetUserId, 'promote');
      return updated;
    });
  }

  /**
   * Demote a Platform Admin to a normal User.
   * Rejects when the target is the last Platform Admin.
   */
  async demoteUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    const existing = await this.requireIdentityUser(targetUserId);

    if (existing.role !== 'platform_admin') {
      await this.prisma.$transaction(async (tx) => {
        await this.writeAdminAuditLog(tx, actorUserId, targetUserId, 'demote');
      });
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const adminCount = await tx.user.count({
        where: { role: 'platform_admin' },
      });
      if (adminCount <= 1) {
        throw new LastPlatformAdminError();
      }

      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { role: 'user' },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(tx, actorUserId, targetUserId, 'demote');
      return updated;
    });
  }

  /**
   * Grant YouTube Access (ADR 0129). A never-granted User takes one place under
   * the lifetime ceiling; a previously granted User re-grants for free.
   * Refused with YouTubeAccessCeilingReachedError when no place is left.
   */
  async grantYouTubeAccess(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    await this.requireIdentityUser(targetUserId);

    return this.prisma.$transaction(async (tx) => {
      // Serialises grants so two concurrent grants cannot both take the last
      // place. $executeRaw with a constant statement; no interpolation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('youtube_access_ceiling'))`;

      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { youtube_access_first_granted_at: true },
      });
      if (!target) {
        throw new UserNotFoundError();
      }

      if (target.youtube_access_first_granted_at === null) {
        const everGranted = await tx.user.count({
          where: { youtube_access_first_granted_at: { not: null } },
        });
        const ceiling = getYouTubeAccessCeiling();
        if (everGranted >= ceiling) {
          throw new YouTubeAccessCeilingReachedError(everGranted, ceiling);
        }
      }

      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
          youtube_access: true,
          youtube_access_first_granted_at:
            target.youtube_access_first_granted_at ?? new Date(),
        },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(
        tx,
        actorUserId,
        targetUserId,
        'youtube_access_grant',
      );
      return updated;
    });
  }

  /**
   * Clear YouTube Access and write the audit row. Does not disconnect YouTube;
   * YouTubeAccessService.withdrawYouTubeAccess runs the YouTube Disconnect
   * after this commits.
   */
  async withdrawYouTubeAccessGrant(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    await this.requireIdentityUser(targetUserId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { youtube_access: false },
        select: ADMIN_IDENTITY_SELECT,
      });
      await this.writeAdminAuditLog(
        tx,
        actorUserId,
        targetUserId,
        'youtube_access_withdraw',
      );
      return updated;
    });
  }

  /**
   * Users ever granted YouTube Access, against the configured ceiling (ADR 0129).
   */
  async getYouTubeAccessUsage(): Promise<{
    everGranted: number;
    ceiling: number;
  }> {
    const everGranted = await this.prisma.user.count({
      where: { youtube_access_first_granted_at: { not: null } },
    });
    return { everGranted, ceiling: getYouTubeAccessCeiling() };
  }

  /**
   * When the User accepted the one-time YouTube acknowledgement (ADR 0129), or
   * null when they have not. Read from the database on every call.
   */
  async getYouTubeAcknowledgedAt(userId: string): Promise<Date | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { youtube_acknowledged_at: true },
    });
    return row?.youtube_acknowledged_at ?? null;
  }

  /**
   * Stores the one-time YouTube acknowledgement (ADR 0129). The write is
   * conditional on nothing being stored yet, so accepting again never moves the
   * time. Only the acknowledgement column is written: YouTube Disconnect and
   * YouTube Access withdrawal or re-grant never clear it.
   * Returns the stored time, or null when no such User exists.
   */
  async acknowledgeYouTube(userId: string): Promise<Date | null> {
    await this.prisma.user.updateMany({
      where: { id: userId, youtube_acknowledged_at: null },
      data: { youtube_acknowledged_at: new Date() },
    });
    return this.getYouTubeAcknowledgedAt(userId);
  }

  /**
   * Admin-triggered verification email resend.
   * Reuses public cooldown / already-verified semantics.
   */
  async adminResendVerification(
    actorUserId: string,
    targetUserId: string,
  ): Promise<AdminIdentityUser> {
    const identity = await this.requireIdentityUser(targetUserId);
    const user = await this.getById(targetUserId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const token = await this.sendVerificationMail(user);
    if (token instanceof Error) {
      if (token.message.includes('already verified')) {
        throw new EmailAlreadyVerifiedError();
      }
      if (token.message.includes('already sent recently')) {
        throw new VerificationCooldownError();
      }
      throw new VerificationSendFailedError();
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: { email_verification_token: token },
      });
      await this.writeAdminAuditLog(
        tx,
        actorUserId,
        targetUserId,
        'resend_verification',
      );
      return identity;
    });
  }

  /**
   * List recent Admin Audit Log entries (newest first).
   */
  async listAdminAuditLogs(limit = 50): Promise<AdminAuditLogRow[]> {
    const take = Math.min(Math.max(limit, 1), 200);
    return this.prisma.adminAuditLog.findMany({
      take,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        actor_user_id: true,
        target_user_id: true,
        action: true,
        created_at: true,
      },
    });
  }

  async create(user: UserCreationBody): Promise<User> {
    const hashedPassword = await bcrypt.hash(user.password, this.SaltRounds);
    const newUser = await this.prisma.user.create({
      data: {
        name: user.name ?? `${user.firstName} ${user.lastName}`,
        first_name: user.firstName,
        last_name: user.lastName,
        phone: user.phone,
        email: user.email,
        password: hashedPassword,
      },
    });
    return newUser;
  }

  async update(id: string, data: any): Promise<User> {
    const updatedUser = await this.prisma.user.update({
      where: {
        id,
      },
      data,
    });
    return updatedUser;
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: {
        id,
      },
    });
  }

  /**
   * User Deletion: immediate and irreversible removal of the User row. Every
   * owned relation cascades; Admin Audit Log actor/target are set to null.
   * Sessions end because the User row is gone. The password is re-verified
   * here, and the YouTube Connection goes first through YouTube Disconnect
   * (ADR 0129), which revokes the grant at Google outside any transaction and
   * is refused while a Sync Run is live (ADR 0092). Every refusal other than
   * that one — including "never connected" — lets the deletion proceed.
   * Confirmation mail failure never fails the call.
   */
  async deleteUser(
    userId: string,
    password: string,
  ): Promise<UserDeletionOutcome> {
    const user = await this.getById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return { status: 'incorrect_password' };
    }

    const youtube = await youtubeSyncService.disconnect(userId);
    if (youtube.ok === false && youtube.code === 'sync_run_live') {
      return { status: 'youtube_sync_live' };
    }

    const email = user.email;
    const displayName =
      user.name?.trim() || `${user.first_name} ${user.last_name}`;

    // One DELETE: the cascades and the audit-log SET NULL run inside it.
    await this.prisma.user.delete({ where: { id: userId } });

    await this.sendUserDeletionMail(email, displayName);
    return { status: 'deleted' };
  }

  private async sendUserDeletionMail(
    to: string,
    displayName: string,
  ): Promise<void> {
    const message = renderEmailShell({
      emailClass: 'transactional',
      preheader: `Your ${EMAIL_BRAND_NAME} account has been deleted.`,
      blocks: [
        { kind: 'heading', text: 'Your account has been deleted' },
        {
          kind: 'paragraph',
          text: `Hi ${displayName}, your ${EMAIL_BRAND_NAME} account and the data it held were permanently deleted at your request. This cannot be undone.`,
        },
        {
          kind: 'paragraph',
          text: `If you did not make this request, contact the ${EMAIL_BRAND_NAME} team.`,
        },
      ],
    });

    try {
      await sendEmail(
        to,
        `Your ${EMAIL_BRAND_NAME} account has been deleted`,
        message,
      );
    } catch (error) {
      logErrorWithStack(
        logger,
        'Failed to send User Deletion confirmation email',
        error,
      );
    }
  }

  async resetPassword(
    id: string,
    password: string,
    token: string,
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(password, this.SaltRounds);
    const data = {
      password: hashedPassword,
      reset_password_token: null,
    };
    const updatedUser = await this.prisma.user.update({
      where: {
        id,
        reset_password_token: token,
      },
      data,
    });

    return updatedUser;
  }

  async sendVerificationMail(user: User): Promise<string | Error> {
    if (isEmailVerified(user)) {
      return new Error('Email already verified');
    }

    const existingToken = (user as any)?.email_verification_token as
      | string
      | null
      | undefined;

    if (existingToken) {
      const decodedExisting = decodeToken(
        existingToken,
        process.env.VERIFY_JWT_SECRET as string,
      );
      const isExpired = decodedExisting instanceof TokenExpiredError;
      const isInvalid = decodedExisting instanceof Error;

      if (!isExpired && !isInvalid) {
        return new Error('Verification email already sent recently');
      }
    }

    const token = apiTokens.generateEmailVerificationToken(user.id);
    if (token instanceof Error) {
      return token;
    }
    const frontendBaseUrl = (process.env.APP_FRONTEND_URL || '').replace(
      /\/+$/,
      '',
    );
    const verifyUrl = `${frontendBaseUrl}/verify/email?token=${token}`;

    // Transactional Email: a User who opted out of this could never activate
    // their account, so the class declaration is what keeps the shell from
    // putting an unsubscribe link on it (ADR 0034).
    const message = renderEmailShell({
      emailClass: 'transactional',
      preheader:
        'Confirm your email address to finish setting up your account.',
      blocks: [
        { kind: 'heading', text: `Welcome to ${EMAIL_BRAND_NAME}` },
        {
          kind: 'paragraph',
          text: 'Thank you for registering. Confirm your email address to activate your account.',
        },
        { kind: 'button', label: 'Verify email', url: verifyUrl },
        {
          kind: 'paragraph',
          text: 'If you did not create an account, no further action is required.',
        },
      ],
    });

    try {
      await sendEmail(user.email, 'Verify your email', message);
      return token;
    } catch {
      return new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetMail(user: User): Promise<string | Error> {
    const token = apiTokens.generatePasswordResetToken(user.id);
    if (token instanceof Error) {
      return token;
    }
    const frontendBaseUrl = (process.env.APP_FRONTEND_URL || '').replace(
      /\/+$/,
      '',
    );
    const resetUrl = `${frontendBaseUrl}/reset/password?token=${token}`;

    const message = renderEmailShell({
      emailClass: 'transactional',
      preheader: 'Use the link inside to choose a new password.',
      blocks: [
        { kind: 'heading', text: 'Reset your password' },
        {
          kind: 'paragraph',
          text: 'We received a request to reset your password. Use the button below to choose a new one.',
        },
        { kind: 'button', label: 'Reset password', url: resetUrl },
        {
          kind: 'paragraph',
          text: 'If you did not request a password reset, no further action is required.',
        },
      ],
    });

    try {
      await sendEmail(user.email, 'Reset your password', message);
      return token;
    } catch {
      return new Error('Failed to send password reset email');
    }
  }

  async logout(userId: string, refreshToken: string): Promise<User> {
    const data = {
      blacklisted_tokens: {
        push: refreshToken,
      },
    };
    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data,
    });

    return updatedUser;
  }

  async refreshToken(refreshToken: string): Promise<User | null> {
    const decodedToken = decodeToken(
      refreshToken,
      process.env.REFRESH_JWT_SECRET as string,
    );

    // decodeToken returns verify errors rather than throwing, and jwt.verify
    // yields a bare string for a string payload, so only an object carrying a
    // non-empty string userId may reach the User lookup.
    if (decodedToken instanceof Error || typeof decodedToken !== 'object') {
      return null;
    }

    const { userId } = decodedToken as JwtPayload;
    if (typeof userId !== 'string' || userId === '') {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    return user;
  }
}

const userService = new UserService(createPrismaClient());
export default userService;

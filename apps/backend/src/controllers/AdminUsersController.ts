import {
  Get,
  Path,
  Post,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  Tags,
  TsoaResponse,
} from 'tsoa';
import { Request as ExRequest } from 'express';
import {
  EmailAlreadyVerifiedError,
  LastPlatformAdminError,
  UserNotFoundError,
  VerificationCooldownError,
  VerificationSendFailedError,
  YouTubeAccessCeilingReachedError,
} from '../errors/AdminLifecycleErrors';
import { PlatformAdminControllerBase } from './PlatformAdminControllerBase';
import { ValidateErrorJSON } from '../interfaces';
import { toAdminUserIdentity } from '../helpers/filterUser';
import youtubeAccessService from '../services/YouTubeAccessService';
import userService from '../services/UserService';
import {
  AdminUserIdentity,
  AdminUserListResponse,
  AdminUserSort,
  AdminUserStatusFilter,
  UserRole,
  VersionFloorRefusal,
  WithdrawYouTubeAccessResponse,
} from '../types';

const DEFAULT_ADMIN_USER_PAGE_SIZE = 25;
const DEFAULT_ADMIN_USER_SORT: AdminUserSort = 'newest';

@Tags('Platform Admin')
@Route('/admin/users')
@Security('jwt', ['platform_admin'])
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
export class AdminUsersController extends PlatformAdminControllerBase {
  /**
   * List/search Users (identity fields only), one page at a time. Platform
   * Admin only.
   * @param q Matches email, name, first name or last name (case-insensitive).
   * @param status `disabled`: Disabled Users. `unverified`: Unverified Users who
   * are not disabled. `active`: neither disabled nor unverified.
   * @param role `platform_admin` or `user`.
   * @param sort `newest` (joined, newest first; the default) or `name`.
   * @param page 1-based page number. Defaults to 1.
   * @param pageSize Users per page, 1 to 100. Defaults to 25.
   * @isInt page
   * @minimum page 1
   * @isInt pageSize
   * @minimum pageSize 1
   * @maximum pageSize 100
   */
  @Get()
  @Response<ValidateErrorJSON>(422, 'Validation Failed')
  async listUsers(
    @Request() req: ExRequest,
    @Query() q?: string,
    @Query() status?: AdminUserStatusFilter,
    @Query() role?: UserRole,
    @Query() sort?: AdminUserSort,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<AdminUserListResponse> {
    this.assertPlatformAdmin(req);
    const effectivePage = page ?? 1;
    const effectivePageSize = pageSize ?? DEFAULT_ADMIN_USER_PAGE_SIZE;
    const { users, total } = await userService.listIdentityUsers({
      q,
      status,
      role,
      sort: sort ?? DEFAULT_ADMIN_USER_SORT,
      page: effectivePage,
      pageSize: effectivePageSize,
    });
    return {
      users: users.map((user) => toAdminUserIdentity(user)),
      total,
      page: effectivePage,
      pageSize: effectivePageSize,
    };
  }

  /**
   * Get a User by id (identity fields only). Platform Admin only.
   */
  @Get('{userId}')
  @Response(404, 'User not found')
  async getUserById(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<AdminUserIdentity> {
    this.assertPlatformAdmin(req);
    const user = await userService.getIdentityById(userId);
    if (!user) {
      return notFound(404, { message: 'User not found' });
    }
    return toAdminUserIdentity(user);
  }

  /**
   * Disable a User (soft-block) and invalidate active sessions immediately.
   */
  @Post('{userId}/disable')
  @Response(404, 'User not found')
  async disableUser(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<AdminUserIdentity> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const user = await userService.disableUser(actor.id, userId);
      return toAdminUserIdentity(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Re-enable a Disabled User so authentication works again.
   */
  @Post('{userId}/enable')
  @Response(404, 'User not found')
  async enableUser(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<AdminUserIdentity> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const user = await userService.enableUser(actor.id, userId);
      return toAdminUserIdentity(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Force logout a User without disabling the account.
   */
  @Post('{userId}/force-logout')
  @Response(404, 'User not found')
  async forceLogoutUser(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<AdminUserIdentity> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const user = await userService.forceLogoutUser(actor.id, userId);
      return toAdminUserIdentity(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Resend verification email for an unverified User (existing cooldown rules).
   */
  @Post('{userId}/resend-verification')
  @Response(404, 'User not found')
  @Response(409, 'Email already verified')
  @Response(429, 'Verification email cooldown')
  async resendVerification(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
    @Res() conflict: TsoaResponse<409, { message: string }>,
    @Res() tooMany: TsoaResponse<429, { message: string }>,
  ): Promise<{ message: string }> {
    const actor = this.assertPlatformAdmin(req);
    try {
      await userService.adminResendVerification(actor.id, userId);
      return { message: 'Verification email sent successfully' };
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      if (err instanceof EmailAlreadyVerifiedError) {
        return conflict(409, { message: err.message });
      }
      if (err instanceof VerificationCooldownError) {
        return tooMany(429, { message: err.message });
      }
      if (err instanceof VerificationSendFailedError) {
        this.setStatus(500);
        throw err;
      }
      throw err;
    }
  }

  /**
   * Promote a User to Platform Admin.
   */
  @Post('{userId}/promote')
  @Response(404, 'User not found')
  async promoteUser(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<AdminUserIdentity> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const user = await userService.promoteUser(actor.id, userId);
      return toAdminUserIdentity(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Demote a Platform Admin to a normal User.
   * Rejects demotion of the last Platform Admin.
   */
  @Post('{userId}/demote')
  @Response(404, 'User not found')
  @Response(409, 'Cannot demote the last Platform Admin')
  async demoteUser(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
    @Res() conflict: TsoaResponse<409, { message: string }>,
  ): Promise<AdminUserIdentity> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const user = await userService.demoteUser(actor.id, userId);
      return toAdminUserIdentity(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      if (err instanceof LastPlatformAdminError) {
        return conflict(409, { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Grant YouTube Access to a User (ADR 0129). Refused with 409 when the
   * lifetime ceiling is reached and this User was never granted before.
   */
  @Post('{userId}/youtube-access/grant')
  @Response(404, 'User not found')
  @Response(409, 'YouTube Access ceiling reached')
  async grantYouTubeAccess(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
    @Res() conflict: TsoaResponse<409, { message: string }>,
  ): Promise<AdminUserIdentity> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const user = await userService.grantYouTubeAccess(actor.id, userId);
      return toAdminUserIdentity(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      if (err instanceof YouTubeAccessCeilingReachedError) {
        return conflict(409, { message: err.message });
      }
      throw err;
    }
  }

  /**
   * Withdraw YouTube Access from a User. A connected User is disconnected from
   * YouTube in the same operation; a live Sync Run leaves the disconnect pending.
   */
  @Post('{userId}/youtube-access/withdraw')
  @Response(404, 'User not found')
  async withdrawYouTubeAccess(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<WithdrawYouTubeAccessResponse> {
    const actor = this.assertPlatformAdmin(req);
    try {
      const { user, youtubeDisconnect } =
        await youtubeAccessService.withdrawYouTubeAccess(actor.id, userId);
      return { ...toAdminUserIdentity(user), youtubeDisconnect };
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return notFound(404, { message: err.message });
      }
      throw err;
    }
  }
}

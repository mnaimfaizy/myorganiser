import { Get, Query, Request, Response, Route, Security, Tags } from 'tsoa';
import { Request as ExRequest } from 'express';
import { ValidateErrorJSON } from '../interfaces';
import { PlatformAdminControllerBase } from './PlatformAdminControllerBase';
import userService from '../services/UserService';
import {
  AdminAuditAction,
  AdminAuditLogListResponse,
  VersionFloorRefusal,
} from '../types';

const DEFAULT_AUDIT_LOG_PAGE_SIZE = 25;

@Tags('Platform Admin')
@Route('/admin/audit-logs')
@Security('jwt', ['platform_admin'])
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
export class AdminAuditLogController extends PlatformAdminControllerBase {
  /**
   * List Admin Audit Log entries (newest first), one page at a time. Platform
   * Admin only. Each entry carries the actor and target display names; a
   * deleted User (User Deletion) has a null id, `actorDeleted`/`targetDeleted`
   * true, and a null name. Every action targets a User, and the actor is always
   * set at write time, so a null id only comes from User Deletion.
   * @param userId Entries where this User is the actor OR the target.
   * @param action Entries whose action is in this list. Repeat the parameter
   * for several actions (`?action=disable&action=enable`).
   * @param page 1-based page number. Defaults to 1.
   * @param pageSize Entries per page, 1 to 100. Defaults to 25.
   * @isInt page
   * @minimum page 1
   * @isInt pageSize
   * @minimum pageSize 1
   * @maximum pageSize 100
   */
  @Get()
  @Response<ValidateErrorJSON>(422, 'Validation Failed')
  async listAuditLogs(
    @Request() req: ExRequest,
    @Query() userId?: string,
    @Query() action?: AdminAuditAction[],
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<AdminAuditLogListResponse> {
    this.assertPlatformAdmin(req);
    const effectivePage = page ?? 1;
    const effectivePageSize = pageSize ?? DEFAULT_AUDIT_LOG_PAGE_SIZE;
    const { rows, total } = await userService.listAdminAuditLogs({
      userId,
      action,
      page: effectivePage,
      pageSize: effectivePageSize,
    });
    return {
      entries: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        targetUserId: row.target_user_id,
        actorName: row.actor_name,
        targetName: row.target_name,
        actorDeleted: row.actor_user_id === null,
        targetDeleted: row.target_user_id === null,
        action: row.action,
        createdAt: row.created_at,
      })),
      total,
      page: effectivePage,
      pageSize: effectivePageSize,
    };
  }
}

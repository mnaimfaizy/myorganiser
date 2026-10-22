import type { AdminAuditAction } from '@myorganiser/app-api-client';

/** Every action's label. Its keys are the action list the filters read (ADR 0053). */
export const AUDIT_ACTION_LABELS = {
  disable: 'Disable',
  enable: 'Enable',
  force_logout: 'Force logout',
  resend_verification: 'Resend verification',
  promote: 'Promote',
  demote: 'Demote',
  youtube_access_grant: 'Grant YouTube Access',
  youtube_access_withdraw: 'Withdraw YouTube Access',
  feedback_status_change: 'Change Report Status',
  feedback_tracking_issue_link: 'Link Tracking Issue',
  feedback_tracking_issue_unlink: 'Unlink Tracking Issue',
  feedback_manual_delivery: 'Mark Feedback Report Delivered',
  feedback_reopen: 'Reopen Feedback Report',
} as const satisfies Record<AdminAuditAction, string>;

export function formatAuditAction(action: AdminAuditAction): string {
  return AUDIT_ACTION_LABELS[action];
}

export function formatAuditTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

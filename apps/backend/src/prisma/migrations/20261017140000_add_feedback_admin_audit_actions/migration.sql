-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditAction" ADD VALUE 'feedback_status_change';
ALTER TYPE "AdminAuditAction" ADD VALUE 'feedback_tracking_issue_link';
ALTER TYPE "AdminAuditAction" ADD VALUE 'feedback_tracking_issue_unlink';
ALTER TYPE "AdminAuditAction" ADD VALUE 'feedback_manual_delivery';

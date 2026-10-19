-- AlterEnum
-- One enum value per migration: PostgreSQL 11 and earlier refuse
-- ALTER TYPE ... ADD VALUE alongside other statements (see ADR 0134).
-- IF NOT EXISTS keeps it safe on databases that applied the older,
-- combined form of this migration.
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'feedback_manual_delivery';

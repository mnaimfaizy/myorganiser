-- AlterTable
-- Split out of 20261014064934_add_youtube_access so that migration holds
-- only its enum value (see ADR 0134). IF NOT EXISTS keeps it safe on
-- databases that applied the older, combined form.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "youtube_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "youtube_access_first_granted_at" TIMESTAMP(3);

-- Backfill "created_at" for Users that existed before 20261021120000_add_user_created_at.
-- That migration gave every existing row the migration's own timestamp. A User id is a
-- Prisma cuid() (v1): "c", then the creation time in milliseconds as 8 base36 digits.
-- Decode it and move "created_at" back to that time. Only ever moves a value earlier,
-- so a row whose "created_at" is already right is left alone, and ids that are not a
-- v1 cuid are skipped. The cuid time is UTC; the column stores UTC without a zone.
UPDATE "User" AS u
SET "created_at" = decoded.created_at
FROM (
  SELECT
    "id",
    to_timestamp(
      (
        SELECT SUM(
          (strpos('0123456789abcdefghijklmnopqrstuvwxyz', substr("id", 1 + i, 1)) - 1)::numeric
          * power(36::numeric, 8 - i)
        )
        FROM generate_series(1, 8) AS i
      ) / 1000.0
    ) AT TIME ZONE 'UTC' AS created_at
  FROM "User"
  WHERE "id" ~ '^c[0-9a-z]{24}$'
) AS decoded
WHERE u."id" = decoded."id"
  AND decoded.created_at < u."created_at";

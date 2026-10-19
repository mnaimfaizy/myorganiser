/*
  Warnings:

  - A unique constraint covering the columns `[fix_notice_unsubscribe_token]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fix_notice_unsubscribe_token" TEXT,
ADD COLUMN     "fix_notices_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "FeedbackFixNoticeDelivery" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackFixNoticeDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackFixNoticeDelivery_report_id_key" ON "FeedbackFixNoticeDelivery"("report_id");

-- CreateIndex
CREATE INDEX "FeedbackFixNoticeDelivery_report_id_idx" ON "FeedbackFixNoticeDelivery"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_fix_notice_unsubscribe_token_key" ON "User"("fix_notice_unsubscribe_token");

-- AddForeignKey
ALTER TABLE "FeedbackFixNoticeDelivery" ADD CONSTRAINT "FeedbackFixNoticeDelivery_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "FeedbackReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

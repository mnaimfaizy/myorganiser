-- CreateEnum
CREATE TYPE "FeedbackReportKind" AS ENUM ('bug_report', 'suggestion');

-- CreateEnum
CREATE TYPE "FeedbackReportStatus" AS ENUM ('received', 'under_review', 'planned', 'fixed', 'shipped', 'wont_do', 'cannot_reproduce');

-- CreateTable
CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "kind" "FeedbackReportKind" NOT NULL,
    "status" "FeedbackReportStatus" NOT NULL DEFAULT 'received',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expected_outcome" TEXT,
    "context_platform" TEXT NOT NULL,
    "context_app_version" TEXT NOT NULL,
    "context_browser" TEXT NOT NULL,
    "context_operating_system" TEXT NOT NULL,
    "context_path" TEXT NOT NULL,
    "context_sent_at" TIMESTAMP(3) NOT NULL,
    "fix_notice_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "tracking_issue_number" INTEGER,
    "status_note" TEXT,
    "follow_up" TEXT,
    "release_tag" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "reporter_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackReport_reporter_user_id_created_at_idx" ON "FeedbackReport"("reporter_user_id", "created_at");

-- CreateIndex
CREATE INDEX "FeedbackReport_status_idx" ON "FeedbackReport"("status");

-- CreateIndex
CREATE INDEX "FeedbackReport_kind_idx" ON "FeedbackReport"("kind");

-- CreateIndex
CREATE INDEX "FeedbackReport_tracking_issue_number_idx" ON "FeedbackReport"("tracking_issue_number");

-- CreateIndex
CREATE INDEX "FeedbackReport_created_at_idx" ON "FeedbackReport"("created_at");

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


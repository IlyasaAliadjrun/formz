-- AlterTable
ALTER TABLE "notification_rules" ADD COLUMN     "condition" JSONB,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "recipient_field_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "subject" TEXT;

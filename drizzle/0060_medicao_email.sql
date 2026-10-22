ALTER TABLE "construction_progress_history" ADD COLUMN "request_email_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN "request_email_attempt_at" timestamp;

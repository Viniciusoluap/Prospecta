CREATE TYPE "public"."financial_transaction_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "status" "financial_transaction_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "due_date" timestamp;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "payment_method" varchar(40);--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "external_reference" varchar(120);--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "competency" varchar(7);--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD COLUMN "vendor" varchar(255);
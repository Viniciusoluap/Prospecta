CREATE TYPE "public"."payment_order_purpose" AS ENUM('ticket_purchase', 'utef_purchase');--> statement-breakpoint
CREATE TYPE "public"."payment_order_status" AS ENUM('pending', 'settled', 'refunded', 'chargeback', 'review_required', 'failed');--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(20) DEFAULT 'asaas' NOT NULL,
	"provider_payment_id" varchar(255) NOT NULL,
	"purpose" "payment_order_purpose" NOT NULL,
	"user_id" integer NOT NULL,
	"draw_id" integer,
	"ticket_id" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"principal_amount" integer NOT NULL,
	"bonus_amount" integer DEFAULT 0 NOT NULL,
	"status" "payment_order_status" DEFAULT 'pending' NOT NULL,
	"review_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_provider_payment_id_unique" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"draw_id" integer NOT NULL,
	"number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_numbers_draw_number_unique" ON "ticket_numbers" USING btree ("draw_id","number");
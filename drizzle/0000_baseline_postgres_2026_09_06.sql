CREATE TYPE "public"."budget_request_has_lot" AS ENUM('yes', 'no', 'not_sure');--> statement-breakpoint
CREATE TYPE "public"."budget_request_status" AS ENUM('pending', 'contacted', 'in_negotiation', 'converted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."construction_project_status" AS ENUM('planning', 'alvara', 'art', 'assinatura_cef', 'vistoria_cef', 'laudo_ok', 'cartorio', 'in_progress', 'casa_pronta', 'disponivel', 'reavaliar', 'distrato', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."construction_stage_status" AS ENUM('pending', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."draw_status" AS ENUM('active', 'closed', 'drawn');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_template_type" AS ENUM('welcome', 'budget_confirmation', 'budget_update', 'draw_winner', 'promotional_campaign', 'payment_confirmation');--> statement-breakpoint
CREATE TYPE "public"."financial_transaction_type" AS ENUM('income', 'expense', 'commission', 'salary', 'contractor_payment');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('pending', 'sent', 'responded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_activity_type" AS ENUM('message', 'call', 'document', 'status_change', 'note', 'handoff', 'follow_up', 'simulation', 'caixa_register');--> statement-breakpoint
CREATE TYPE "public"."lead_contract_type" AS ENUM('obra', 'financing', 'both');--> statement-breakpoint
CREATE TYPE "public"."lead_cpf_status" AS ENUM('clean', 'restricted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."lead_doc_status" AS ENUM('pending', 'received', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."lead_doc_type" AS ENUM('rg', 'cnh', 'address_proof', 'income_proof_formal', 'income_proof_irpf', 'fgts', 'spouse_docs', 'pis', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_income_type" AS ENUM('formal', 'informal', 'irpf');--> statement-breakpoint
CREATE TYPE "public"."lead_responsible" AS ENUM('sarah', 'vinicius', 'bianca');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('lead_new', 'attending', 'waiting_docs', 'analysis', 'caixa_register', 'approval', 'approved', 'rejected', 'followup', 'in_process', 'done');--> statement-breakpoint
CREATE TYPE "public"."lead_temperature" AS ENUM('cold', 'warm', 'hot');--> statement-breakpoint
CREATE TYPE "public"."lead_type" AS ENUM('new_lead', 'in_process', 'broker', 'employee', 'supplier', 'vip');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('draw_result', 'utef_update', 'construction_update', 'system', 'promotional');--> statement-breakpoint
CREATE TYPE "public"."obra_measurement_status" AS ENUM('pending', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('real_estate', 'financial', 'nautical');--> statement-breakpoint
CREATE TYPE "public"."product_conversion_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."task_related_type" AS ENUM('lead', 'obra', 'budget', 'financial', 'general');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ticket_payment_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."utef_transaction_type" AS ENUM('prize', 'conversion', 'adjustment', 'purchase');--> statement-breakpoint
CREATE TABLE "broker_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"client_name" varchar(255) NOT NULL,
	"broker_name" varchar(255) NOT NULL,
	"total_commission" numeric(15, 2) NOT NULL,
	"installment1_value" numeric(15, 2) DEFAULT '0',
	"installment1_paid" numeric(15, 2) DEFAULT '0',
	"installment2_value" numeric(15, 2) DEFAULT '0',
	"installment2_paid" numeric(15, 2) DEFAULT '0',
	"installment3_value" numeric(15, 2) DEFAULT '0',
	"installment3_paid" numeric(15, 2) DEFAULT '0',
	"installment4_value" numeric(15, 2) DEFAULT '0',
	"installment4_paid" numeric(15, 2) DEFAULT '0',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_id" integer,
	"image_url" text NOT NULL,
	"caption" text,
	"taken_at" timestamp NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"address" text,
	"city" varchar(100),
	"state" varchar(2),
	"project_type" varchar(100),
	"total_area" integer,
	"status" "construction_project_status" DEFAULT 'planning' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"vgv" numeric(15, 2),
	"financed_amount" numeric(15, 2),
	"fgts_amount" numeric(15, 2),
	"subsidy_amount" numeric(15, 2),
	"down_payment_total" numeric(15, 2),
	"down_payment_paid" numeric(15, 2),
	"pls_percentage" numeric(7, 4),
	"real_received_pct" numeric(7, 4),
	"cef_received_amount" numeric(15, 2),
	"construction_spent" numeric(15, 2),
	"lot_cost" numeric(15, 2),
	"broker_name" varchar(255),
	"broker_paid" numeric(15, 2) DEFAULT '0',
	"construction_cost" numeric(15, 2),
	"estimated_profit" numeric(15, 2),
	"investor_profit" numeric(15, 2),
	"prospecta_profit" numeric(15, 2),
	"pro_soluto" numeric(15, 2) DEFAULT '0',
	"installment_rate" numeric(7, 4),
	"installment_qty" integer,
	"installment_value" numeric(15, 2),
	"start_date" timestamp,
	"construction_days" integer,
	"estimated_end_date" timestamp,
	"actual_end_date" timestamp,
	"contract_value" numeric(15, 2),
	"contract_type" varchar(100),
	"notes" text,
	"extra_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"order_index" integer NOT NULL,
	"status" "construction_stage_status" DEFAULT 'pending' NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"estimated_cost" integer,
	"actual_cost" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"prize_amount" integer NOT NULL,
	"ticket_price" integer NOT NULL,
	"target_amount" integer NOT NULL,
	"current_amount" integer DEFAULT 0 NOT NULL,
	"tickets_sold" integer DEFAULT 0 NOT NULL,
	"status" "draw_status" DEFAULT 'active' NOT NULL,
	"draw_date" timestamp,
	"winner_user_id" integer,
	"lottery_result" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_email" varchar(320) NOT NULL,
	"recipient_name" varchar(255),
	"subject" varchar(500) NOT NULL,
	"template_type" "email_template_type" NOT NULL,
	"html_content" text NOT NULL,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"error_message" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "financial_transaction_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" varchar(500) NOT NULL,
	"category" varchar(100),
	"responsible" varchar(100),
	"reference_id" integer,
	"reference_type" varchar(50),
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"type" "lead_activity_type" NOT NULL,
	"description" text NOT NULL,
	"performed_by" varchar(100),
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"type" "lead_doc_type" NOT NULL,
	"file_name" varchar(255),
	"file_url" text,
	"status" "lead_doc_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"uploaded_at" timestamp,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"attempt" integer NOT NULL,
	"sub_attempt" integer NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"executed_at" timestamp,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(320),
	"city" varchar(100),
	"state" varchar(2),
	"type" "lead_type" DEFAULT 'new_lead' NOT NULL,
	"temperature" "lead_temperature" DEFAULT 'cold' NOT NULL,
	"stage" "lead_stage" DEFAULT 'lead_new' NOT NULL,
	"responsible" "lead_responsible" DEFAULT 'sarah' NOT NULL,
	"income" numeric(15, 2),
	"income_type" "lead_income_type",
	"fgts_amount" numeric(15, 2),
	"pis_fgts" varchar(20),
	"has_spouse" boolean DEFAULT false,
	"spouse_name" varchar(255),
	"income_composition" boolean DEFAULT false,
	"cpf_status" "lead_cpf_status" DEFAULT 'unknown',
	"simulation_value" numeric(15, 2),
	"approved_value" numeric(15, 2),
	"contract_type" "lead_contract_type",
	"source_channel" varchar(100),
	"source_city" varchar(100),
	"lgpd_consent" boolean DEFAULT false,
	"lgpd_consent_at" timestamp,
	"rejection_reason" text,
	"followup_date" timestamp,
	"notes" text,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obra_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"fee_type" varchar(100) NOT NULL,
	"estimated_value" numeric(15, 2) DEFAULT '0',
	"paid_value" numeric(15, 2) DEFAULT '0',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obra_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_id" integer,
	"measurement_date" timestamp NOT NULL,
	"value" numeric(15, 2) NOT NULL,
	"status" "obra_measurement_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(50) DEFAULT 'asaas' NOT NULL,
	"asaas_api_key_encrypted" text NOT NULL,
	"asaas_webhook_token_encrypted" text,
	"asaas_environment" varchar(20) DEFAULT 'sandbox' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"utef_amount" integer NOT NULL,
	"status" "product_conversion_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" "product_category" NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"price_utef" integer NOT NULL,
	"image_url" text,
	"details" text,
	"status" "product_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_budget_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(20),
	"city" varchar(255),
	"project_type" varchar(100),
	"has_lot" "budget_request_has_lot",
	"message" text,
	"status" "budget_request_status" DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"assigned_to" varchar(100) NOT NULL,
	"related_type" "task_related_type",
	"related_id" integer,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"sla_hours" integer DEFAULT 24,
	"due_at" timestamp,
	"completed_at" timestamp,
	"escalated_to_vinicius" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"draw_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"ticket_number" varchar(50) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total_paid" integer NOT NULL,
	"payment_status" "ticket_payment_status" DEFAULT 'pending' NOT NULL,
	"payment_method" varchar(50) DEFAULT 'pix',
	"pix_qr_code" text,
	"pix_copy_paste" text,
	"stripe_payment_intent_id" varchar(255),
	"stripe_checkout_session_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"related_id" integer,
	"action_url" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(320) NOT NULL,
	"passwordHash" varchar(128),
	"name" text,
	"email" varchar(320),
	"cpf" varchar(14),
	"phone" varchar(20),
	"address" text,
	"city" varchar(100),
	"state" varchar(2),
	"zipCode" varchar(10),
	"avatarUrl" text,
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "utef_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "utef_balances_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "utef_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"type" "utef_transaction_type" NOT NULL,
	"description" text,
	"related_id" integer,
	"reference_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);

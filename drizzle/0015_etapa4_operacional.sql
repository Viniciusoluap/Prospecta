CREATE TABLE "broker_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"specialties" text DEFAULT '[]' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"beneficiary" varchar(20) NOT NULL,
	"business_type" varchar(60) NOT NULL,
	"broker_id" integer,
	"property" varchar(255) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"status" varchar(30) DEFAULT 'pendente' NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"types" text DEFAULT '[]' NOT NULL,
	"status" varchar(40) DEFAULT 'orcamento' NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"client_phone" varchar(40) NOT NULL,
	"engineer" varchar(255) NOT NULL,
	"value" numeric(15, 2) NOT NULL,
	"paid_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"deadline" timestamp,
	"lead_id" integer,
	"description" text DEFAULT '' NOT NULL,
	"checklist" text DEFAULT '[]' NOT NULL,
	"files" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_visits" DROP CONSTRAINT "portal_visits_lead_id_leads_id_fk";
--> statement-breakpoint
ALTER TABLE "portal_visits" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD COLUMN "client_name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD COLUMN "client_phone" varchar(40) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD COLUMN "broker_id" integer;--> statement-breakpoint
ALTER TABLE "broker_profiles" ADD CONSTRAINT "broker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_commissions" ADD CONSTRAINT "operational_commissions_broker_id_users_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_projects" ADD CONSTRAINT "operational_projects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD CONSTRAINT "portal_visits_broker_id_users_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD CONSTRAINT "portal_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Preserve the display identity of existing visits even after a lead is removed.
UPDATE portal_visits AS visit SET client_name = lead.name, client_phone = COALESCE(lead.phone, '') FROM leads AS lead WHERE visit.lead_id = lead.id AND visit.client_name = '';

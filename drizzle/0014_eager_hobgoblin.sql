ALTER TABLE "portal_contracts" ADD COLUMN "party_a" varchar(255);--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "party_a_document" varchar(40);--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "party_b" varchar(255);--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "party_b_document" varchar(40);--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "property_id" integer;--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "value" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "clauses" text;--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD COLUMN "signature_gov_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creci" varchar(40);--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD CONSTRAINT "portal_contracts_property_id_imoveis_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."imoveis"("id") ON DELETE set null ON UPDATE no action;
CREATE TABLE "portal_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"sender" varchar(30) NOT NULL,
	"text" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_contract_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"type" varchar(30) DEFAULT 'anexo' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"number" varchar(80) NOT NULL,
	"type" varchar(80) NOT NULL,
	"status" varchar(30) DEFAULT 'rascunho' NOT NULL,
	"description" text,
	"signature_status" varchar(30) DEFAULT 'pendente' NOT NULL,
	"signed_document_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_contracts_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "portal_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"scheduled_at" timestamp NOT NULL,
	"status" varchar(30) DEFAULT 'agendada' NOT NULL,
	"visit_type" varchar(40) DEFAULT 'imovel' NOT NULL,
	"responsible_name" varchar(255),
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lead_id" integer;--> statement-breakpoint
ALTER TABLE "portal_chat_messages" ADD CONSTRAINT "portal_chat_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_contract_documents" ADD CONSTRAINT "portal_contract_documents_contract_id_portal_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."portal_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_contracts" ADD CONSTRAINT "portal_contracts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD CONSTRAINT "portal_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_visits" ADD CONSTRAINT "portal_visits_property_id_imoveis_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."imoveis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_lead_id_unique" UNIQUE("lead_id");
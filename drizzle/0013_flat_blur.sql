CREATE TYPE "public"."financiamento_banco" AS ENUM('caixa', 'bb', 'bradesco', 'itau', 'santander', 'outro');--> statement-breakpoint
CREATE TYPE "public"."financiamento_status" AS ENUM('pre_analise', 'documentacao', 'analise_banco', 'aprovado', 'contrato', 'registro', 'liberado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."financiamento_tipo" AS ENUM('mcmv', 'sbpe', 'pro_cotista', 'construcao', 'reforma');--> statement-breakpoint
CREATE TABLE "financiamento_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"financiamento_id" integer NOT NULL,
	"grupo" varchar(80) NOT NULL,
	"item" varchar(255) NOT NULL,
	"concluido" boolean DEFAULT false NOT NULL,
	"concluido_em" timestamp,
	"notas" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financiamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"cliente_nome" varchar(255) NOT NULL,
	"cliente_cpf" varchar(14),
	"cliente_tel" varchar(30) NOT NULL,
	"cliente_email" varchar(320),
	"imovel" varchar(500) NOT NULL,
	"tipo" "financiamento_tipo" NOT NULL,
	"banco" "financiamento_banco" NOT NULL,
	"banco_outro" varchar(120),
	"valor_imovel" numeric(15, 2) DEFAULT '0' NOT NULL,
	"valor_financiado" numeric(15, 2) DEFAULT '0' NOT NULL,
	"entrada" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxa" numeric(8, 4) DEFAULT '0' NOT NULL,
	"prazo" integer DEFAULT 360 NOT NULL,
	"parcela" numeric(15, 2),
	"status" "financiamento_status" DEFAULT 'pre_analise' NOT NULL,
	"protocolo" varchar(120),
	"lead_id" integer,
	"imovel_vinculado_id" integer,
	"corretor_id" integer,
	"observacoes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financiamento_checklist_items" ADD CONSTRAINT "financiamento_checklist_items_financiamento_id_financiamentos_id_fk" FOREIGN KEY ("financiamento_id") REFERENCES "public"."financiamentos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financiamentos" ADD CONSTRAINT "financiamentos_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financiamentos" ADD CONSTRAINT "financiamentos_imovel_vinculado_id_imoveis_id_fk" FOREIGN KEY ("imovel_vinculado_id") REFERENCES "public"."imoveis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financiamentos" ADD CONSTRAINT "financiamentos_corretor_id_users_id_fk" FOREIGN KEY ("corretor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
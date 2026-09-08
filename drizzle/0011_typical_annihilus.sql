CREATE TYPE "public"."bpo_client_status" AS ENUM('ativo', 'pausado', 'encerrado');--> statement-breakpoint
CREATE TYPE "public"."bpo_lancamento_tipo" AS ENUM('honorario', 'despesa', 'reembolso');--> statement-breakpoint
CREATE TABLE "bpo_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"razao_social" varchar(255) NOT NULL,
	"cnpj" varchar(20),
	"cpf" varchar(14),
	"responsavel" varchar(255) NOT NULL,
	"email" varchar(255),
	"telefone" varchar(20) NOT NULL,
	"servicos" text DEFAULT '[]' NOT NULL,
	"status" "bpo_client_status" DEFAULT 'ativo' NOT NULL,
	"honorarios" numeric(15, 2) NOT NULL,
	"dia_vencimento" integer DEFAULT 10 NOT NULL,
	"data_inicio" timestamp NOT NULL,
	"observacoes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bpo_lancamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"cliente_id" integer,
	"cliente_nome_livre" varchar(255),
	"tipo" "bpo_lancamento_tipo" NOT NULL,
	"descricao" varchar(500) NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"vencimento" timestamp NOT NULL,
	"pago" boolean DEFAULT false NOT NULL,
	"pago_em" timestamp,
	"competencia" varchar(7) NOT NULL,
	"centro_custos" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bpo_lancamentos" ADD CONSTRAINT "bpo_lancamentos_cliente_id_bpo_clients_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."bpo_clients"("id") ON DELETE set null ON UPDATE no action;
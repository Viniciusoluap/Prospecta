CREATE TYPE "public"."bank_account_tipo" AS ENUM('corrente', 'poupanca', 'pagamento', 'investimento');--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_status" AS ENUM('pendente', 'conciliado', 'ignorado');--> statement-breakpoint
CREATE TYPE "public"."bank_transaction_tipo" AS ENUM('credito', 'debito');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"banco" varchar(255) NOT NULL,
	"agencia" varchar(20),
	"conta" varchar(30) NOT NULL,
	"tipo" "bank_account_tipo" DEFAULT 'corrente' NOT NULL,
	"descricao" varchar(255),
	"saldo_atual" numeric(15, 2) DEFAULT '0' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"pluggy_item_id" varchar(120),
	"pluggy_account_id" varchar(120),
	"webhook_url" varchar(500),
	"ultima_sincronizacao" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"data" timestamp NOT NULL,
	"descricao" varchar(500) NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"tipo" "bank_transaction_tipo" NOT NULL,
	"categoria" varchar(100),
	"status" "bank_transaction_status" DEFAULT 'pendente' NOT NULL,
	"external_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "pluggy_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id_encrypted" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;
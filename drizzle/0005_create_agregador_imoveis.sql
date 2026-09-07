CREATE TYPE "public"."agregador_documento_tipo" AS ENUM('nenhum', 'escritura', 'contrato_gaveta', 'inventario', 'heranca', 'financiado', 'loteamento', 'posse', 'outros');--> statement-breakpoint
CREATE TYPE "public"."agregador_fonte" AS ENUM('olx', 'zapimoveis', 'vivareal', 'facebook', 'instagram', 'google', 'direto', 'outro');--> statement-breakpoint
CREATE TYPE "public"."agregador_status" AS ENUM('pendente', 'verificado', 'arquivado', 'importado');--> statement-breakpoint
CREATE TABLE "agregador_imoveis" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" varchar(255) NOT NULL,
	"descricao" text,
	"preco" numeric(15, 2),
	"preco_texto" varchar(50),
	"area_m2" numeric(10, 2),
	"tipo" varchar(100),
	"bairro" varchar(100),
	"cidade" varchar(100) NOT NULL,
	"estado" varchar(2) NOT NULL,
	"fonte" "agregador_fonte" NOT NULL,
	"url_fonte" text,
	"imagens" text DEFAULT '[]' NOT NULL,
	"status" "agregador_status" DEFAULT 'pendente' NOT NULL,
	"documento_tipo" "agregador_documento_tipo" DEFAULT 'nenhum' NOT NULL,
	"documento_obs" text,
	"contato_nome" varchar(255),
	"contato_tel" varchar(20),
	"notas" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
